import { describe, it, expect, beforeEach } from 'vitest';
import { ReputationEngine, UNVERIFIED_PREVIEW_VOLUME_CAP } from '../src/services/reputation-engine.js';
import { ReputationRouteHandler } from '../src/routes/reputation.js';

// Issue #1216: the volume bonus must not come from an unvalidated caller number.

describe('reputation preview: OnTimeRepay volume bonus', () => {
  let engine: ReputationEngine;
  let handler: ReputationRouteHandler;
  const newcomer = 'GCKXGKV5GFLMJ5QBSIHEYAFCZQ37BH72QKJWU4CEWHZOLYEY3TS4YKVK';
  const seeded = 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K';
  const paidOff = 'GDCLUZNKGMR2QWFF6IA66S72SDNISWUUVFDMAIVCOFTE7IIJG7O2VYGQ';
  const whale = 'GCCYW4LHPI4O2XH22SHQH7JC6UTKRMBHWX7J44T7WNPAHKYPNBI7PQSO';

  beforeEach(() => {
    engine = new ReputationEngine();
    handler = new ReputationRouteHandler(engine);
  });

  const preview = (userAddress: string, amount?: unknown) => {
    const res = handler.handleSimulateAction({ userAddress, action: 'OnTimeRepay', amount });
    expect(res.success).toBe(true);
    return res.data!;
  };

  it('an amount far beyond any real repayment cannot reach the maximum bonus', () => {
    for (const amount of ['1000000000000', '99999999999999999999999999999999', '340282366920938463463374607431768211455']) {
      const data = preview(newcomer, amount);
      expect(data.scoreDelta).toBeLessThanOrEqual(15 + 10);
      expect(data.scoreDelta).toBeLessThan(15 + 50);
      expect(data.volumeCapped).toBe(true);
      expect(data.volumeCounted).toBe(UNVERIFIED_PREVIEW_VOLUME_CAP.toString());
    }
  });

  it('legitimate repayment sizes keep the documented delta', () => {
    const data = preview(newcomer, '50000');
    expect(data.scoreDelta).toBe(20); // 15 base + 5 volume
    expect(data.volumeCounted).toBe('50000');
    expect(data.volumeCapped).toBe(false);
  });

  it('with no amount the base delta applies', () => {
    const data = preview(newcomer);
    expect(data.scoreDelta).toBe(15);
    expect(data.volumeCounted).toBe('0');
    expect(data.volumeCapped).toBe(false);
  });

  it('a user with real debt can earn the bonus up to what they actually owe', () => {
    // Seeded profile: borrowed 100_000_000_000, repaid 95_000_000_000 -> owes 5_000_000_000.
    expect(preview(seeded, '5000000000').scoreDelta).toBe(15 + 50);
    const over = preview(seeded, '900000000000000');
    expect(over.volumeCounted).toBe('5000000000');
    expect(over.volumeCapped).toBe(true);
    // A smaller repayment earns the proportional bonus: 100_000 / 10_000 = +10.
    expect(preview(seeded, '100000').scoreDelta).toBe(15 + 10);
  });

  it('a user with history but nothing outstanding earns no volume bonus', () => {
    const profile = engine.getProfile(paidOff);
    profile.totalBorrowedVolume = '1000000';
    profile.totalRepaidVolume = '1000000';
    const data = preview(paidOff, '5000000');
    expect(data.scoreDelta).toBe(15);
    expect(data.volumeCounted).toBe('0');
    expect(data.volumeCapped).toBe(true);
  });

  it('represents 2^53 + 1 exactly instead of rounding through a float', () => {
    const exact = '9007199254740993';
    const profile = engine.getProfile(whale);
    profile.totalBorrowedVolume = '9007199254740993000';
    profile.totalRepaidVolume = '0';
    const data = preview(whale, exact);
    expect(data.volumeCounted).toBe(exact);
    expect(data.volumeCapped).toBe(false);
    expect(BigInt(data.volumeCounted!)).toBe(2n ** 53n + 1n);
    expect(Number(exact).toString()).not.toBe(exact); // a float could not hold it
  });

  it('a JSON number above 2^53 is not trusted and earns no bonus', () => {
    const data = preview(newcomer, 2 ** 53 + 2);
    expect(data.scoreDelta).toBe(15);
    expect(data.volumeCapped).toBe(true);
    // A safe integer number is still accepted.
    expect(preview(newcomer, 50_000).scoreDelta).toBe(20);
  });

  it('a malformed amount earns no bonus and never produces NaN', () => {
    for (const amount of ['abc', '-5', '1e9', '12.5', '0x10', '   x   ']) {
      const data = preview(newcomer, amount);
      expect(data.scoreDelta, amount).toBe(15);
      expect(Number.isFinite(data.projectedScore)).toBe(true);
      expect(data.volumeCapped).toBe(true);
    }
  });

  it('marks every preview as an estimate, for all actions', () => {
    for (const action of ['OnTimeRepay', 'LateRepay', 'Liquidation', 'Default'] as const) {
      const res = handler.handleSimulateAction({ userAddress: newcomer, action });
      expect(res.data?.isEstimate, action).toBe(true);
    }
  });

  it('leaves penalty deltas unchanged and adds no volume fields', () => {
    const late = handler.handleSimulateAction({ userAddress: seeded, action: 'LateRepay' }).data!;
    expect(late.scoreDelta).toBe(-30);
    expect(late.volumeCounted).toBeUndefined();
    expect(late.volumeCapped).toBeUndefined();
  });
});
