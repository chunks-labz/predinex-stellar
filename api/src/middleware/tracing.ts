/**
 * OpenTelemetry tracing (Issue #1426).
 *
 * Opt-in: nothing is exported unless `OTEL_TRACING_ENABLED=true`. When
 * enabled, spans are sent to an OTLP/HTTP collector (the standard
 * `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
 * variables select the target). While disabled the OpenTelemetry API is a
 * no-op, so `tracingMiddleware` and `withSpan` add no spans.
 *
 * Trace and span IDs propagate across services through the W3C
 * `traceparent` header: `tracingMiddleware` continues an incoming trace and
 * `injectTraceHeaders` stamps the current context onto outgoing requests.
 * `withSpan` wraps DB calls and indexer jobs.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  SimpleSpanProcessor,
  SpanExporter,
} from '@opentelemetry/sdk-trace-node';

const TRACER_NAME = 'predinex-api';

let provider: NodeTracerProvider | undefined;

export function isTracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OTEL_TRACING_ENABLED?.trim().toLowerCase() === 'true';
}

/**
 * Starts the tracer provider when tracing is enabled. Returns whether tracing
 * is active. `exporter` lets tests capture spans in memory; when supplied
 * spans are processed synchronously.
 */
export function initTracing(
  env: NodeJS.ProcessEnv = process.env,
  exporter?: SpanExporter
): boolean {
  if (!isTracingEnabled(env) || provider) return Boolean(provider);

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': env.OTEL_SERVICE_NAME?.trim() || TRACER_NAME,
    }),
    spanProcessors: [
      exporter
        ? new SimpleSpanProcessor(exporter)
        : new BatchSpanProcessor(new OTLPTraceExporter()),
    ],
  });
  provider.register();
  return true;
}

/** Flushes pending spans and stops the provider. Safe to call when disabled. */
export async function shutdownTracing(): Promise<void> {
  const active = provider;
  provider = undefined;
  if (active) {
    await active.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  }
}

/** Opens a SERVER span per HTTP request, continuing any incoming `traceparent`. */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!provider) {
    next();
    return;
  }

  const parent = propagation.extract(ROOT_CONTEXT, req.headers);
  const span = trace.getTracer(TRACER_NAME).startSpan(
    `${req.method} ${req.path}`,
    {
      kind: SpanKind.SERVER,
      attributes: { 'http.request.method': req.method, 'url.path': req.path },
    },
    parent
  );

  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : undefined;
    if (route) {
      span.updateName(`${req.method} ${route}`);
      span.setAttribute('http.route', route);
    }
    span.setAttribute('http.response.status_code', res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });

  context.with(trace.setSpan(parent, span), next);
}

/** Runs `fn` inside a child span of the active context (DB calls, indexer jobs). */
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer(TRACER_NAME).startActiveSpan(name, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Adds the active trace context (`traceparent`) to outgoing request headers. */
export function injectTraceHeaders(headers: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}
