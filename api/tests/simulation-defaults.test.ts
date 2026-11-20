import { describe, it, expect } from 'vitest';
import { SimulationRouteHandler } from '../src/routes/simulation.js';
import { SimulationEngine } from '../src/services/simulation-engine.js';
import { SecuritySanitizer } from '../src/middleware/security.js';

// Issues #1214 and #1215: an explicit 0 is a value, only an absent or
// unparseable field takes the documented default, and nothing is substituted
// silently.

const collateral = (overrides: Record<string, unknown> = {}) => ({
  asset: 'XLM',
  amount: '1000',
  priceUsd: 1,
  liquidationThresholdBps: 8000,
  collateralFactorBps: 7500,
  ...overrides,
});

function simulate(collaterals: any[], borrows: any[] = []) {
  const res = SimulationRouteHandler.handleSimulate({ collaterals, borrows });
  expect(res.success, JSON.stringify(res.error)).toBe(true);
  return res.data!;
}

describe('#1214 collateralFactorBps: absent vs zero', () => {
  it('accepts 0: max borrowable is 0, not the 7500 default', () => {
    expect(simulate([collateral({ collateralFactorBps: 0 })]).maxBorrowableUsd).toBe(0);
  });

  it('accepts "0" sent as a string', () => {
    expect(simulate([collateral({ collateralFactorBps: '0' })]).maxBorrowableUsd).toBe(0);
  });

  it('defaults to 7500 when the field is undefined', () => {
    const data = simulate([collateral({ collateralFactorBps: undefined })]);
    expect(data.maxBorrowableUsd).toBe(750);
  });

  it('defaults to 7500 for null, empty and unparseable values', () => {
    for (const bad of [null, '', '   ', 'abc', NaN, {}, [], '12abc']) {
      expect(simulate([collateral({ collateralFactorBps: bad })]).maxBorrowableUsd, String(bad)).toBe(750);
    }
  });

  it('still clamps values above 10000 and below 0', () => {
    expect(simulate([collateral({ collateralFactorBps: 25_000 })]).maxBorrowableUsd).toBe(1000);
    expect(simulate([collateral({ collateralFactorBps: -50 })]).maxBorrowableUsd).toBe(0);
  });

  it('keeps an in-range explicit value untouched', () => {
    expect(simulate([collateral({ collateralFactorBps: 5000 })]).maxBorrowableUsd).toBe(500);
    expect(simulate([collateral({ collateralFactorBps: '5000' })]).maxBorrowableUsd).toBe(500);
  });

  it('applies the same absent-versus-zero rule to liquidationThresholdBps, borrowRateBps and shockBps', () => {
    const debt = { asset: 'USDC', borrowedAmount: '100', priceUsd: 1 };

    // liquidationThresholdBps: 0 must not become 8000 and inflate health.
    const zeroLiq = simulate([collateral({ liquidationThresholdBps: 0 })], [debt]);
    expect(zeroLiq.simulatedLiquidationThresholdUsd).toBe(0);
    const defaultedLiq = simulate([collateral({ liquidationThresholdBps: undefined })], [debt]);
    expect(defaultedLiq.simulatedLiquidationThresholdUsd).toBe(800);

    // borrowRateBps: an explicit 0 (interest-free) is kept and reported as given.
    const zeroRate = simulate([collateral()], [{ ...debt, borrowRateBps: 0 }]);
    expect(zeroRate.warnings?.some((w) => w.field === 'borrowRateBps')).toBeFalsy();
    const missingRate = simulate([collateral()], [{ ...debt }]);
    expect(missingRate.warnings?.find((w) => w.field === 'borrowRateBps')).toMatchObject({
      code: 'DEFAULT_APPLIED',
      appliedValue: 500,
    });
  });

  it('sanitizer helpers keep 0 and flag substitutions', () => {
    expect(SecuritySanitizer.sanitizeBps(0, 7500)).toEqual({ value: 0, defaulted: false });
    expect(SecuritySanitizer.sanitizeBps('0', 7500)).toEqual({ value: 0, defaulted: false });
    expect(SecuritySanitizer.sanitizeBps(undefined, 7500)).toEqual({ value: 7500, defaulted: true });
    expect(SecuritySanitizer.sanitizeBps('abc', 7500)).toEqual({ value: 7500, defaulted: true });
    expect(SecuritySanitizer.sanitizeBps(12_345, 7500)).toEqual({ value: 10_000, defaulted: false });
    expect(SecuritySanitizer.sanitizeBps(-5, 7500, -9999, 100_000)).toEqual({ value: -5, defaulted: false });
    expect(SecuritySanitizer.sanitizeBps(7500.9, 0)).toEqual({ value: 7500, defaulted: false });
    expect(SecuritySanitizer.parseIntegerField(Infinity)).toBeUndefined();
  });
});

