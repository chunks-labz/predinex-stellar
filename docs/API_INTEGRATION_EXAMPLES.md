# API integration examples

Copyable `curl` requests and example JSON responses for the Predinex HTTP API.
The examples cover the request conventions external integrators need first
(headers, API keys, versioning, rate limits, and errors), followed by the most
common read and estimation endpoints.

All values below are illustrative. Replace the base URL, API key, account,
contract, and cursor values with the ones for your environment.

- [Request conventions](#request-conventions)
  - [Base URL](#base-url)
  - [Headers and API keys](#headers-and-api-keys)
  - [API versioning](#api-versioning)
  - [Errors and correlation IDs](#errors-and-correlation-ids)
  - [Rate limits](#rate-limits)
- [Health and readiness probes](#health-and-readiness-probes)
  - [Liveness probe](#liveness-probe)
  - [Readiness probe](#readiness-probe)
  - [Detailed health](#detailed-health)
- [Common endpoints](#common-endpoints)
  - [List markets](#list-markets)
  - [List events](#list-events)
  - [Estimate gas](#estimate-gas)
  - [Get a reputation profile](#get-a-reputation-profile)
- [Pagination](#pagination)
- [Reference](#reference)

## Request conventions

### Base URL

The API listens on port `3001` by default in local development. Set the base
URL once in your shell and reuse it in every example:

```bash
export PREDINEX_API_URL="${PREDINEX_API_URL:-http://localhost:3001}"
```

Use `-i` when you want to see response headers such as `X-API-Version`,
`X-Correlation-ID`, and `RateLimit-*`:

```bash
curl -i "$PREDINEX_API_URL/healthz"
```

### Headers and API keys

Send JSON bodies with `Content-Type: application/json`. API keys are accepted
only in the `x-api-key` request header. Never put a key in the query string:
query-string keys are rejected, and they leak through logs, browser history,
and `Referer` headers.

```bash
export PREDINEX_API_KEY="${PREDINEX_API_KEY:-replace-with-your-api-key}"

curl -sS "$PREDINEX_API_URL/api/markets?status=cancelled" \
  -H "x-api-key: $PREDINEX_API_KEY"
```

A registered key gets its own rate-limit bucket and, when it has the right
role, authorizes protected routes. An unknown key does not create a separate
bucket and does not grant a role. Role-protected routes return `401` when the
required role is missing:

```bash
curl -sS -i -X POST "$PREDINEX_API_URL/api/compliance/register"
```

Example `401` response:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Requires one of roles: Admin, ComplianceOfficer"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

The admin-only view of cancelled markets returns `403` instead:

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Admin access required to include cancelled markets"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### API versioning

`v1` is the current version. Use either the versioned URI or the
`X-API-Version` / `Accept-Version` header; unversioned `/api/*` paths default
to `v1`. A version in the URI takes precedence over the header.

```bash
# Versioned URI (rewritten internally to /api/markets)
curl -sS -i "$PREDINEX_API_URL/api/v1/markets?limit=1"

# Header-based negotiation
curl -sS -i "$PREDINEX_API_URL/api/markets?limit=1" \
  -H "X-API-Version: v1"
```

Successful `/api/*` responses include `X-API-Version: v1`. An unsupported
version returns `400` before reaching the route:

```bash
curl -sS -i "$PREDINEX_API_URL/api/markets" \
  -H "X-API-Version: v2"
```

Example `400` response:

```json
{
  "success": false,
  "error": {
    "code": "UNSUPPORTED_API_VERSION",
    "message": "Unsupported API version 'v2'. Supported versions: v1"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Deprecated endpoints also return `Deprecation`, `Sunset`, and, when a
replacement exists, `Link: <...>; rel="successor-version"` headers.

### Errors and correlation IDs

Validation and route errors use a consistent envelope. `details` is present
when the API can report every offending field at once:

```bash
curl -sS -i "$PREDINEX_API_URL/api/markets?limit=0"
```

Example `400 VALIDATION_ERROR` response:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid market query parameters",
    "details": ["limit must be a positive integer"]
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Unknown routes return `404`. The `correlationId` in the body matches the
`X-Correlation-ID` response header, so include it in support requests:

```bash
curl -sS -i "$PREDINEX_API_URL/api/does-not-exist"
```

Example `404` response:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Unknown route",
    "correlationId": "7f7f2f2c-6c4e-4d2e-9c78-0c1bc3d65b3a"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Unexpected failures return `500 INTERNAL_ERROR` with the same correlation
fields:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "correlationId": "7f7f2f2c-6c4e-4d2e-9c78-0c1bc3d65b3a"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

> Note: `POST /api/gas-estimate/estimate` currently uses a simpler error body
> for invalid input, for example
> `{"success": false, "error": "Missing required fields: operation and contractId"}`.

### Rate limits

Every request is rate-limited. Responses include `RateLimit-Limit`,
`RateLimit-Remaining`, and `RateLimit-Reset` (seconds until the window
resets). A throttled request returns `429` with `Retry-After` in seconds:

```bash
curl -sS -i "$PREDINEX_API_URL/api/markets"
```

Example throttled response headers:

```text
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 37
Retry-After: 37
X-API-Version: v1
```

Example `429` response body:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests, please retry later",
    "retryAfter": 37
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Wait at least `Retry-After` seconds before retrying. Do not rotate unknown API
keys to escape the limit; only registered keys receive their own bucket.

## Health and readiness probes

Use `/healthz` for liveness, `/readyz` for readiness, and `/health` for a
detailed dependency report. `/api/health` returns the same detailed payload
as `/health`.

### Liveness probe

Always `200` while the process is up. Keep this probe cheap; it does not call
dependencies.

```bash
curl -sS "$PREDINEX_API_URL/healthz"
```

```json
{
  "status": "ok"
}
```

### Readiness probe

`200` only when required configuration and API state are available; otherwise
`503` with the failing checks.

```bash
curl -sS -i "$PREDINEX_API_URL/readyz"
```

Example `200` response:

```json
{
  "status": "ok",
  "checks": {
    "config": {
      "ok": true
    },
    "api": {
      "ok": true
    }
  }
}
```

Example `503` response:

```json
{
  "status": "unavailable",
  "checks": {
    "config": {
      "ok": false,
      "reason": "missing env vars: NODE_ENV"
    },
    "api": {
      "ok": true
    }
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### Detailed health

`/health` reports the cached status of the `database`, `rpc`, and `queue`
dependencies. A dependency that is not configured is reported as healthy with
the detail `not configured`. A degraded dependency changes the top-level
status to `degraded` and the HTTP status to `503`.

```bash
curl -sS "$PREDINEX_API_URL/health"
```

```json
{
  "success": true,
  "status": "healthy",
  "service": "predinex-api",
  "version": "1.0.0",
  "uptimeSecs": 3725,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "dependencies": {
    "database": {
      "status": "healthy",
      "detail": "not configured"
    },
    "rpc": {
      "status": "healthy",
      "detail": "not configured"
    },
    "queue": {
      "status": "healthy",
      "detail": "not configured"
    }
  },
  "healthCachedAt": "2026-01-01T00:00:00.000Z"
}
```

## Common endpoints

### List markets

Lists visible markets in ascending market id order by default. Supported query
parameters are `limit` (1-100), `offset`, `status`, `sort`, and `order`.
Cancelled markets require admin credentials.

```bash
curl -sS --get "$PREDINEX_API_URL/api/markets" \
  --data-urlencode "limit=2" \
  --data-urlencode "offset=0" \
  --data-urlencode "status=open" \
  --data-urlencode "sort=expiry" \
  --data-urlencode "order=asc"
```

Example `200` response:

```json
{
  "success": true,
  "data": [
    {
      "id": 21,
      "title": "Will BTC close above $100k?",
      "outcomes": ["Yes", "No"],
      "status": "open",
      "expiry": 1767225600,
      "totalVolume": "21000"
    },
    {
      "id": 22,
      "title": "Will the protocol ship v2 in Q1?",
      "outcomes": ["Yes", "No"],
      "status": "open",
      "expiry": 1767312000,
      "totalVolume": "8450"
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 2,
    "offset": 0,
    "count": 2,
    "hasMore": true,
    "nextOffset": 2,
    "prevOffset": null,
    "page": 1,
    "pageSize": 2
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### List events

Lists indexed `place_bet` events in ledger order. Use the opaque
`pagination.nextCursor` value to fetch the next page. Do not combine `cursor`
and `offset`; `offset` is retained only for legacy callers.

```bash
curl -sS --get "$PREDINEX_API_URL/api/events" \
  --data-urlencode "limit=1"
```

Example `200` response:

```json
{
  "success": true,
  "data": [
    {
      "eventId": "evt-12345-2",
      "eventIndex": 2,
      "market": 21,
      "account": "GCKXGKV5GFLMJ5QBSIHEYAFCZQ37BH72QKJWU4CEWHZOLYEY3TS4YKVK",
      "outcome": 0,
      "amount": "10000000",
      "totalYes": "21000000",
      "totalNo": "17000000",
      "txHash": "0x8d2f1a6c9b4e7d305a1f6c2b9e8d7a4f3c2b1a0e9d8c7b6a5f4e3d2c1b0a9f8e",
      "ledgerSeq": 12345
    }
  ],
  "pagination": {
    "total": 84,
    "limit": 1,
    "offset": 0,
    "count": 1,
    "hasMore": true,
    "nextOffset": 1,
    "cursor": null,
    "nextCursor": "eyJsZWRnZXJTZXEiOjEyMzQ1LCJldmVudEluZGV4IjoyLCJldmVudElkIjoiZXZ0LTEyMzQ1LTIifQ"
  },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

Fetch the next page with the returned cursor:

```bash
NEXT_CURSOR='eyJsZWRnZXJTZXEiOjEyMzQ1LCJldmVudEluZGV4IjoyLCJldmVudElkIjoiZXZ0LTEyMzQ1LTIifQ'

curl -sS --get "$PREDINEX_API_URL/api/events" \
  --data-urlencode "cursor=$NEXT_CURSOR" \
  --data-urlencode "limit=1"
```

When `pagination.nextCursor` is `null`, the last page has been reached. Events
added after the first page are picked up on a later cursor page when their
ledger position follows the cursor.

### Estimate gas

Estimate Soroban resources for a known operation. `operation` and `contractId`
are required; `parameters` and `rpcUrl` are optional. Supported operations
include `create_pool`, `place_bet`, `settle_pool`, `claim_winnings`,
`cancel_bet`, `extend_pool`, `batch_settle`, and `claim_all_winnings`.

```bash
curl -sS -X POST "$PREDINEX_API_URL/api/gas-estimate/estimate" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "place_bet",
    "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "rpcUrl": "https://soroban-testnet.stellar.org",
    "parameters": {
      "pool_id": 21,
      "outcome": 0,
      "amount": 10000
    }
  }'
```

Example `200` response:

```json
{
  "success": true,
  "estimate": {
    "operation": "place_bet",
    "estimatedInstructions": 8000,
    "estimatedCpuCost": 200000,
    "estimatedMemoryCost": 1000,
    "estimatedStorageCost": 330,
    "totalCost": 302145,
    "optimizationLevel": "high",
    "timestamp": 1767225600000
  }
}
```

Costs and timestamps are estimates and change with the operation and
parameters. A missing field returns
`{"error": "Missing required fields: operation and contractId"}` with HTTP
`400`; an unknown operation returns a `400` response whose `error` string lists
the supported operations.

### Get a reputation profile

Returns the stored profile for a Stellar account. New accounts receive a
default Bronze profile with a score of `300`; token volumes are decimal
strings to avoid precision loss.

```bash
curl -sS "$PREDINEX_API_URL/api/reputation/profile/GCKXGKV5GFLMJ5QBSIHEYAFCZQ37BH72QKJWU4CEWHZOLYEY3TS4YKVK"
```

Example `200` response for a new account:

```json
{
  "success": true,
  "data": {
    "user": "GCKXGKV5GFLMJ5QBSIHEYAFCZQ37BH72QKJWU4CEWHZOLYEY3TS4YKVK",
    "score": 300,
    "tier": "Bronze",
    "totalBorrowedVolume": "0",
    "totalRepaidVolume": "0",
    "onTimeRepaymentsCount": 0,
    "lateRepaymentsCount": 0,
    "liquidationCount": 0,
    "defaultCount": 0,
    "lastActivityTime": 1767225600,
    "ltvBoostBps": 0,
    "rateDiscountBps": 0
  },
  "timestamp": 1767225600000
}
```

An invalid address returns `400 INVALID_ADDRESS`; a missing address returns
`400 MISSING_ADDRESS`.

## Pagination

| Endpoint | Style | Continue with |
|----------|-------|---------------|
| `GET /api/markets` | Offset/limit | `pagination.nextOffset` as `offset` |
| `GET /api/events` | Opaque cursor | `pagination.nextCursor` as `cursor` |

For offset pagination, `hasMore` tells you whether another page exists and
`prevOffset` is `null` on the first page. `page` and `pageSize` mirror the
offset/limit values for convenience.

For cursor pagination, treat `nextCursor` as opaque: do not parse, increment,
or construct it. `cursor` and `offset` cannot be combined, and an empty
`cursor` value starts again at the beginning. On a cursor request, `offset`
and `nextOffset` are `null`.

## Reference

- [OpenAPI document served by the API](../api/schema/openapi.json)
- [API package README](../api/README.md)
- [Incident runbook](./INCIDENT_RUNBOOK.md) for health-check and degraded-service procedures
