/**
 * Short-lived in-memory cache for market detail pages.
 *
 * Navigating list → detail → list → detail used to repeat the same Soroban
 * reads for the pool and the user's position on every mount. This cache keeps
 * the last result for a short window so back-and-forth navigation is instant.
 *
 * Entries are keyed by pool + wallet address because a user's position is
 * address-specific. Mutations clear entries through `cache-invalidation.ts`,
 * so a freshly placed bet or claim is never served from a stale entry.
 */
import type { Pool } from './market-types';

export interface MarketDetailUserBet {
  amountA: number;
  amountB: number;
}

export interface MarketDetailEntry {
  pool: Pool;
  userBet: MarketDetailUserBet | null;
  cachedAt: number;
}

export const MARKET_DETAIL_CACHE_TTL_MS = 30_000;

interface MarketDetailStore {
  [key: string]: MarketDetailEntry | undefined;
}

// Module scope keeps this per browser tab/session and avoids persisting pool
// snapshots to localStorage where they could outlive the tab.
const store: MarketDetailStore = {};

function cacheKey(poolId: number, userAddress?: string): string {
  return `${poolId}:${userAddress ?? 'anonymous'}`;
}

/** Returns the cached detail entry when it exists and is still fresh. */
export function readMarketDetail(
  poolId: number,
  userAddress?: string,
  now: number = Date.now(),
): MarketDetailEntry | null {
  if (!Number.isFinite(poolId)) return null;
  const entry = store[cacheKey(poolId, userAddress)];
  if (!entry) return null;

  const age = now - entry.cachedAt;
  if (!Number.isFinite(age) || age < 0 || age > MARKET_DETAIL_CACHE_TTL_MS) {
    delete store[cacheKey(poolId, userAddress)];
    return null;
  }
  return entry;
}

/** Stores a fresh pool + position snapshot for navigation reuse. */
export function writeMarketDetail(
  poolId: number,
  userAddress: string | undefined,
  pool: Pool,
  userBet: MarketDetailUserBet | null,
  now: number = Date.now(),
): void {
  if (!Number.isFinite(poolId)) return;
  store[cacheKey(poolId, userAddress)] = {
    pool,
    userBet: userBet ? { amountA: userBet.amountA, amountB: userBet.amountB } : null,
    cachedAt: now,
  };
}

/** Clears every address-specific entry for a pool after a mutation. */
export function invalidateMarketDetail(poolId: number): void {
  const prefix = `${poolId}:`;
  Object.keys(store).forEach((key) => {
    if (key.startsWith(prefix)) delete store[key];
  });
}

/** Test/debug helper — removes all detail entries. */
export function clearMarketDetailCache(): void {
  Object.keys(store).forEach((key) => delete store[key]);
}
