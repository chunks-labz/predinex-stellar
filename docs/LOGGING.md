# Structured Logging and Correlation IDs (Issue #1491)

Predinex uses structured JSON logs across the API and settlement bot. Every log
line is a single JSON object written to stdout/stderr so log aggregators can
parse and index it directly. A single correlation ID links a client request
through API handlers, queued/background work, and each settlement step.

## Schema

| Field | Required | Description |
| --- | --- | --- |
| `ts` | yes | ISO-8601 timestamp (e.g. `2026-10-22T...Z`). |
| `level` | yes | `debug`, `info`, `warn`, or `error`. |
| `service` | yes | `predinex-api` or `predinex-settlement-bot`. |
| `msg` | yes | Stable event name (e.g. `http_request`, `unhandled_api_error`, `worker.job.settlement_cycle`, `pool_settled`). |
| `correlationId` | when in scope | Canonical ID for this request/job chain. Grep for one ID to follow the full flow. |
| `requestId` | when in scope | Client-supplied or echoed request identifier. |
| `traceId` | when known | W3C trace ID (propagated via `traceparent`). |
| `spanId` | when known | W3C span ID. |
| `error` | on error | Error message when logging failures via `serializeError`. |
| `errorName` | on error | Error class name. |
| `stack` | optional | Stack trace when available. |
| ... | varies | Event-specific fields (route, status, durationMs, poolId, marketId, etc.). |

## Correlation ID propagation

1. **Inbound API**: `api/src/middleware/request-context.ts` resolves the ID from
   `X-Correlation-ID`, `X-Request-ID`, the `traceId` in a W3C `traceparent`
   header, or a newly generated UUID. The ID is stored in `AsyncLocalStorage`,
   echoed as `X-Correlation-ID` and `X-Request-ID` on every response (including
   404 and 500), and logged by the access middleware as `http_request`.
2. **Tracing integration**: `api/src/middleware/tracing.ts` attaches
   `predinex.correlation_id` to spans and copies the correlation ID into
   `x-correlation-id` / `x-request-id` via `injectTraceHeaders` and
   `injectJobTraceContext`. Job carriers include both `traceContext` and
   `correlationId` so workers can continue the chain.
3. **Settlement bot**: `bot/src/tracing.ts` extracts `x-correlation-id` /
   `x-request-id` from job carriers and `traceparent` from headers, stores it on
   `SpanContext` (falling back to the trace ID if none is provided), and injects
   it on outgoing headers. `bot/src/logger.ts` attaches `correlationId`,
   `traceId`, and `spanId` to every log line. `bot/src/poller.ts` wraps each
   cycle in `withWorkerSpan("worker.job.settlement_cycle", ...)`, so every
   log emitted during that cycle inherits the correlation ID.
4. **Downstream calls**: Use `injectTraceHeaders()` / `injectWorkerTraceHeaders()`
   when calling other services so correlation propagates end-to-end.

## Error responses

All API error responses include a correlation ID when available:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "correlationId": "..."
  },
  "timestamp": "..."
}
```

Route 404s use the same shape with `"code": "NOT_FOUND"` and include
`correlationId`.

## Configuration

- **API**: `LOG_LEVEL` (`debug|info|warn|error`, default `info`) via
  `api/src/lib/logger.ts`.
- **Bot**: `LOG_LEVEL` (`debug|info|warn|error`, default `info`) via
  `bot/src/logger.ts` (configured through `bot/src/config.ts`).
- Tracing remains opt-in via `OTEL_TRACING_ENABLED` for both services.

## Testing guidance

- API tests can read the correlation ID from response headers
  (`X-Correlation-ID`) or error bodies and assert logs when necessary.
- Bot tests can pass a carrier with `x-correlation-id` to `withWorkerSpan` /
  `extractWorkerTraceContext` and assert `getActiveCorrelationId()` or logged
  fields.
- In tests, prefer injecting a known correlation ID to avoid non-determinism.
