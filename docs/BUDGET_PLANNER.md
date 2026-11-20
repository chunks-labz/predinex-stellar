# Lending Protocol Budget Planner

## Overview

The Budget Planner is a comprehensive financial planning tool for lenders in the Predinex prediction market protocol. It helps lenders optimize capital allocation, project returns, manage risks, and make data-driven investment decisions.

## Features

### 1. Budget Plan Creation
Create customized budget plans with multiple allocation strategies:
- **Equal Weight**: Distribute capital equally across all eligible pools
- **Size Weighted**: Allocate more to larger, more liquid pools
- **Return Weighted**: Prioritize pools with higher expected returns
- **Risk Adjusted**: Balance returns against risk (Sharpe ratio)
- **Custom**: Define your own allocation weights

### 2. Portfolio Analytics
Track comprehensive portfolio metrics:
- Total invested capital
- Current portfolio value
- Total returns (absolute and percentage)
- Fee revenue earned
- Number of active and settled pools
- Risk-adjusted returns (Sharpe ratio)

### 3. Liquidity Management
Project liquidity needs over time:
- Current liquid balance
- Locked capital and unlock dates
- Expected returns (7-day and 30-day projections)
- Minimum reserve requirements
- Excess capacity for new opportunities

### 4. Fee Optimization
Get data-driven fee recommendations:
- Market competitive analysis
- Volume impact projections
- Revenue impact estimates
- Competitiveness scoring

### 5. Risk Assessment
Comprehensive risk analysis:
- Volatility scoring
- Liquidity risk evaluation
- Concentration risk measurement
- Time-to-expiry risk
- Overall portfolio risk score

## Architecture

### Contract Module (`budget_planner.rs`)

Pure functions for budget calculations and analytics:

```rust
pub struct BudgetPlanner;

impl BudgetPlanner {
    // Create optimal budget plan
    pub fn create_plan(...) -> Result<BudgetPlan, ContractError>
    
    // Get portfolio metrics
    pub fn get_portfolio_metrics(...) -> Result<PortfolioMetrics, ContractError>
    
    // Project liquidity
    pub fn project_liquidity(...) -> Result<LiquidityProjection, ContractError>
    
    // Optimize fees
    pub fn optimize_fees(...) -> Result<FeeOptimization, ContractError>
    
    // Assess risk
    pub fn assess_risk(...) -> Result<RiskAssessment, ContractError>
}
```

### API Layer (`api/src/routes/budget.ts`)

RESTful API endpoints for web integration:

- `POST /api/budget/plan` - Create budget plan
- `GET /api/budget/portfolio/:address` - Get portfolio metrics
- `GET /api/budget/liquidity/:address` - Project liquidity
- `POST /api/budget/optimize-fees` - Optimize fee structure
- `POST /api/budget/risk-assessment` - Assess risk
- `GET /api/budget/health` - Health check

## Usage Examples

### Creating a Budget Plan

**API Request:**
```typescript
POST /api/budget/plan
Content-Type: application/json

{
  "lenderAddress": "GABC...XYZ",
  "totalBudget": "100000000000",
  "strategy": "risk_adjusted",
  "riskTolerance": "moderate",
  "reservePct": 15
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "lender": "GABC...XYZ",
    "totalBudget": "100000000000",
    "allocatedAmount": "85000000000",
    "reserveAmount": "15000000000",
    "allocations": [
      {
        "poolId": 1,
        "allocatedAmount": "28333333333",
        "weightPct": 33.33,
        "expectedReturn": "2833333333",
        "riskScore": 30
      },
      ...
    ],
    "strategy": "risk_adjusted",
    "expectedTotalReturn": "8500000000",
    "portfolioRiskScore": 35,
    "diversificationScore": 78,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Getting Portfolio Metrics

**API Request:**
```typescript
GET /api/budget/portfolio/GABC...XYZ
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalInvested": "100000000000",
    "currentValue": "108000000000",
    "totalReturn": "8000000000",
    "returnPct": 8.0,
    "feeRevenue": "2000000000",
    "activePools": 5,
    "settledPools": 12,
    "sharpeRatio": 1.25,
    "lastUpdated": "2024-01-15T10:30:00Z"
  }
}
```

### Optimizing Fees

**API Request:**
```typescript
POST /api/budget/optimize-fees
Content-Type: application/json

