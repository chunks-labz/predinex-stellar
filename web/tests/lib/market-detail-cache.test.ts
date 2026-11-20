import { beforeEach, describe, expect, it } from 'vitest';
import {
  MARKET_DETAIL_CACHE_TTL_MS,
  clearMarketDetailCache,
  invalidateMarketDetail,
  readMarketDetail,
  writeMarketDetail,
} from '../../app/lib/market-detail-cache';
import type { Pool } from '../../app/lib/market-types';

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    id: 7,
    title: 'Cache me',
    description: 'A pool used to verify navigation caching',
    creator: 'GTEST',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 1_000_000,
    totalB: 2_000_000,
    settled: false,
    winningOutcome: undefined,
    expiry: 9_999,
    status: 'active',
    ...overrides,
  };
}

describe('market detail navigation cache', () => {
  beforeEach(() => clearMarketDetailCache());

  it('returns fresh pool + position snapshots for repeat detail visits', () => {
    const now = 1_000_000;
    writeMarketDetail(7, 'GUSER', makePool(), { amountA: 10, amountB: 0 }, now);

    expect(readMarketDetail(7, 'GUSER', now + 1_000)).toEqual({
      pool: expect.objectContaining({ id: 7 }),
      userBet: { amountA: 10, amountB: 0 },
      cachedAt: now,
    });
  });

  it('keys positions by wallet address', () => {
    writeMarketDetail(7, 'GUSER_A', makePool(), { amountA: 1, amountB: 0 });
    writeMarketDetail(7, 'GUSER_B', makePool(), { amountA: 2, amountB: 0 });

    expect(readMarketDetail(7, 'GUSER_A')?.userBet?.amountA).toBe(1);
    expect(readMarketDetail(7, 'GUSER_B')?.userBet?.amountA).toBe(2);
    expect(readMarketDetail(7, undefined)).toBeNull();
  });

  it('expires entries after the TTL', () => {
    const now = 1_000_000;
    writeMarketDetail(7, undefined, makePool(), null, now);

    expect(readMarketDetail(7, undefined, now + MARKET_DETAIL_CACHE_TTL_MS)).not.toBeNull();
    expect(readMarketDetail(7, undefined, now + MARKET_DETAIL_CACHE_TTL_MS + 1)).toBeNull();
  });

  it('invalidates every address entry for a pool after a mutation', () => {
    writeMarketDetail(7, 'GUSER_A', makePool(), null);
    writeMarketDetail(7, 'GUSER_B', makePool(), null);
    writeMarketDetail(8, 'GUSER_A', makePool({ id: 8 }), null);

    invalidateMarketDetail(7);

    expect(readMarketDetail(7, 'GUSER_A')).toBeNull();
    expect(readMarketDetail(7, 'GUSER_B')).toBeNull();
    expect(readMarketDetail(8, 'GUSER_A')).not.toBeNull();
  });
});
