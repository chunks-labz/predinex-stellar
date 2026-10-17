# Predinex API

RESTful API for the Predinex Lending Protocol — budget, compliance, emergency,
gas estimation, insurance, referral, reputation and simulation modules.

## Quick Start (HTTP server)

A single command starts a process that binds a port and serves every route
module (see #1194):

```bash
npm install
cp .env.example .env   # then set AUTH_SECRET, e.g. `openssl rand -hex 32`
npm run build
npm start
# -> predinex-api listening on :3001 (health: GET /health)
```

Development with reload:

```bash
npm run dev
```

Health probes:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/health
```

OpenAPI document served live:

```bash
curl http://localhost:3001/api/openapi.json
```

Configuration (`PORT`, `AUTH_SECRET`, `ADMIN_API_KEYS`, `OFFICER_API_KEYS`,
`ASSESSOR_API_KEYS`) is read from the environment; see `.env.example`.
`AUTH_SECRET` is required: the HMAC secret has no built-in default, so the
server refuses to start when it is missing or blank, and `AuthValidator`
rejects the publicly known value that older releases fell back to. Use a
fresh random value per deployment. The test suite generates a random
`AUTH_SECRET` per run in `vitest.config.ts`. Mutating emergency and
compliance routes require an `x-api-key` header with the matching role and
are rate-limited; all routes apply shared auth + rate-limit middleware.

### Rate limiting

Every route is rate-limited. Callers sending an `x-api-key` registered in
`ADMIN_API_KEYS`, `OFFICER_API_KEYS` or `ASSESSOR_API_KEYS` get their own
bucket; everyone else is limited per client IP (unregistered keys do not get a
separate bucket, so rotating them does not bypass the limit). Responses carry
`RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; a throttled
request gets HTTP `429` with a `Retry-After` header (seconds).

| Variable | Default | Meaning |
|----------|---------|---------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window length in milliseconds |
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Requests per window on general routes |
| `RATE_LIMIT_STRICT_MAX_REQUESTS` | `20` | Requests per window on mutating / emergency routes |

Values that are missing or not positive integers fall back to the default.

### Tracing (OpenTelemetry)

Tracing is opt-in and disabled by default; nothing is exported unless
`OTEL_TRACING_ENABLED=true`. When enabled, every HTTP request gets a span and
spans are sent to an OTLP/HTTP collector chosen with the standard
`OTEL_EXPORTER_OTLP_ENDPOINT` variable. Incoming W3C `traceparent` headers are
continued, and `injectTraceHeaders()` / `withSpan()` in
`src/middleware/tracing.ts` propagate the context outward and wrap DB calls or
indexer jobs. The API has no database or indexer code today, so only HTTP
spans are emitted automatically.

| Variable | Default | Meaning |
|----------|---------|---------|
| `OTEL_TRACING_ENABLED` | `false` | Set to `true` to export traces |
| `OTEL_SERVICE_NAME` | `predinex-api` | Service name reported on spans |

## API Endpoints

### GET /api/markets
List markets one page at a time, ordered by ascending market id.

Query parameters: `limit` (1-100, default 20; larger values are capped at 100)
and `offset` (default 0). Invalid values return `400 VALIDATION_ERROR`. An
offset past the end returns an empty `data` array.

**Response:**
```json
{
  "success": true,
  "data": [{ "id": 21, "title": "...", "outcomes": ["Yes", "No"], "status": "open", "expiry": 1700000021, "totalVolume": "21000" }],
  "pagination": { "total": 45, "limit": 10, "offset": 20, "count": 10, "hasMore": true, "nextOffset": 30, "prevOffset": 10 },
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### POST /api/markets
Validate a market creation request. Body: `title` (non-empty, at most 100
bytes), `outcomes` (2-20 unique non-empty strings, each at most 50 bytes) and
`closeTime` (integer unix seconds, 300 s to 31,536,000 s from now). These limits
mirror the contract and live in `src/services/market-validation.ts`.

Invalid payloads return `400 VALIDATION_ERROR` with one `error.details` entry
(`{ field, message }`) per violated field. Valid payloads are passed unchanged
to the configured market creator and return `201`; until on-chain creation is
wired in they return `501`.

### POST /api/budget/plan
Create a budget plan

**Request:**
```json
{
  "lenderAddress": "GABC...XYZ",
  "totalBudget": "100000000000",
  "strategy": "risk_adjusted",
  "riskTolerance": "moderate",
  "reservePct": 15
}
```

### GET /api/budget/portfolio/:address
Get portfolio metrics

### GET /api/budget/liquidity/:address
Project liquidity

### POST /api/budget/optimize-fees
Optimize fee structure

### POST /api/budget/risk-assessment
Assess portfolio risk

### GET /api/budget/health
Health check

### Emergency (real on-chain transactions, admin-gated)

- POST /api/emergency/activate
- POST /api/emergency/deactivate
- POST /api/emergency/withdraw/request
- POST /api/emergency/withdraw/approve
- POST /api/emergency/withdraw/execute
- POST /api/emergency/withdraw/cancel
- POST /api/emergency/admin/add
- POST /api/emergency/config/update
- GET /api/emergency/config
- GET /api/emergency/status
- GET /api/emergency/audit-logs

### Gas estimation

- POST /api/gas-estimate/estimate
- POST /api/gas-estimate/suggestions
- POST /api/gas-estimate/report

### Referral (explicit stub — 501 until on-chain wiring)

- POST /api/referral
- GET /api/referral/health

### Simulation / Insurance / Compliance / Reputation

- POST /api/simulation/simulate, POST /api/simulation/position-health
- GET /api/insurance/pools, POST /api/insurance/quote, POST /api/insurance/purchase, POST /api/insurance/claim, GET /api/insurance/audit/:poolId
- POST /api/compliance/verify, POST /api/compliance/register (officer/admin), GET /api/compliance/status/:address
- GET /api/reputation/profile/:address, POST /api/reputation/simulate, GET /api/reputation/leaderboard

## Testing

Vitest is the authoritative test runner for the API package, standardizing testing across all TypeScript packages in the repository (`web`, `bot`, `api`).

Run the test suite:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

Generate coverage report:
```bash
npm run test:coverage
```

## Documentation

See `/docs/BUDGET_PLANNER.md` for complete documentation.

## Issue

Implements #1110: Build lending protocol budget planner for lenders
