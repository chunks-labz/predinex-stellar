import { describe, it, expect, beforeEach, vi } from 'vitest';

const { clearPoolActivityCacheMock } = vi.hoisted(() => ({
  clearPoolActivityCacheMock: vi.fn(),
}));
vi.mock('../../app/hooks/usePoolActivity', () => ({
  clearPoolActivityCache: clearPoolActivityCacheMock,
}));

import {
  invalidateOnPlaceBet,
  invalidateOnClaimWinnings,
  invalidateOnCreatePool,
  invalidateOnResolvePool,
  userActivityCache,
  userDashboardCache,
} from '../../app/lib/cache-invalidation';
import {
  writeMarketListCache,
  readMarketListCache,
  readPoolCache,
  POOL_CACHE_KEY_PREFIX,
  POOL_CACHE_VERSION,
} from '../../app/lib/market-list-cache';
import type { ProcessedMarket } from '../../app/lib/market-types';

const sampleMarket: ProcessedMarket = {
  poolId: 1,
  title: 'Sample Market',
  description: 'A market used for cache tests.',
  outcomeA: 'A',
  outcomeB: 'B',
  totalVolume: 123,
  oddsA: 60,
  oddsB: 40,
  status: 'active',
  timeRemaining: 10,
  createdAt: 1700000000,
  settledAt: null,
  creator: 'ST123',
};

/**
 * Seeds a fresh `readPoolCache` entry directly via localStorage, bypassing
 * `writePoolCache`. `PoolData.totalA`/`totalB` are `bigint`, and
 * `writePoolCache` JSON.stringifies the payload with no bigint replacer —
 * `JSON.stringify` throws on a bigint, so with any real `PoolData` the call
 * silently no-ops inside `writePoolCache`'s own try/catch. That's a
 * pre-existing bug independent of this issue (#990 is only about the
 * invalidation calls never firing); seeding the cache this way keeps this
 * test suite decoupled from it.
 */
function seedPoolCache(poolId: number, now: number = Date.now()): void {
  localStorage.setItem(
    `${POOL_CACHE_KEY_PREFIX}${poolId}`,
    JSON.stringify({
      version: POOL_CACHE_VERSION,
      cachedAt: now,
      pool: { poolId, title: 'Sample Pool' },
    })
  );
}

describe('cache-invalidation', () => {
  beforeEach(() => {
    localStorage.clear();
    userActivityCache.clear();
    userDashboardCache.clear();
    clearPoolActivityCacheMock.mockClear();
  });

  describe('invalidateOnPlaceBet', () => {
    it('clears the market list cache', () => {
      writeMarketListCache([sampleMarket]);
      invalidateOnPlaceBet({ poolId: 1, userAddress: 'GBUYER' });

      expect(readMarketListCache().isFresh).toBe(false);
    });

    it('clears the specific pool cache', () => {
      seedPoolCache(1);
      expect(readPoolCache(1).isFresh).toBe(true);

      invalidateOnPlaceBet({ poolId: 1, userAddress: 'GBUYER' });

      expect(readPoolCache(1).isFresh).toBe(false);
    });

    it('clears the pool activity cache (issue #990)', () => {
      invalidateOnPlaceBet({ poolId: 1, userAddress: 'GBUYER' });

      expect(clearPoolActivityCacheMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateOnClaimWinnings', () => {
    it('clears market list, pool, and pool activity caches', () => {
      writeMarketListCache([sampleMarket]);
      seedPoolCache(1);

      invalidateOnClaimWinnings({ poolId: 1, userAddress: 'GBUYER' });

      expect(readMarketListCache().isFresh).toBe(false);
      expect(readPoolCache(1).isFresh).toBe(false);
      expect(clearPoolActivityCacheMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateOnCreatePool / invalidateOnResolvePool', () => {
    it('invalidateOnCreatePool clears the market list', () => {
      writeMarketListCache([sampleMarket]);

      invalidateOnCreatePool();

      expect(readMarketListCache().isFresh).toBe(false);
    });

    it('invalidateOnResolvePool clears market list and the specific pool', () => {
      writeMarketListCache([sampleMarket]);
      seedPoolCache(1);

      invalidateOnResolvePool(1);

      expect(readMarketListCache().isFresh).toBe(false);
      expect(readPoolCache(1).isFresh).toBe(false);
    });
  });
});
