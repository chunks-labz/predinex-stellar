/**
 * Centralized cache invalidation policy for Predinex.
 *
 * ## Mutation → Invalidation Map
 *
 * | Mutation          | Caches invalidated                                      |
 * |-------------------|---------------------------------------------------------|
 * | place-bet         | market list, pool(poolId), user activity, user bets     |
 * | claim-winnings    | market list, pool(poolId), user activity, dashboard     |
 * | create-pool       | market list                                             |
 * | resolve-pool      | market list, pool(poolId)                               |
 *
 * All invalidation helpers are synchronous and safe to call from any context
 * (they guard against SSR via `typeof window` checks inside the cache modules).
 *
 * ## Usage
 *
 * ```ts
 * import { invalidateOnPlaceBet, invalidateOnClaimWinnings } from '@/app/lib/cache-invalidation';
 *
 * // After a successful place-bet transaction:
 * invalidateOnPlaceBet({ poolId, userAddress });
 *
 * // After a successful claim-winnings transaction:
 * invalidateOnClaimWinnings({ poolId, userAddress });
 * ```
 */

import {
  clearMarketListCache,
  invalidatePoolCache,
} from './market-list-cache';
import { createScopedCache } from './cache';
import { clearPoolActivityCache } from '../hooks/usePoolActivity';

// ---------------------------------------------------------------------------
// Scoped in-memory caches (keyed by user address)
// ---------------------------------------------------------------------------

/** In-memory cache for user activity feeds. */
export const userActivityCache = createScopedCache('user-activity');

/** In-memory cache for user bets / dashboard data. */
export const userDashboardCache = createScopedCache('user-dashboard');

// ---------------------------------------------------------------------------
// Granular invalidation helpers
// ---------------------------------------------------------------------------

/** Invalidate the market list (localStorage). */
export function invalidateMarketList(): void {
  clearMarketListCache();
}

/** Invalidate a single pool entry (localStorage). */
export function invalidatePool(poolId: number): void {
  invalidatePoolCache(poolId);
}

/** Invalidate all cached data for a specific user address (in-memory). */
export function invalidateUserCaches(userAddress: string): void {
  userActivityCache.delete(userAddress);
  userDashboardCache.delete(userAddress);
}

// ---------------------------------------------------------------------------
// Mutation-level invalidation policies
// ---------------------------------------------------------------------------

export interface PlaceBetInvalidationParams {
  poolId: number;
  userAddress: string;
}

/**
 * Invalidation policy for `place-bet`.
 *
 * Clears:
 * - Market list cache (pool totals changed)
 * - Individual pool cache (pool totals changed)
 * - User activity cache (new activity entry)
 * - User dashboard/bets cache (new active bet)
 */
export function invalidateOnPlaceBet({ poolId, userAddress }: PlaceBetInvalidationParams): void {
  invalidateMarketList();
  invalidatePool(poolId);
  invalidateUserCaches(userAddress);
  // usePoolActivity.ts keeps its own 30s-TTL cache (issue #990) separate from
  // the caches above; a fresh bet won't show up in the activity timeline
  // until this is cleared too.
  clearPoolActivityCache();
}

export interface ClaimWinningsInvalidationParams {
  poolId: number;
  userAddress: string;
}

/**
 * Invalidation policy for `claim-winnings`.
 *
 * Clears:
 * - Market list cache (claimed amount affects pool display)
 * - Individual pool cache
 * - User activity cache (new claim activity entry)
 * - User dashboard/bets cache (bet moves from claimable → claimed)
 */
export function invalidateOnClaimWinnings({ poolId, userAddress }: ClaimWinningsInvalidationParams): void {
  invalidateMarketList();
  invalidatePool(poolId);
  invalidateUserCaches(userAddress);
  clearPoolActivityCache();
}

/**
 * Invalidation policy for `create-pool`.
 *
 * Clears:
 * - Market list cache (new pool appears)
 */
export function invalidateOnCreatePool(): void {
  invalidateMarketList();
}

/**
 * Invalidation policy for `resolve-pool`.
 *
 * Clears:
 * - Market list cache (pool status changed)
 * - Individual pool cache (settled flag + winning outcome updated)
 */
export function invalidateOnResolvePool(poolId: number): void {
  invalidateMarketList();
  invalidatePool(poolId);
}
