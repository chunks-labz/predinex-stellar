import { PriceAggregator } from '../price-aggregator';
import { PriceValidator } from '../price-validator';

describe('PriceAggregator', () => {
  it('calculates liquidity-weighted TWAP over the configured window', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300 });

    aggregator.addSample({ pair: 'XLM/USDC', price: 1, liquidity: 100, timestamp: 1_000, source: 'a' });
    aggregator.addSample({ pair: 'XLM/USDC', price: 1.1, liquidity: 300, timestamp: 1_200, source: 'b' });
    aggregator.addSample({ pair: 'XLM/USDC', price: 1.2, liquidity: 100, timestamp: 1_400, source: 'c' });

    const twap = aggregator.calculateTwap('XLM/USDC', 1_450);

    expect(twap.twap).toBeCloseTo(1.1);
    expect(twap.samples).toBe(3);
    expect(twap.windowSecs).toBe(400);
  });

  it('rejects manipulated spot prices outside TWAP deviation limits', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300, maxDeviationBps: 100 });

    aggregator.addSample({ pair: 'XLM/USDC', price: 1, liquidity: 100, timestamp: 1_000, source: 'a' });
    aggregator.addSample({ pair: 'XLM/USDC', price: 1, liquidity: 100, timestamp: 1_200, source: 'b' });
    aggregator.addSample({ pair: 'XLM/USDC', price: 1, liquidity: 100, timestamp: 1_400, source: 'c' });

    const result = aggregator.validateSpotPrice('XLM/USDC', 1.05, 1_450);

    expect(result.valid).toBe(false);
    expect(result.deviationBps).toBe(500);
  });
});

describe('PriceValidator', () => {
  it('accepts bounded rate and utilization changes', () => {
    const validator = new PriceValidator();

    const result = validator.validateRateUpdate(
      { asset: 'XLM', rateBps: 500, utilizationBps: 4_000, timestamp: 1_000 },
      { asset: 'XLM', rateBps: 550, utilizationBps: 4_500, timestamp: 1_100 },
      1_120
    );

    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('rejects abrupt rate manipulation attempts', () => {
    const validator = new PriceValidator({ maxDeltaBps: 100 });

    const result = validator.validateRateUpdate(
      { asset: 'XLM', rateBps: 500, utilizationBps: 4_000, timestamp: 1_000 },
      { asset: 'XLM', rateBps: 800, utilizationBps: 4_100, timestamp: 1_100 },
      1_120
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('rate delta exceeds manipulation threshold');
  });
});
