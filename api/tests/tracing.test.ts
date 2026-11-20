import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import {
  initTracing,
  injectTraceHeaders,
  isTracingEnabled,
  shutdownTracing,
  tracingMiddleware,
  withSpan,
} from '../src/middleware/tracing.js';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_SPAN_ID = '00f067aa0ba902b7';

// The HTTP span ends on the response's `finish` event, which can land just
// after the client has read the response.
async function httpSpan(exporter: InMemorySpanExporter) {
  await vi.waitFor(() => {
    expect(exporter.getFinishedSpans().some((s) => s.name === 'GET /api/things/:id')).toBe(true);
  });
  return exporter.getFinishedSpans().find((s) => s.name === 'GET /api/things/:id')!;
}

function buildApp() {
  const app = express();
  app.use(tracingMiddleware);
  app.get('/api/things/:id', async (_req, res) => {
    await withSpan('db.query', async () => 'row');
    res.json({ traceparent: injectTraceHeaders().traceparent });
  });
  return app;
}

describe('OpenTelemetry tracing (Issue #1426)', () => {
  afterEach(async () => {
    await shutdownTracing();
  });

  it('is disabled unless OTEL_TRACING_ENABLED=true', () => {
    expect(isTracingEnabled({})).toBe(false);
    expect(isTracingEnabled({ OTEL_TRACING_ENABLED: 'false' })).toBe(false);
    expect(isTracingEnabled({ OTEL_TRACING_ENABLED: 'true' })).toBe(true);
    expect(initTracing({})).toBe(false);
  });

  it('emits no spans and leaves requests working while disabled', async () => {
    const exporter = new InMemorySpanExporter();
    initTracing({}, exporter);

    const res = await request(buildApp()).get('/api/things/1');

    expect(res.status).toBe(200);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it('emits an HTTP span and a DB span when enabled', async () => {
    const exporter = new InMemorySpanExporter();
    initTracing({ OTEL_TRACING_ENABLED: 'true' }, exporter);

    const res = await request(buildApp()).get('/api/things/1');
    expect(res.status).toBe(200);

    const http = await httpSpan(exporter);
    const db = exporter.getFinishedSpans().find((s) => s.name === 'db.query');
    expect(http.attributes['http.response.status_code']).toBe(200);
    expect(http.attributes['http.route']).toBe('/api/things/:id');
    expect(db).toBeDefined();
    expect(db!.spanContext().traceId).toBe(http.spanContext().traceId);
    expect(db!.parentSpanContext?.spanId).toBe(http.spanContext().spanId);
  });

  it('continues an incoming traceparent and propagates it outward', async () => {
    const exporter = new InMemorySpanExporter();
    initTracing({ OTEL_TRACING_ENABLED: 'true' }, exporter);

    const res = await request(buildApp())
      .get('/api/things/1')
      .set('traceparent', `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`);

    const http = await httpSpan(exporter);
    expect(http.spanContext().traceId).toBe(TRACE_ID);
    expect(http.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
    expect(res.body.traceparent).toBe(`00-${TRACE_ID}-${http.spanContext().spanId}-01`);
  });

  it('marks a span as errored and rethrows when the wrapped work fails', async () => {
    const exporter = new InMemorySpanExporter();
    initTracing({ OTEL_TRACING_ENABLED: 'true' }, exporter);

    await expect(
      withSpan('indexer.job', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const span = exporter.getFinishedSpans().find((s) => s.name === 'indexer.job')!;
    expect(span.status.code).toBe(2);
  });
});
