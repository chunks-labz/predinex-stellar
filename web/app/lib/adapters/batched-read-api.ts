/**
 * Batched read layer for Predinex contract data.
 * 
 * Reduces RPC fan-out by grouping semantically related reads (e.g., fetching
 * multiple pools or user bets in a single batch) and caching results with
 * per-window TTL.
 * 
 * @module batched-read-api
 */

import { predinexReadApi } from './predinex-read-api';
import type { Pool, UserBetData } from '../market-types';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('batchedReadApi');

/** Default TTL for batch cache entries (60 seconds) */
const DEFAULT_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface BatchPoolResult {
  poolId: number;
  pool: Pool | null;
  error?: string;
}

interface BatchUserBetResult {
  poolId: number;
  userAddress: string;
  bet: UserBetData | null;
  error?: string;
}

/**
 * Simple in-memory cache with TTL support.
 */
class BatchCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePattern(pattern: RegExp): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  clear(): void {
    this.cache.clear();
  }
}

const batchCache = new BatchCache();

/**
 * Fetch multiple pools in a batch.
 * 
 * Uses Promise.allSettled to fetch all pools concurrently, allowing
 * partial success if some pools fail to load.
 * 
 * @param poolIds - Array of pool IDs to fetch
 * @param ttlMs - Cache TTL in milliseconds (default: 60000)
 * @returns Array of batch results with pool data or errors
 * 
 * @example
 * ```ts
 * const results = await fetchPoolsBatched([1, 2, 3]);
 * const successfulPools = results.filter(r => r.pool !== null);
 * ```
 */
export async function fetchPoolsBatched(
  poolIds: number[],
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<BatchPoolResult[]> {
  const results: BatchPoolResult[] = [];
  const toFetch: number[] = [];

  // Check cache first
  for (const poolId of poolIds) {
    const cacheKey = `pool:${poolId}`;
    const cached = batchCache.get<Pool | null>(cacheKey);
    
    if (cached !== null) {
      results.push({ poolId, pool: cached });
    } else {
      toFetch.push(poolId);
    }
  }

  if (toFetch.length === 0) {
    log.debug(`[fetchPoolsBatched] All ${poolIds.length} pools served from cache`);
    return results;
  }

  log.debug(`[fetchPoolsBatched] Fetching ${toFetch.length} pools (${poolIds.length - toFetch.length} cached)`);

  // Fetch missing pools concurrently
  const fetchPromises = toFetch.map(async (poolId): Promise<BatchPoolResult> => {
    try {
      const pool = await predinexReadApi.getPool(poolId);
      const cacheKey = `pool:${poolId}`;
      batchCache.set(cacheKey, pool, ttlMs);
      return { poolId, pool };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`[fetchPoolsBatched] Error fetching pool ${poolId}:`, errorMessage);
      return { poolId, pool: null, error: errorMessage };
    }
  });

  const fetchedResults = await Promise.allSettled(fetchPromises);

  // Process results
  for (const result of fetchedResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      // Promise itself rejected (should not happen with try-catch above)
      log.error('[fetchPoolsBatched] Unexpected promise rejection:', result.reason);
    }
  }

  return results;
}

/**
 * Fetch user bets across multiple pools in a batch.
 * 
 * Uses Promise.allSettled to fetch all user bets concurrently.
 * 
 * @param poolIds - Array of pool IDs to check
 * @param userAddress - User's wallet address
 * @param ttlMs - Cache TTL in milliseconds (default: 60000)
 * @returns Array of batch results with user bet data or errors
 * 
 * @example
 * ```ts
 * const results = await fetchUserBetsBatched([1, 2, 3], 'GABC...');
 * const activeBets = results.filter(r => r.bet !== null);
 * ```
 */
