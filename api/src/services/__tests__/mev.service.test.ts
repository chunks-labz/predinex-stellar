import { MevProtectionService, PendingLendingOperation, PoolQuote } from '../mev.service';

const operation: PendingLendingOperation = {
  id: 'op-1',
  actor: 'GACTOR',
  poolId: 'pool-1',
  asset: 'XLM',
  side: 'borrow',
  amount: 1_000,
  submittedAt: 1_000,
  maxAcceptablePrice: 1.02,
};

const quote: PoolQuote = {
  poolId: 'pool-1',
  asset: 'XLM',
  quotedPrice: 1,
  expectedExecutionPrice: 1.005,
  liquidityDepth: 1_000_000,
  observedAt: 1_020,
};

describe('MevProtectionService', () => {
  it('allows low-impact operations after the minimum delay', () => {
    const service = new MevProtectionService();

    const result = service.evaluateOperation(operation, quote, 1_040);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toEqual([]);
    expect(result.priceImpactBps).toBe(10);
  });

  it('blocks oversized operations that can move the pool price', () => {
    const service = new MevProtectionService({ maxPriceImpactBps: 100 });

    const result = service.evaluateOperation(
      { ...operation, amount: 250_000 },
      quote,
      1_040
    );

    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('price impact exceeds configured limit');
  });

  it('requires an execution delay before releasing an operation', () => {
    const service = new MevProtectionService({ minOrderDelaySecs: 60 });

    const result = service.evaluateOperation(operation, quote, 1_040);

    expect(result.decision).toBe('review');
    expect(result.earliestExecutionAt).toBe(1_060);
    expect(result.reasons).toContain('minimum order delay has not elapsed');
  });

  it('blocks stale quotes', () => {
    const service = new MevProtectionService({ staleQuoteSecs: 10 });

    const result = service.evaluateOperation(operation, quote, 1_040);

    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('quote is stale');
  });

  it('blocks operations surrounded by high-slippage trades', () => {
    const service = new MevProtectionService({ maxSlippageBps: 50 });

    const result = service.evaluateOperation(operation, quote, 1_040, [
      { ...operation, id: 'front-run', actor: 'G1', executedAt: 995, executionPrice: 1.02 },
      { ...operation, id: 'back-run', actor: 'G2', executedAt: 1_010, executionPrice: 0.98 },
    ]);

    expect(result.decision).toBe('block');
    expect(result.reasons).toContain('recent surrounding trades indicate sandwich risk');
  });
});
