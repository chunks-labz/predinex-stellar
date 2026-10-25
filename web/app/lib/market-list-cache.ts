import type { ProcessedMarket } from './market-types';
import type { PoolData } from './market-types';
import { fetchAllPools, getEnhancedPool } from './enhanced-stacks-api';
import { processMarketData } from './market-utils';

/**
 * Client-side cache for the markets list to make the first paint faster.
 *
 * Cache strategy (freshness & invalidation):
 * - Stored in `localStorage` as a JSON payload with:
 *   - `version` (to invalidate schema changes)
 *   - `cachedAt` timestamp
 *   - `markets` array
 * - Entry is considered fresh for `MARKET_LIST_CACHE_TTL_MS`.
 * - If the entry is stale or the version mismatches, it is removed and the UI
 *   falls back to live fetching (showing the loading state).
 *
 * Deployment compatibility note:
 * - This cache is per-browser (and per-user), so it works regardless of server
 *   deployment model and still improves perceived first render time.
 */
export const MARKET_LIST_CACHE_KEY = 'predinex_market_list_v2';
export const MARKET_LIST_CACHE_VERSION = 2;
export const MARKET_LIST_CACHE_TTL_MS = 30_000;

export const POOL_CACHE_KEY_PREFIX = 'predinex_pool_';
export const POOL_CACHE_VERSION = 1;
export const POOL_CACHE_TTL_MS = 60_000;

export const BLOCK_HEIGHT_WARNING_KEY = 'predinex_block_height_warning_v1';
export const BLOCK_HEIGHT_WARNING_TTL_MS = MARKET_LIST_CACHE_TTL_MS;
export type BlockHeightWarningPayload = {
  cachedAt: number;
  message: string;
};

type MarketListCachePayload = {
  version: number;
  cachedAt: number;
  markets: ProcessedMarket[];
};

let inFlightWarmPromise: Promise<ProcessedMarket[]> | null = null;

export function readBlockHeightWarning(now: number = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(BLOCK_HEIGHT_WARNING_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<BlockHeightWarningPayload>;
    if (typeof parsed.cachedAt !== 'number' || typeof parsed.message !== 'string') return null;

    const ageMs = now - parsed.cachedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > BLOCK_HEIGHT_WARNING_TTL_MS) {
      window.localStorage.removeItem(BLOCK_HEIGHT_WARNING_KEY);
      return null;
    }

    return parsed.message;
  } catch {
    return null;
  }
}

export function clearMarketListCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(MARKET_LIST_CACHE_KEY);
  } catch {
    // Non-fatal: cache is best-effort.
  }
}

export function readMarketListCache(now: number = Date.now()): {
  markets: ProcessedMarket[];
  isFresh: boolean;
} {
  if (typeof window === 'undefined') return { markets: [], isFresh: false };

  const raw = window.localStorage.getItem(MARKET_LIST_CACHE_KEY);
  if (!raw) return { markets: [], isFresh: false };

  try {
    const parsed = JSON.parse(raw) as Partial<MarketListCachePayload>;

    if (parsed.version !== MARKET_LIST_CACHE_VERSION) {
      clearMarketListCache();
      return { markets: [], isFresh: false };
    }

    if (typeof parsed.cachedAt !== 'number' || !Array.isArray(parsed.markets)) {
      clearMarketListCache();
      return { markets: [], isFresh: false };
    }

    const ageMs = now - parsed.cachedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MARKET_LIST_CACHE_TTL_MS) {
      clearMarketListCache();
      return { markets: [], isFresh: false };
    }

    return { markets: parsed.markets as ProcessedMarket[], isFresh: true };
  } catch {
    clearMarketListCache();
    return { markets: [], isFresh: false };
  }
}

export function writeMarketListCache(markets: ProcessedMarket[], now: number = Date.now()): void {
  if (typeof window === 'undefined') return;

  const payload: MarketListCachePayload = {
    version: MARKET_LIST_CACHE_VERSION,
    cachedAt: now,
    markets
  };

  try {
    window.localStorage.setItem(MARKET_LIST_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal: cache is best-effort.
  }
}

type PoolCachePayload = {
  version: number;
  cachedAt: number;
  pool: PoolData;
};

function getPoolCacheKey(poolId: number): string {
  return `${POOL_CACHE_KEY_PREFIX}${poolId}`;
}

export function readPoolCache(poolId: number, now: number = Date.now()): {
  pool: PoolData | null;
  isFresh: boolean;
} {
  if (typeof window === 'undefined') return { pool: null, isFresh: false };

  const key = getPoolCacheKey(poolId);
  const raw = window.localStorage.getItem(key);
  if (!raw) return { pool: null, isFresh: false };

  try {
    const parsed = JSON.parse(raw) as Partial<PoolCachePayload>;

    if (parsed.version !== POOL_CACHE_VERSION) {
      window.localStorage.removeItem(key);
      return { pool: null, isFresh: false };
    }

    if (typeof parsed.cachedAt !== 'number' || !parsed.pool) {
      window.localStorage.removeItem(key);
      return { pool: null, isFresh: false };
    }

    const ageMs = now - parsed.cachedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > POOL_CACHE_TTL_MS) {
      window.localStorage.removeItem(key);
      return { pool: null, isFresh: false };
    }

    return { pool: parsed.pool as PoolData, isFresh: true };
  } catch {
    window.localStorage.removeItem(key);
    return { pool: null, isFresh: false };
  }
}

export function writePoolCache(pool: PoolData, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;

  const payload: PoolCachePayload = {
    version: POOL_CACHE_VERSION,
    cachedAt: now,
    pool
  };

  try {
    window.localStorage.setItem(getPoolCacheKey(pool.poolId), JSON.stringify(payload));
  } catch {
    // Non-fatal: cache is best-effort.
  }
}

export function invalidatePoolCache(poolId: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getPoolCacheKey(poolId));
  } catch {
    // Non-fatal
  }
}

export function invalidateAllCaches(): void {
  clearMarketListCache();
  if (typeof window === 'undefined') return;
  
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(POOL_CACHE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => window.localStorage.removeItem(key));
  } catch {
    // Non-fatal
  }
}

export async function getCachedPool(poolId: number): Promise<PoolData | null> {
  const cached = readPoolCache(poolId);
  if (cached.isFresh && cached.pool) {
    return cached.pool;
  }

  const pool = await getEnhancedPool(poolId);
  if (pool) {
    writePoolCache(pool);
  }
  return pool;
}

/**
 * Warms the cache by fetching + processing markets, but:
 * - immediately returns cached markets if the cache is still fresh
 * - dedupes concurrent warmups via an in-flight promise
 *
 * If the cache is stale/missing, this will call the contract read functions.
 */
export async function warmMarketListCache(): Promise<ProcessedMarket[]> {
  const cached = readMarketListCache();
  if (cached.isFresh) return cached.markets;

  if (inFlightWarmPromise) return inFlightWarmPromise;

  inFlightWarmPromise = (async () => {
    const poolsData = await fetchAllPools();
    // #1284 — status/expiry is derived from wall-clock time, so no chain-tip
    // lookup is needed to classify markets.
    const processedMarkets = poolsData.map(pool => processMarketData(pool));
    writeMarketListCache(processedMarkets);
    
    poolsData.forEach(pool => writePoolCache(pool));
    
    return processedMarkets;
  })();

  try {
    return await inFlightWarmPromise;
  } finally {
    inFlightWarmPromise = null;
  }
}

