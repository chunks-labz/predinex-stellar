import { describe, it, expect } from 'vitest';
import {
  calculateMarketStatus,
  calculateTimeRemaining,
  processMarketData,
  formatTimeRemaining,
  formatSTXAmount,
  currentTimestampSeconds,
} from '../../app/lib/market-utils';
import { TOKEN_SYMBOL } from '../../app/lib/formatting';
import type { PoolData } from '../../app/lib/market-types';

const NOW = 1_780_000_000; // 2026-05-29T21:33:20Z

const pool = (overrides: Partial<PoolData> = {}): PoolData => ({
  poolId: 1,
  creator: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  title: 'Will it rain?',
  description: 'A market about weather',
  outcomeAName: 'Yes',
  outcomeBName: 'No',
  totalA: 50_000_000n,
  totalB: 50_000_000n,
  settled: false,
  winningOutcome: null,
  createdAt: NOW - 3600,
  settledAt: null,
  expiry: NOW + 3600,
  ...overrides,
});

describe('calculateMarketStatus', () => {
  // #1284 — expiry is a Unix timestamp in seconds.
  it('is active while the deadline is in the future', () => {
    expect(calculateMarketStatus(pool({ expiry: NOW + 1 }), NOW)).toBe('active');
  });

  it('is expired once the deadline has passed', () => {
    expect(calculateMarketStatus(pool({ expiry: NOW - 1 }), NOW)).toBe('expired');
    expect(calculateMarketStatus(pool({ expiry: NOW }), NOW)).toBe('expired');
  });

  it('lets terminal flags win over expiry', () => {
    expect(calculateMarketStatus(pool({ settled: true, expiry: NOW - 1 }), NOW)).toBe('settled');
    expect(calculateMarketStatus(pool({ disputed: true, expiry: NOW - 1 }), NOW)).toBe('disputed');
    expect(calculateMarketStatus(pool({ frozen: true, expiry: NOW - 1 }), NOW)).toBe('frozen');
  });

  it('is not fooled by mixing a chain tip in with a timestamp', () => {
    // A chain tip is ~1e7 while expiry values are ~1.78e9. Feeding a height in
    // as "now" leaves every market reading as active for ~54 years, which is the
    // mirror image of the original bug (subtracting a tip from a timestamp and
    // multiplying by 5 gave ~273 years of "remaining"). Both directions must
    // stay visible so neither mix-up can come back unnoticed.
    const tip = 10_500_000;
    expect(tip).toBeLessThan(NOW); // the two scales are not interchangeable
    expect(calculateMarketStatus(pool({ expiry: NOW + 3600 }), tip)).toBe('active');

    // Correct units: the same pool is ~1 hour from expiry.
    expect(calculateMarketStatus(pool({ expiry: NOW + 3600 }), NOW)).toBe('active');
    expect(calculateTimeRemaining(NOW + 3600, NOW)).toBe(3600);
  });

  it('defaults to the current wall clock', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(calculateMarketStatus(pool({ expiry: future }))).toBe('active');
    expect(calculateMarketStatus(pool({ expiry: 1 }))).toBe('expired');
  });
});

describe('calculateTimeRemaining', () => {
  it('returns whole seconds until expiry', () => {
    expect(calculateTimeRemaining(NOW + 7200, NOW)).toBe(7200);
    expect(calculateTimeRemaining(NOW + 90, NOW)).toBe(90);
  });

  it('returns null at or past the deadline', () => {
    expect(calculateTimeRemaining(NOW, NOW)).toBeNull();
    expect(calculateTimeRemaining(NOW - 5, NOW)).toBeNull();
  });

  it('returns null for an unusable expiry', () => {
    expect(calculateTimeRemaining(0, NOW)).toBeNull();
    expect(calculateTimeRemaining(-1, NOW)).toBeNull();
    expect(calculateTimeRemaining(Number.NaN, NOW)).toBeNull();
  });
});

describe('processMarketData', () => {
  it('derives status and seconds-remaining from wall-clock time', () => {
    const processed = processMarketData(pool({ expiry: NOW + 1800 }), NOW);
    expect(processed.status).toBe('active');
    expect(processed.timeRemaining).toBe(1800);
  });

  it('marks an elapsed pool expired with no time remaining', () => {
    const processed = processMarketData(pool({ expiry: NOW - 1 }), NOW);
    expect(processed.status).toBe('expired');
    expect(processed.timeRemaining).toBeNull();
  });
});

describe('formatTimeRemaining', () => {
  it('formats seconds directly without a block-time multiplier', () => {
    expect(formatTimeRemaining(30)).toBe('<1m');
    expect(formatTimeRemaining(45 * 60)).toBe('45m');
    expect(formatTimeRemaining(5 * 3600)).toBe('5h');
    expect(formatTimeRemaining(3 * 86_400)).toBe('3d');
  });

  it('renders Expired for null, zero, and negative input', () => {
    expect(formatTimeRemaining(null)).toBe('Expired');
    expect(formatTimeRemaining(0)).toBe('Expired');
    expect(formatTimeRemaining(-1)).toBe('Expired');
  });
});

describe('formatSTXAmount', () => {
  // #1285 — was dividing by 1_000_000 and appending a hardcoded "STX".
  it('converts stroops using 10,000,000 stroops per unit', () => {
    expect(formatSTXAmount(10_000_000)).toBe(`1 ${TOKEN_SYMBOL}`);
    expect(formatSTXAmount(5_000_000)).toBe(`0.5 ${TOKEN_SYMBOL}`);
  });

  it('uses the configured token symbol rather than a hardcoded STX', () => {
    expect(formatSTXAmount(10_000_000)).not.toContain('STX');
    expect(formatSTXAmount(10_000_000)).toContain(TOKEN_SYMBOL);
  });

  it('applies K/M suffixes in token units', () => {
    expect(formatSTXAmount(15_000_000_000)).toBe(`1.5K ${TOKEN_SYMBOL}`);
    expect(formatSTXAmount(15_000_000_000_000)).toBe(`1.5M ${TOKEN_SYMBOL}`);
  });
});

describe('currentTimestampSeconds', () => {
  it('returns whole seconds since the epoch', () => {
    const now = currentTimestampSeconds();
    expect(Number.isInteger(now)).toBe(true);
    expect(Math.abs(now - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1);
  });
});
