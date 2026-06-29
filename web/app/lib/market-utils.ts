/**
 * Market calculation utilities for the Market Discovery System.
 * These helpers manage odds calculations, status determinations, and formatting for prediction markets.
 */

import { PoolData, ProcessedMarket, MarketStatus } from './market-types';
import { getRuntimeConfig } from './runtime-config';

/**
 * Determines the current status of a market based on its settlement state and expiry time.
 * 
 * @param pool - The raw pool data from the smart contract
 * @param currentBlockHeight - The current block height of the Stacks blockchain
 * @returns 'settled' if resolved, 'expired' if deadline passed, otherwise 'active'
 */
export function calculateMarketStatus(pool: PoolData, currentBlockHeight: number): MarketStatus {
  if (pool.settled) return 'settled';
  if (currentBlockHeight > pool.expiry) return 'expired';
  return 'active';
}

/**
 * Calculates percentage-based odds for two outcomes.
 * Used to visualize market sentiment and potential payouts.
 * 
 * @param totalA - Total micro-STX bet on outcome A
 * @param totalB - Total micro-STX bet on outcome B
 * @returns Object with oddsA and oddsB (defaulting to 50/50 for empty pools)
 */
export function calculateOdds(totalA: bigint, totalB: bigint): { oddsA: number; oddsB: number } {
  const total = totalA + totalB;
  if (total === BigInt(0)) return { oddsA: 50, oddsB: 50 };

  return {
    oddsA: Math.round((Number(totalA) / Number(total)) * 100),
    oddsB: Math.round((Number(totalB) / Number(total)) * 100)
  };
}

/**
 * Calculates the number of blocks remaining until market expiry.
 * 
 * @param expiry - The block height at which the market expires
 * @param currentBlockHeight - The current blockchain height
 * @returns Number of blocks remaining, or null if already expired
 */
export function calculateTimeRemaining(expiry: number, currentBlockHeight: number): number | null {
  if (currentBlockHeight >= expiry) return null;
  return expiry - currentBlockHeight;
}

/**
 * Transforms raw smart contract data into a processed format ready for UI consumption.
 * Encapsulates logic for odds, status, and time remaining calculations.
 * 
 * @param pool - The input pool data
 * @param currentBlockHeight - Current blockchain state
 * @returns Enriched market object with computed fields
 */
export function processMarketData(pool: PoolData, currentBlockHeight: number): ProcessedMarket {
  const odds = calculateOdds(pool.totalA, pool.totalB);
  const status = calculateMarketStatus(pool, currentBlockHeight);
  const timeRemaining = calculateTimeRemaining(pool.expiry, currentBlockHeight);
  const totalVolume = Number(pool.totalA + pool.totalB);

  return {
    poolId: pool.poolId,
    title: pool.title,
    description: pool.description,
    outcomeA: pool.outcomeAName,
    outcomeB: pool.outcomeBName,
    totalVolume,
    oddsA: odds.oddsA,
    oddsB: odds.oddsB,
    status,
    timeRemaining,
    createdAt: pool.createdAt,
    settledAt: pool.settledAt,
    creator: pool.creator,
    participantCount: pool.participantCount,
    assetType: pool.assetType,
    disputed: pool.disputed,
  };
}

/**
 * Formats a micro-STX amount into a user-friendly string (e.g., 1.5M STX).
 * 
 * @param amount - The numerical amount in micro-STX
 * @returns Formatted currency string
 */
export function formatSTXAmount(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M STX`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K STX`;
  } else {
    return `${amount.toLocaleString()} STX`;
  }
}

/**
 * Estimates human-readable time remaining based on block count.
 * Assumes a block production time of approximately 10 minutes (Stacks average).
 * 
 * @param blocksRemaining - The number of blocks until expiry
 * @returns Formatted duration string (e.g., "2d", "5h", "45m")
 */
export function formatTimeRemaining(blocksRemaining: number | null): string {
  if (blocksRemaining === null) return 'Expired';
  if (blocksRemaining <= 0) return 'Expired';

  // Assuming ~10 minutes per block on Stacks
  const minutesRemaining = blocksRemaining * 10;

  if (minutesRemaining < 60) {
    return `${minutesRemaining}m`;
  } else if (minutesRemaining < 1440) { // 24 hours
    return `${Math.floor(minutesRemaining / 60)}h`;
  } else {
    return `${Math.floor(minutesRemaining / 1440)}d`;
  }
}