{
  "currentFeeBps": 300,
  "avgPoolSize": "50000000000",
  "competitorFees": [250, 280, 320, 300, 275]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "currentFeeBps": 300,
    "recommendedFeeBps": 271,
    "expectedVolumeImpactPct": 19.33,
    "expectedRevenueImpact": "1217500000",
    "competitivenessScore": 58
  }
}
```

## Security Measures

### 1. Input Validation
- All monetary amounts validated as positive integers
- Address format validation (Stellar G-address)
- Percentage ranges enforced (0-100)
- Strategy and risk tolerance enum validation

### 2. Overflow Protection
- Checked arithmetic in all calculations
- BigInt usage for large monetary values
- Safe division with zero checks

### 3. Access Control
- Authentication required for all endpoints
- Rate limiting (100 requests/hour per IP)
- Address-based authorization

### 4. Read-Only Operations
- Budget planner never mutates contract state
- All operations are analytical/advisory only
- Actual capital allocation requires separate transactions

### 5. Error Handling
- Graceful error responses
- No sensitive data in error messages
- Detailed logging for debugging (server-side only)

## Performance Benchmarks

### API Response Times (Target)
- Budget plan creation: < 500ms
- Portfolio metrics: < 200ms
- Liquidity projection: < 300ms
- Fee optimization: < 150ms
- Risk assessment: < 250ms

### Scalability
- Handles 100+ concurrent requests
- Supports portfolios with 50+ pools
- Scales linearly with pool count

## Integration Guide

### Prerequisites
- Node.js 18+ for API server
- TypeScript 5+
- Express.js framework
- Stellar SDK

### Installation

```bash
# Install dependencies
cd api
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Build
npm run build

# Run tests
npm test

# Start server
npm start
```

### Environment Variables

```bash
# Server configuration
PORT=3000
NODE_ENV=production

# Stellar configuration
STELLAR_NETWORK=public
STELLAR_HORIZON_URL=https://horizon.stellar.org
CONTRACT_ID=C...

# Security
API_KEY_SECRET=your-secret-key
RATE_LIMIT_WINDOW_MS=3600000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=https://yourapp.com
```

### Authentication Example

```typescript
import jwt from 'jsonwebtoken';

// Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.API_KEY_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Apply to routes
app.use('/api/budget', authenticate, budgetRouter);
```

## Testing

### Running Tests

```bash
# Unit tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Coverage

- API routes: >85%
- Contract module: >80%
- Integration tests: All critical paths

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/budget/health
```

### Metrics to Monitor
- API response times
- Error rates
- Request volume
- Cache hit rates
- Database query performance

## Troubleshooting

### Common Issues

**Issue**: "Invalid address format"  
**Solution**: Ensure Stellar address starts with 'G' and is 56 characters

**Issue**: "Budget must be positive"  
**Solution**: totalBudget must be > 0

**Issue**: "Rate limit exceeded"  
**Solution**: Wait for rate limit window to reset or contact support

## Future Enhancements

- Machine learning for return predictions
- Historical backtesting
- Automated rebalancing recommendations
- Tax optimization features
- Multi-currency support
- Advanced portfolio analytics dashboard

## Related Documentation

- `/docs/API_REFERENCE.md` - Complete API documentation
- `/contracts/predinex/src/budget_planner.rs` - Contract implementation
- `/api/src/routes/budget.ts` - API implementation

## Support

For issues or questions:
- GitHub Issues: https://github.com/chunks-labz/predinex-stellar/issues
- Discord: https://discord.gg/predinex

## License

MIT License - see LICENSE file for details

## Changelog

### v1.0.0 (2024-01-15)
- Initial release
- Budget plan creation with 5 strategies
- Portfolio metrics tracking
- Liquidity projections
- Fee optimization
- Risk assessment
- RESTful API
- Comprehensive documentation

## Contributors

- Implementation: morelucks (luckykamshak@gmail.com)
- Issue: #1110 from chunks-labz/predinex-stellar
- Original: Smartdevs17/stellarlend#856
