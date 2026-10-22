/**
 * Request correlation context (Issue #1491).
 *
 * Every inbound HTTP request gets a correlation ID that is:
 *   - accepted from `X-Correlation-ID`, `X-Request-ID`, or the trace ID in a
 *     W3C `traceparent` header (so callers and upstream services can join logs),
 *   - generated when none is supplied,
 *   - stored in AsyncLocalStorage so every log line and outgoing request made
 *     while handling that request carries the same ID,
 *   - echoed in the `X-Correlation-ID` / `X-Request-ID` response headers and in
 *     error response bodies.
 *
 * `injectJobTraceContext` in `middleware/tracing.ts` copies the active ID into
 * queued job metadata, and the settlement bot reads `x-correlation-id` from
 * that carrier, so one ID links an API request to the worker job and each
 * settlement step it performs.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface CorrelationContext {
  /** Canonical correlation ID for this request/job chain. */
  correlationId: string;
  /** Client-supplied request ID, or the correlation ID when none was sent. */
  requestId: string;
  /** W3C trace ID when an incoming traceparent was present. */
  traceId?: string;
  /** W3C parent span ID when an incoming traceparent was present. */
  spanId?: string;
}

export type CorrelationSource = 'correlation-id' | 'request-id' | 'traceparent' | 'generated';

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Correlation IDs are opaque, log-safe tokens; reject anything else. */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return CORRELATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function parseTraceparent(
  header: string | string[] | undefined
): { traceId: string; spanId: string } | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;

  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(raw.trim());
  if (!match) return undefined;

  const [, traceId, spanId] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined;
  return { traceId: traceId.toLowerCase(), spanId: spanId.toLowerCase() };
}

/**
 * Resolves the correlation context for an inbound request. Precedence is
 * explicit correlation header, explicit request header, incoming trace, then a
 * freshly generated ID.
 */
export function resolveCorrelationContext(headers: Record<string, string | string[] | undefined>): {
  context: CorrelationContext;
  source: CorrelationSource;
} {
  const trace = parseTraceparent(headerValue(headers, 'traceparent'));
  const suppliedCorrelationId = normalizeCorrelationId(headerValue(headers, 'x-correlation-id'));
  const suppliedRequestId = normalizeCorrelationId(headerValue(headers, 'x-request-id'));

  const correlationId =
    suppliedCorrelationId ?? suppliedRequestId ?? trace?.traceId ?? randomUUID();
  const requestId = suppliedRequestId ?? suppliedCorrelationId ?? correlationId;

  const source: CorrelationSource = suppliedCorrelationId
    ? 'correlation-id'
    : suppliedRequestId
      ? 'request-id'
      : trace
        ? 'traceparent'
        : 'generated';

  return {
    context: {
      correlationId,
      requestId,
      ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
    },
    source,
  };
}

export function runWithCorrelation<T>(context: CorrelationContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
