# Budget Balance Provider Wiring

## Issue #1295: Balance Provider Configuration

### Problem

The `/api/budget/plan` endpoint rejected every request with:
```json
{
  "success": false,
  "error": "Budget exceeds available on-chain balance"
}
```

**Root cause:** The `ContractService.getLenderBalance()` method returned `0n` when no balance provider was configured, causing the endpoint to treat every budget as exceeding the (fake) zero balance. The error message was misleading—it suggested the user's budget was too large when the real issue was missing server configuration.

### Why This Happened

1. `getLenderBalance()` had a fallback to `0n` when provider was missing
2. The `/plan` endpoint compared budget against this fabricated zero
3. `totalBudget >= 1` always failed the check
4. Error message blamed user input, not server config
5. Tests never caught it because they injected a mock provider directly

### Solution

Implemented three-part fix:

#### 1. Track Provider Configuration

```typescript
class ContractService {
  private balanceProvider?: BalanceProvider;
  
  public hasBalanceProvider(): boolean {
    return this.balanceProvider !== undefined;
  }
}
```

#### 2. Return 501 Not Implemented

```typescript
// In /api/budget/plan route
if (!contractService.hasBalanceProvider()) {
  return res.status(501).json({
    success: false,
    error: 'On-chain balance provider not configured',
    hint: 'The server has not been configured to query on-chain balances. Contact the administrator.',
  });
}
```

**Status code reasoning:**
- **501 Not Implemented** indicates the server lacks a required capability
- **400 Bad Request** (previous) blamed the client for valid input
- Distinguishes configuration issues from user errors

#### 3. Wire Balance Provider in app.ts

```typescript
import { createBudgetRouter, contractService } from './routes/budget';

async function getStellarBalance(address: string): Promise<bigint> {
  // Implement Stellar SDK call
  const server = new Server('https://horizon.stellar.org');
  const account = await server.loadAccount(address);
  const xlmBalance = account.balances.find(b => b.asset_type === 'native');
  return BigInt(Math.floor(parseFloat(xlmBalance?.balance || '0') * 10000000));
}

// Wire provider before mounting routes
contractService.setBalanceProvider(getStellarBalance);
app.use('/api/budget', createBudgetRouter(contractService));
```

## API Behavior

### Before Fix

```bash
curl -X POST http://HOST/api/budget/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "lenderAddress": "GABC...XYZ",
    "totalBudget": "1",
    "strategy": "equal_weight",
    "riskTolerance": "moderate",
    "reservePct": 10
  }'
```

**Response (misleading):**
```json
{
  "success": false,
  "error": "Budget exceeds available on-chain balance"
}
```

### After Fix (No Provider)

**Response (honest):**
```json
{
  "success": false,
  "error": "On-chain balance provider not configured",
  "hint": "The server has not been configured to query on-chain balances. Contact the administrator."
}
```

**Status:** `501 Not Implemented`

### After Fix (Provider Wired)

**Case 1: Sufficient balance**
```json
{
  "success": true,
  "data": {
    "lender": "GABC...XYZ",
    "totalBudget": "1000000",
    "allocations": [...],
    ...
  }
}
```

**Case 2: Insufficient balance**
```json
{
  "success": false,
  "error": "Budget exceeds available on-chain balance",
  "availableBalance": "500000",
  "requestedBudget": "1000000"
}
```

