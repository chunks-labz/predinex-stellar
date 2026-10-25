/**
 * Distributed tracing across API and worker (settlement bot).
 *
 * Uses W3C `traceparent` context propagation and a configurable span exporter
 * that is disabled by default in tests unless `OTEL_TRACING_ENABLED=true` or
 * an explicit exporter is registered.
 *
 * Emits spans around:
 *   - job handling (`worker.cycle`, `worker.job`)
 *   - oracle fetch (`oracle.fetch`)
 *   - contract calls (`contract.call`, `contract.settle_pools`)
 *   - webhook notifications (`webhook.notify`)
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { logger } from "./logger.js";

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
  /** Request/job correlation ID shared with the API that enqueued the job. */
  correlationId: string;
}

export interface RecordedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  status: "ok" | "error";
  error?: string;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanExporter {
  export(spans: RecordedSpan[]): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export class InMemoryWorkerSpanExporter implements SpanExporter {
  private spans: RecordedSpan[] = [];

  export(spans: RecordedSpan[]): void {
    this.spans.push(...spans);
  }

  getFinishedSpans(): RecordedSpan[] {
    return [...this.spans];
  }

  reset(): void {
    this.spans = [];
  }

  shutdown(): void {
    this.spans = [];
  }
}

export class OtlpHttpWorkerSpanExporter implements SpanExporter {
  constructor(private readonly endpoint: string) {}

  async export(spans: RecordedSpan[]): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spans }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      logger.debug("Failed to export trace spans", { error: String(err) });
    }
  }
}

const traceStorage = new AsyncLocalStorage<SpanContext>();

let activeExporter: SpanExporter | null = null;
let tracingEnabled = false;

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

export function isWorkerTracingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === "test" && env.OTEL_TRACING_ENABLED !== "true") {
    return false;
  }
  return env.OTEL_TRACING_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Configures worker tracing. Disabled by default (especially in tests) unless
 * `OTEL_TRACING_ENABLED=true` or an explicit `exporter` is passed with
 * enabled flag.
 */
export function initWorkerTracing(
  env: NodeJS.ProcessEnv = process.env,
  exporter?: SpanExporter,
): boolean {
  tracingEnabled = isWorkerTracingEnabled(env);
  if (!tracingEnabled) {
    activeExporter = null;
    return false;
  }

  if (exporter) {
    activeExporter = exporter;
  } else {
    const endpoint =
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
      env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    activeExporter = endpoint
      ? new OtlpHttpWorkerSpanExporter(endpoint)
      : new InMemoryWorkerSpanExporter();
  }
  return true;
}

export async function shutdownWorkerTracing(): Promise<void> {
  const exp = activeExporter;
  activeExporter = null;
  tracingEnabled = false;
  if (exp?.shutdown) {
    await exp.shutdown();
  }
}

/**
 * Parses a W3C `traceparent` header (`00-<traceId>-<spanId>-<flags>`).
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizeCorrelationId(value: string | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function parseTraceparent(header: string | undefined): SpanContext | null {
  if (!header) return null;
  const trimmed = header.trim();
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(trimmed);
  if (!match) return null;
  const [, traceId, spanId, traceFlags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: traceFlags.toLowerCase(),
    correlationId: traceId.toLowerCase(),
  };
}

export function formatTraceparent(ctx: SpanContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`;
}

export function getActiveSpanContext(): SpanContext | undefined {
  return traceStorage.getStore();
}

export function getActiveCorrelationId(): string | undefined {
  return traceStorage.getStore()?.correlationId;
}

/**
 * Injects the current trace context into an outgoing HTTP headers record or
 * queued job metadata object.
 */
export function injectWorkerTraceHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  const active = traceStorage.getStore();
  if (active) {
    headers["traceparent"] = formatTraceparent(active);
    headers["x-correlation-id"] = active.correlationId;
    headers["x-request-id"] = active.correlationId;
  }
  return headers;
}

/**
 * Extracts a `SpanContext` from incoming HTTP headers or a queued job carrier.
 */
export function extractWorkerTraceContext(
  carrier?: Record<string, string | string[] | undefined> | null,
): SpanContext | undefined {
  if (!carrier) return undefined;
  const raw = carrier["traceparent"] ?? carrier["TRACEPARENT"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = parseTraceparent(value);
  const correlationId = normalizeCorrelationId(
    carrier["x-correlation-id"] ??
      carrier["X-Correlation-ID"] ??
      carrier["x-request-id"] ??
      carrier["X-Request-ID"],
  );

  if (!parsed && !correlationId) return undefined;
  if (!parsed) {
    return {
      traceId: randomHex(16),
      spanId: randomHex(8),
      traceFlags: tracingEnabled ? "01" : "00",
      correlationId: correlationId!,
    };
  }

  return { ...parsed, correlationId: correlationId ?? parsed.correlationId };
}

/**
 * Runs `fn` inside a span, linking to `parentContext` (if provided) or the
 * active async context. When tracing is disabled, `fn` runs with minimal
 * context propagation and no exporter emission.
 */
export async function withWorkerSpan<T>(
  name: string,
  fn: (spanCtx: SpanContext) => Promise<T>,
  options?: {
    parentContext?: SpanContext | Record<string, string | string[] | undefined>;
    attributes?: Record<string, string | number | boolean>;
  },
): Promise<T> {
  const explicitParent =
    options?.parentContext && "traceId" in options.parentContext
      ? (options.parentContext as SpanContext)
      : extractWorkerTraceContext(
          options?.parentContext as
            | Record<string, string | string[] | undefined>
            | undefined,
        );

  const inherited = explicitParent ?? traceStorage.getStore();
  const traceId = inherited?.traceId ?? randomHex(16);
  const spanCtx: SpanContext = {
    traceId,
    spanId: randomHex(8),
    traceFlags: inherited?.traceFlags ?? (tracingEnabled ? "01" : "00"),
    correlationId: inherited?.correlationId ?? traceId,
  };

  const startTimeMs = Date.now();

  return traceStorage.run(spanCtx, async () => {
    try {
      const result = await fn(spanCtx);
      if (tracingEnabled && activeExporter) {
        const recorded: RecordedSpan = {
          name,
          traceId: spanCtx.traceId,
          spanId: spanCtx.spanId,
          parentSpanId: inherited?.spanId,
          startTimeMs,
          endTimeMs: Date.now(),
          durationMs: Date.now() - startTimeMs,
          status: "ok",
          attributes: { ...(options?.attributes ?? {}), "predinex.correlation_id": spanCtx.correlationId },
        };
        await activeExporter.export([recorded]);
      }
      return result;
    } catch (err) {
      if (tracingEnabled && activeExporter) {
        const recorded: RecordedSpan = {
          name,
          traceId: spanCtx.traceId,
          spanId: spanCtx.spanId,
          parentSpanId: inherited?.spanId,
          startTimeMs,
          endTimeMs: Date.now(),
          durationMs: Date.now() - startTimeMs,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          attributes: { ...(options?.attributes ?? {}), "predinex.correlation_id": spanCtx.correlationId },
        };
        await activeExporter.export([recorded]);
      }
      throw err;
    }
  });
}