describe('#1215 missing or zero liquidation threshold is explicit', () => {
  const debt = { asset: 'USDC', borrowedAmount: '700', priceUsd: 1, borrowRateBps: 500 };

  it('a zero threshold does not inflate the health factor', () => {
    const data = simulate([collateral({ liquidationThresholdBps: 0 })], [debt]);
    expect(data.simulatedHealthFactorBps).toBe(1); // clamped floor: no safety margin at all
    expect(data.isLiquidatable).toBe(true);
    expect(data.simulatedRiskTier).toBe('Liquidatable');
  });

  it('flags an explicit zero threshold distinctly from a missing one', () => {
    const zero = simulate([collateral({ liquidationThresholdBps: 0 })], [debt]).warnings ?? [];
    expect(zero.map((w) => w.code)).toEqual(['ZERO_LIQUIDATION_THRESHOLD']);

    const missing = simulate([collateral({ liquidationThresholdBps: undefined })], [debt]).warnings ?? [];
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      code: 'DEFAULT_APPLIED',
      field: 'liquidationThresholdBps',
      asset: 'XLM',
      appliedValue: 8000,
    });
  });

  it('uses the documented defaults consistently for both factors and reports both', () => {
    const data = simulate([{ asset: 'XLM', amount: '1000', priceUsd: 1 }], [debt]);
    expect(data.simulatedLiquidationThresholdUsd).toBe(800);
    expect(data.maxBorrowableUsd).toBe(50); // 750 capacity - 700 debt
    const fields = (data.warnings ?? []).map((w) => `${w.code}:${w.field}`).sort();
    expect(fields).toEqual(['DEFAULT_APPLIED:collateralFactorBps', 'DEFAULT_APPLIED:liquidationThresholdBps']);
  });

  it('a fully specified request carries no warnings', () => {
    expect(simulate([collateral()], [debt]).warnings).toBeUndefined();
  });

  it('reports one warning per affected collateral asset', () => {
    const data = simulate([
      collateral({ asset: 'XLM', liquidationThresholdBps: undefined }),
      collateral({ asset: 'BTC', liquidationThresholdBps: null }),
      collateral({ asset: 'ETH' }),
    ]);
    expect((data.warnings ?? []).map((w) => w.asset)).toEqual(['XLM', 'BTC']);
  });

  it('a fully specified multi-collateral position matches the exact integer calculation', () => {
    const cols = [
      collateral({ asset: 'XLM', amount: '5000', priceUsd: 1, liquidationThresholdBps: 8000, collateralFactorBps: 7500 }),
      collateral({ asset: 'BTC', amount: '1', priceUsd: 50_000, liquidationThresholdBps: 8500, collateralFactorBps: 8000 }),
    ];
    const data = simulate(cols, [{ asset: 'USDC', borrowedAmount: '20000', priceUsd: 1, borrowRateBps: 500 }]);

    // Integer (BigInt) reference: value * bps / 10_000 per asset.
    const bps = (value: bigint, factor: bigint) => (value * factor) / 10_000n;
    const threshold = bps(5000n, 8000n) + bps(50_000n, 8500n); // 4000 + 42500
    const capacity = bps(5000n, 7500n) + bps(50_000n, 8000n); // 3750 + 40000

    expect(data.simulatedCollateralUsd).toBe(55_000);
    expect(data.simulatedLiquidationThresholdUsd).toBe(Number(threshold));
    expect(data.maxBorrowableUsd).toBe(Number(capacity - 20_000n));
    expect(data.simulatedHealthFactorBps).toBe(Number((threshold * 10_000n) / 20_000n));
    expect(data.isLiquidatable).toBe(false);
  });

  it('the engine itself rejects a missing or invalid factor instead of using 0', () => {
    const base = { asset: 'XLM', amount: '1000', priceUsd: 1, liquidationThresholdBps: 8000, collateralFactorBps: 7500 };
    for (const field of ['liquidationThresholdBps', 'collateralFactorBps'] as const) {
      for (const bad of [undefined, null, 'x', NaN, -1, 10_001]) {
        expect(() => SimulationEngine.calculateHealth([{ ...base, [field]: bad } as any], [])).toThrow(
          new RegExp(`Invalid ${field} for collateral XLM`)
        );
      }
    }
    // Explicit zero is accepted by the engine.
    expect(() => SimulationEngine.calculateHealth([{ ...base, liquidationThresholdBps: 0 }], [])).not.toThrow();
  });
});