export async function fetchUserBetsBatched(
  poolIds: number[],
  userAddress: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<BatchUserBetResult[]> {
  const results: BatchUserBetResult[] = [];
  const toFetch: number[] = [];

  // Check cache first
  for (const poolId of poolIds) {
    const cacheKey = `userBet:${poolId}:${userAddress}`;
    const cached = batchCache.get<UserBetData | null>(cacheKey);
    
    if (cached !== null) {
      results.push({ poolId, userAddress, bet: cached });
    } else {
      toFetch.push(poolId);
    }
  }

  if (toFetch.length === 0) {
    log.debug(`[fetchUserBetsBatched] All ${poolIds.length} user bets served from cache`);
    return results;
  }

  log.debug(`[fetchUserBetsBatched] Fetching ${toFetch.length} user bets (${poolIds.length - toFetch.length} cached)`);

  // Fetch missing user bets concurrently
  const fetchPromises = toFetch.map(async (poolId): Promise<BatchUserBetResult> => {
    try {
      const bet = await predinexReadApi.getUserBet(poolId, userAddress);
      const cacheKey = `userBet:${poolId}:${userAddress}`;
      batchCache.set(cacheKey, bet, ttlMs);
      return { poolId, userAddress, bet };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error(`[fetchUserBetsBatched] Error fetching user bet for pool ${poolId}:`, errorMessage);
      return { poolId, userAddress, bet: null, error: errorMessage };
    }
  });

  const fetchedResults = await Promise.allSettled(fetchPromises);

  // Process results
  for (const result of fetchedResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      log.error('[fetchUserBetsBatched] Unexpected promise rejection:', result.reason);
    }
  }

  return results;
}

/**
 * Fetch user's complete portfolio data: pools they've bet on + their bets.
 * 
 * This is the primary optimization for dashboard/portfolio screens.
 * It fetches pools and user bets concurrently in two batches rather than
 * serially per-row.
 * 
 * @param poolIds - Array of pool IDs where user has bets
 * @param userAddress - User's wallet address
 * @param ttlMs - Cache TTL in milliseconds (default: 60000)
 * @returns Object with pools and userBets arrays
 * 
 * @example
 * ```ts
 * const { pools, userBets } = await fetchUserPortfolioBatched([1, 2, 3], 'GABC...');
 * // pools and userBets are aligned by poolId
 * ```
 */
export async function fetchUserPortfolioBatched(
  poolIds: number[],
  userAddress: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS,
): Promise<{
  pools: BatchPoolResult[];
  userBets: BatchUserBetResult[];
}> {
  log.debug(`[fetchUserPortfolioBatched] Fetching portfolio for ${poolIds.length} pools`);

  // Fetch pools and user bets concurrently
  const [pools, userBets] = await Promise.all([
    fetchPoolsBatched(poolIds, ttlMs),
    fetchUserBetsBatched(poolIds, userAddress, ttlMs),
  ]);

  return { pools, userBets };
}

/**
 * Invalidate cached data for a specific pool.
 * Call this after mutations (place bet, claim, etc.) to force fresh reads.
 * 
 * @param poolId - Pool ID to invalidate
 */
export function invalidatePoolCache(poolId: number): void {
  batchCache.invalidate(`pool:${poolId}`);
  // Also invalidate all user bets for this pool
  batchCache.invalidatePattern(new RegExp(`^userBet:${poolId}:`));
  log.debug(`[invalidatePoolCache] Invalidated cache for pool ${poolId}`);
}

/**
 * Invalidate cached data for a specific user across all pools.
 * Call this after user wallet disconnect or address change.
 * 
 * @param userAddress - User wallet address
 */
export function invalidateUserCache(userAddress: string): void {
  batchCache.invalidatePattern(new RegExp(`:${userAddress}$`));
  log.debug(`[invalidateUserCache] Invalidated cache for user ${userAddress}`);
}

/**
 * Clear all cached data.
 * Useful for testing or forced refresh scenarios.
 */
export function clearBatchCache(): void {
  batchCache.clear();
  log.debug('[clearBatchCache] Cleared all batch cache entries');
}

/**
 * Export the batch read API.
 */
export const batchedReadApi = {
  fetchPoolsBatched,
  fetchUserBetsBatched,
  fetchUserPortfolioBatched,
  invalidatePoolCache,
  invalidateUserCache,
  clearBatchCache,
};
