import { describe, it, expect } from 'vitest';
import { PriceAggregator, PriceValidationError } from '../price-aggregator';
import { PriceValidator } from '../price-validator';

const PAIR = 'XLM/USDC';

function seedHealthyWindow(aggregator: PriceAggregator): void {
  aggregator.addSample({ pair: PAIR, price: 1, liquidity: 100, timestamp: 1_000, source: 'a' });
  aggregator.addSample({ pair: PAIR, price: 1.1, liquidity: 100, timestamp: 1_200, source: 'b' });
  aggregator.addSample({ pair: PAIR, price: 1.2, liquidity: 100, timestamp: 1_400, source: 'c' });
}

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

describe('PriceAggregator guarded divisors (issue #1307)', () => {
  it('rejects an empty window instead of dividing by an empty sample set', () => {
    const aggregator = new PriceAggregator();

    expect(() => aggregator.calculateTwap(PAIR, 1_450)).toThrowError(PriceValidationError);
    expect(() => aggregator.calculateTwap(PAIR, 1_450)).toThrowError(
      expect.objectContaining({ code: 'insufficient_samples' })
    );
    expect(() => aggregator.validateSpotPrice(PAIR, 1.1, 1_450)).toThrowError(
      PriceValidationError
    );
  });

  it('rejects a window whose samples have all aged out of retention', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300, maxSampleAgeSecs: 900 });

    seedHealthyWindow(aggregator);

    // now - timestamp exceeds maxSampleAgeSecs for every sample, so the
    // filtered set is empty and must not reach the weighted average.
    expect(() => aggregator.calculateTwap(PAIR, 100_000)).toThrowError(
      expect.objectContaining({ code: 'insufficient_samples' })
    );
  });

  it('rejects an empty filtered sample set even when minSamples is zero', () => {
    // A zero minSamples must not let an empty window fall through to indexing
    // an undefined first/last sample and then to a zero divisor.
    const aggregator = new PriceAggregator({ minSamples: 0, minWindowSecs: 300 });

    expect(() => aggregator.calculateTwap(PAIR, 1_450)).toThrowError(
      expect.objectContaining({ code: 'no_active_samples' })
    );
  });

  it('rejects a non-finite total liquidity rather than dividing into Infinity', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300 });

    // Individually finite weights that overflow to Infinity once summed.
    aggregator.addSample({ pair: PAIR, price: 1, liquidity: 1e308, timestamp: 1_000, source: 'a' });
    aggregator.addSample({ pair: PAIR, price: 1, liquidity: 1e308, timestamp: 1_200, source: 'b' });
    aggregator.addSample({ pair: PAIR, price: 1, liquidity: 1e308, timestamp: 1_400, source: 'c' });

    expect(() => aggregator.calculateTwap(PAIR, 1_450)).toThrowError(
      expect.objectContaining({ code: 'zero_total_liquidity' })
    );
  });

  it('rejects non-finite samples at ingestion so they never reach the divisor', () => {
    const aggregator = new PriceAggregator();

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() =>
        aggregator.addSample({ pair: PAIR, price: bad, liquidity: 100, timestamp: 1_000, source: 'a' })
      ).toThrowError(expect.objectContaining({ code: 'invalid_sample' }));

      expect(() =>
        aggregator.addSample({ pair: PAIR, price: 1, liquidity: bad, timestamp: 1_000, source: 'a' })
      ).toThrowError(expect.objectContaining({ code: 'invalid_sample' }));
    }
  });

  it('rejects a TWAP that is not a finite positive price', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300 });

    // Finite price and liquidity whose product overflows: the weights sum to a
    // finite 3e307, but price * liquidity is Infinity, so the TWAP is not usable.
    aggregator.addSample({ pair: PAIR, price: 1e308, liquidity: 1e307, timestamp: 1_000, source: 'a' });
    aggregator.addSample({ pair: PAIR, price: 1e308, liquidity: 1e307, timestamp: 1_200, source: 'b' });
    aggregator.addSample({ pair: PAIR, price: 1e308, liquidity: 1e307, timestamp: 1_400, source: 'c' });

    expect(() => aggregator.calculateTwap(PAIR, 1_450)).toThrowError(
      expect.objectContaining({ code: 'non_finite_twap' })
    );
    expect(() => aggregator.validateSpotPrice(PAIR, 1.1, 1_450)).toThrowError(
      expect.objectContaining({ code: 'non_finite_twap' })
    );
  });

  it('never reports a NaN deviation as valid', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300, maxDeviationBps: 100 });

    seedHealthyWindow(aggregator);

    // Math.round(NaN) is NaN, and NaN <= 100 is false — so a NaN that reached the
    // comparison would be reported as invalid, while NaN against a differently
    // written guard could pass. Either way it must not be reported as valid.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0]) {
      expect(() => aggregator.validateSpotPrice(PAIR, bad, 1_450)).toThrowError(
        expect.objectContaining({ code: 'non_finite_spot_price' })
      );
    }
  });

  it('keeps accepting a healthy window and a well-formed deviation', () => {
    const aggregator = new PriceAggregator({ minWindowSecs: 300, maxDeviationBps: 100 });

    seedHealthyWindow(aggregator);

    const result = aggregator.validateSpotPrice(PAIR, 1.1, 1_450);

    expect(result.valid).toBe(true);
    expect(Number.isFinite(result.deviationBps)).toBe(true);
    expect(result.deviationBps).toBe(0);
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
