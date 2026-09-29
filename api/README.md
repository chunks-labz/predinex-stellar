# Predinex API

RESTful API for the Predinex Lending Protocol — budget, compliance, emergency,
gas estimation, insurance, referral, reputation and simulation modules.

## Quick Start (HTTP server)

A single command starts a process that binds a port and serves every route
module (see #1194):

```bash
npm install
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
`ASSESSOR_API_KEYS`) is read from the environment. Mutating emergency and
compliance routes require an `x-api-key` header with the matching role and
are rate-limited; all routes apply shared auth + rate-limit middleware.

## API Endpoints

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