/**
 * Retrieves the current block height of the Stacks network.
 *
 * This is computed from cached data first (fast path), while live fetching
 * happens via `fetchCurrentBlockHeightLive()`.
 */

export const BLOCK_HEIGHT_CACHE_KEY = 'predinex_block_height_v1';
export const BLOCK_HEIGHT_CACHE_VERSION = 1;
export const BLOCK_HEIGHT_CACHE_TTL_MS = 30_000;

type BlockHeightCachePayload = {
  version: number;
  cachedAt: number;
  height: number;
};

function readBlockHeightCache(now: number = Date.now()): {
  height: number;
  isFresh: boolean;
} {
  if (typeof window === 'undefined') return { height: 0, isFresh: false };

  const raw = window.localStorage.getItem(BLOCK_HEIGHT_CACHE_KEY);
  if (!raw) return { height: 0, isFresh: false };

  try {
    const parsed = JSON.parse(raw) as Partial<BlockHeightCachePayload>;
    if (parsed.version !== BLOCK_HEIGHT_CACHE_VERSION) return { height: 0, isFresh: false };
    if (typeof parsed.cachedAt !== 'number' || typeof parsed.height !== 'number') {
      return { height: 0, isFresh: false };
    }

    const ageMs = now - parsed.cachedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > BLOCK_HEIGHT_CACHE_TTL_MS) {
      return { height: 0, isFresh: false };
    }

    return { height: parsed.height, isFresh: true };
  } catch {
    return { height: 0, isFresh: false };
  }
}

function writeBlockHeightCache(height: number, now: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  const payload: BlockHeightCachePayload = {
    version: BLOCK_HEIGHT_CACHE_VERSION,
    cachedAt: now,
    height,
  };
  try {
    window.localStorage.setItem(BLOCK_HEIGHT_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort only.
  }
}

/**
 * Fast synchronous getter for the cached block height.
 * Falls back to 0 if there is no fresh cached value.
 */
export function getCurrentBlockHeight(): number {
  const cached = readBlockHeightCache();
  return cached.isFresh ? cached.height : 0;
}

/**
 * Live fetch Stacks chain tip block height.
 * - On success: updates the cache and returns `warning = null`
 * - On failure: returns a fallback height (cached if present, else 0) and
 *   a user-facing warning string.
 */
export async function fetchCurrentBlockHeightLive(options?: {
  timeoutMs?: number;
}): Promise<{ height: number; warning: string | null }> {
  const timeoutMs = options?.timeoutMs ?? 5000;

  if (typeof window === 'undefined') {
    return {
      height: getCurrentBlockHeight(),
      warning: 'Block height lookup unavailable in this environment.',
    };
  }

  const cfg = getRuntimeConfig();
  const url = `${cfg.api.coreApiUrl}/extended/v1/status`;

  try {
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeoutId =
      controller && timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (timeoutId) window.clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Stacks API status failed: ${res.status}`);
    }

    interface StacksStatusResponse {
      stacks_tip_height?: number | string;
      stacks_block_height?: number | string;
      block_height?: number | string;
      height?: number | string;
    }

    const data = (await res.json()) as StacksStatusResponse;
    const rawHeight =
      data?.stacks_tip_height ??
      data?.stacks_block_height ??
      data?.block_height ??
      data?.height;

    const height =
      typeof rawHeight === 'string' ? Number.parseInt(rawHeight, 10) : Number(rawHeight);

    if (!Number.isFinite(height) || height <= 0) {
      throw new Error('Invalid stacks tip height response');
    }

    writeBlockHeightCache(height);
    return { height, warning: null };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // Expected: the timeout above intentionally aborts the request. The
      // fallback cache already covers this case, so no warning is needed.
      return { height: getCurrentBlockHeight(), warning: null };
    }

    const fallbackHeight = getCurrentBlockHeight();
    const warning =
      fallbackHeight > 0
        ? 'Failed to fetch current chain height. Using last known block height for market statuses.'
        : 'Failed to fetch current chain height. Market statuses and countdowns may be inaccurate.';

    return { height: fallbackHeight, warning };
  }
}
