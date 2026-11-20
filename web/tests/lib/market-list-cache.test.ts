import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearMarketListCache,
  readMarketListCache,
  writeMarketListCache,
  MARKET_LIST_CACHE_KEY,
  MARKET_LIST_CACHE_TTL_MS,
  MARKET_LIST_CACHE_VERSION
} from '../../app/lib/market-list-cache';
import {
  getCachedPoolExtMetadata,
  invalidatePoolExtMetadataCache,
} from '../../app/lib/soroban-read-api';
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
  creator: 'ST123'
};

describe('market-list-cache', () => {
  beforeEach(() => {
    clearMarketListCache();
    localStorage.clear();
  });

  it('returns fresh cache when within TTL', () => {
    const now = 1_700_000_000_000;
    writeMarketListCache([sampleMarket], now);

    const res = readMarketListCache(now + 1_000);
    expect(res.isFresh).toBe(true);
    expect(res.markets).toEqual([sampleMarket]);
  });

  it('invalidates stale cache after TTL and removes it', () => {
    const now = 1_700_000_000_000;
    writeMarketListCache([sampleMarket], now);

    const res = readMarketListCache(now + MARKET_LIST_CACHE_TTL_MS + 1);
    expect(res.isFresh).toBe(false);
    expect(res.markets).toEqual([]);
    expect(localStorage.getItem(MARKET_LIST_CACHE_KEY)).toBeNull();
  });

  it('invalidates cache on version mismatch and removes it', () => {
    const now = 1_700_000_000_000;

    localStorage.setItem(
      MARKET_LIST_CACHE_KEY,
      JSON.stringify({
        version: MARKET_LIST_CACHE_VERSION + 999,
        cachedAt: now,
        markets: [sampleMarket]
      })
    );

    const res = readMarketListCache(now);
    expect(res.isFresh).toBe(false);
    expect(res.markets).toEqual([]);
    expect(localStorage.getItem(MARKET_LIST_CACHE_KEY)).toBeNull();
  });

  it('caches pool metadata and invalidates it on demand', async () => {
    const readSpy = vi.fn().mockResolvedValue({
      resolutionCriteria: 'Resolved by oracle',
      externalLinks: 'https://example.com',
      coverImage: 'https://cdn.example.com/cover.png',
    });

    const cfg = { rpcUrl: 'https://example-rpc.test', contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' };

    const first = await getCachedPoolExtMetadata(42, cfg, readSpy);
    const second = await getCachedPoolExtMetadata(42, cfg, readSpy);

    expect(first).toMatchObject({ resolutionCriteria: 'Resolved by oracle' });
    expect(second).toEqual(first);
    expect(readSpy).toHaveBeenCalledTimes(1);

    invalidatePoolExtMetadataCache(42);
    await getCachedPoolExtMetadata(42, cfg, readSpy);
    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});

