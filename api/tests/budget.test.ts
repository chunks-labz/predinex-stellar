import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createBudgetRouter,
  ContractService,
  AllocationStrategy,
  RiskTolerance,
} from '../src/routes/budget.js';

describe('Budget Planner Route (Issue #1198)', () => {
  let app: express.Express;
  let service: ContractService;
  const testLender = 'GAX765YUVH7654321012345678901234567890123456789012345678';

  beforeEach(() => {
    service = new ContractService();
    app = express();
    app.use(express.json());
    app.use('/api/budget', createBudgetRouter(service));
  });

  it('rejects a budget that exceeds the on-chain balance with 400', async () => {
    // Lender on-chain balance is 1,000,000 stroops
    service.setBalanceProvider(async (_addr) => 1_000_000n);

    // Requesting 5,000,000 stroops (exceeds balance)
    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: testLender,
        totalBudget: '5000000',
        strategy: AllocationStrategy.EQUAL_WEIGHT,
        riskTolerance: RiskTolerance.MODERATE,
        reservePct: 10,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Budget exceeds available on-chain balance');
  });

  it('returns 501 when pool allocations cannot be derived from on-chain state', async () => {
    // Lender has ample on-chain balance
    service.setBalanceProvider(async (_addr) => 100_000_000n);
    // But on-chain pool query is not wired (no live contract connection)
    service.setPoolProvider(async () => null);

    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: testLender,
        totalBudget: '1000000',
        strategy: AllocationStrategy.EQUAL_WEIGHT,
        riskTolerance: RiskTolerance.MODERATE,
        reservePct: 10,
      });

    // Must return 501 rather than fabricated mock allocations
    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('On-chain pool state derivation requires an active Stellar contract connection');
  });

  it('derives allocations from real on-chain pool state when available', async () => {
    service.setBalanceProvider(async (_addr) => 100_000_000n);
    service.setPoolProvider(async () => [
      {
        poolId: 101,
        allocatedAmount: '450000',
        weightPct: 50,
        expectedReturn: '45000',
        riskScore: 20,
      },
      {
        poolId: 102,
        allocatedAmount: '450000',
        weightPct: 50,
        expectedReturn: '50000',
        riskScore: 25,
      },
    ]);

    const res = await request(app)
      .post('/api/budget/plan')
      .send({
        lenderAddress: testLender,
        totalBudget: '1000000',
        strategy: AllocationStrategy.EQUAL_WEIGHT,
        riskTolerance: RiskTolerance.MODERATE,
        reservePct: 10,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.allocations.length).toBe(2);
    expect(res.body.data.allocations[0].poolId).toBe(101);
  });

  it('returns 501 for unimplemented on-chain queries', async () => {
    const portfolioRes = await request(app).get(`/api/budget/portfolio/${testLender}`);
    expect(portfolioRes.status).toBe(501);

    const liquidityRes = await request(app).get(`/api/budget/liquidity/${testLender}`);
    expect(liquidityRes.status).toBe(501);

    const riskRes = await request(app).post('/api/budget/risk-assessment').send({ poolIds: [1, 2] });
    expect(riskRes.status).toBe(501);
  });
});
