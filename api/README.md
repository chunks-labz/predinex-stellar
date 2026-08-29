# Budget Planner API

RESTful API for the Predinex Lending Protocol Budget Planner.

## Quick Start

```bash
npm install
npm run dev
```

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

## Documentation

See `/docs/BUDGET_PLANNER.md` for complete documentation.

## Issue

Implements #1110: Build lending protocol budget planner for lenders