**Status:** `400 Bad Request` (now legitimately the user's error)

## Implementation Checklist

### Required Changes

- [x] Add `balanceProvider` field to `ContractService`
- [x] Add `setBalanceProvider()` method
- [x] Add `getLenderBalance()` that throws when unconfigured
- [x] Add `hasBalanceProvider()` check method
- [x] Update `/plan` endpoint to return 501 when provider missing
- [x] Update `/plan` endpoint to check actual balance when provider present
- [x] Create `app.ts` with provider wiring
- [x] Document the fix

### Integration Steps

1. **Implement Stellar SDK balance fetcher** (currently mocked in app.ts)
2. **Add error handling** for network failures
3. **Add caching** to avoid RPC spam (consider 30s TTL)
4. **Add retry logic** for transient failures
5. **Add metrics** for balance check latency
6. **Test with real addresses** on testnet

## Testing

### Test Provider Wiring

```typescript
// In tests
import { contractService } from './routes/budget';

describe('Budget API with provider', () => {
  beforeEach(() => {
    contractService.setBalanceProvider(async (addr) => BigInt(1000000000));
  });

  it('accepts budget within balance', async () => {
    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: 'GABC...XYZ',
        totalBudget: '500000',
        strategy: 'equal_weight',
        riskTolerance: 'moderate',
        reservePct: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects budget exceeding balance', async () => {
    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: 'GABC...XYZ',
        totalBudget: '2000000000',
        strategy: 'equal_weight',
        riskTolerance: 'moderate',
        reservePct: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exceeds available on-chain balance');
  });
});

describe('Budget API without provider', () => {
  it('returns 501 when provider not wired', async () => {
    // Don't call setBalanceProvider()
    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: 'GABC...XYZ',
        totalBudget: '1',
        strategy: 'equal_weight',
        riskTolerance: 'moderate',
        reservePct: 10,
      });

    expect(res.status).toBe(501);
    expect(res.body.error).toContain('balance provider not configured');
  });
});
```

### Manual Testing

```bash
# Test without provider (should return 501)
curl -X POST http://localhost:3000/api/budget/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "lenderAddress": "GABC...XYZ",
    "totalBudget": "1",
    "strategy": "equal_weight",
    "riskTolerance": "moderate",
    "reservePct": 10
  }'

# After wiring provider (should check actual balance)
curl -X POST http://localhost:3000/api/budget/plan \
  -H 'Content-Type: application/json' \
  -d '{
    "lenderAddress": "GABC...XYZ",
    "totalBudget": "1000000",
    "strategy": "equal_weight",
    "riskTolerance": "moderate",
    "reservePct": 10
  }'
```

## Production Deployment

### Environment Variables

```bash
# Stellar network configuration
STELLAR_NETWORK=mainnet  # or testnet
STELLAR_HORIZON_URL=https://horizon.stellar.org

# Optional: Balance cache TTL (seconds)
BALANCE_CACHE_TTL=30
```

### Stellar SDK Integration

```typescript
import { Server } from 'stellar-sdk';

const server = new Server(process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org');

async function getStellarBalance(address: string): Promise<bigint> {
  try {
    const account = await server.loadAccount(address);
    const xlmBalance = account.balances.find(
      (b) => b.asset_type === 'native'
    );
    
    if (!xlmBalance) {
      return BigInt(0);
    }

    // Convert XLM to stroops (1 XLM = 10^7 stroops)
    const stroops = Math.floor(parseFloat(xlmBalance.balance) * 10000000);
    return BigInt(stroops);
  } catch (error) {
    console.error(`Failed to fetch balance for ${address}:`, error);
    throw new Error('Failed to query on-chain balance');
  }
}
```

### Error Handling

```typescript
// In /plan endpoint, wrap balance check
try {
  const availableBalance = await contractService.getLenderBalance(
    request.lenderAddress
  );
  
  if (budgetBigInt > availableBalance) {
    return res.status(400).json({
      success: false,
      error: 'Budget exceeds available on-chain balance',
      availableBalance: availableBalance.toString(),
      requestedBudget: request.totalBudget,
    });
  }
} catch (error) {
  console.error('Balance check failed:', error);
  return res.status(503).json({
    success: false,
    error: 'Unable to verify on-chain balance at this time',
    hint: 'The blockchain query service is temporarily unavailable. Please try again.',
  });
}
```

## Related Issues

- #1295: This issue (balance provider not wired)
- #1110: Original budget planner feature
- #1299: Divide-by-zero in optimize-fees endpoint

## Changelog

### v1.1.0 (Fix #1295)
- Added `setBalanceProvider()` to `ContractService`
- Added `getLenderBalance()` with proper error handling
- Added `hasBalanceProvider()` check
- Return 501 when provider not configured
- Return 503 when balance query fails
- Added provider wiring in `app.ts`
- Updated error messages to be honest and actionable

