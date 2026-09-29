/**
 * Market calculation utilities for the Market Discovery System.
 * These helpers manage odds calculations, status determinations, and formatting for prediction markets.
 */

import { PoolData, ProcessedMarket, MarketStatus } from './market-types';
import { getRuntimeConfig } from './runtime-config';
import { formatTokenAmountCompact } from './formatting';

/** Current Unix time in whole seconds. */
export function currentTimestampSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Determines the current status of a market based on its settlement state and expiry time.
 *
 * #1284 — `expiry` is a Unix timestamp in seconds, so it is compared directly
 * against wall-clock time rather than against a ledger height.
 *
 * @param pool - The raw pool data from the smart contract
 * @param nowSeconds - Current Unix time in seconds; defaults to `Date.now()`
 * @returns 'settled' if resolved, 'expired' if deadline passed, otherwise 'active'
 */
export function calculateMarketStatus(pool: PoolData, nowSeconds: number = currentTimestampSeconds()): MarketStatus {
  if (pool.settled) return 'settled';
  if (pool.disputed) return 'disputed';
  if (pool.frozen) return 'frozen';
  if (nowSeconds >= pool.expiry) return 'expired';
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
 * Calculates the number of seconds remaining until market expiry.
 *
 * #1284 — `expiry` is a Unix timestamp in seconds, so the remaining time is a
 * direct difference against wall-clock time with no block-time estimate.
 *
 * @param expiry - The Unix timestamp (seconds) at which the market expires
 * @param nowSeconds - Current Unix time in seconds; defaults to `Date.now()`
 * @returns Number of seconds remaining, or null if already expired
 */
export function calculateTimeRemaining(expiry: number, nowSeconds: number = currentTimestampSeconds()): number | null {
  if (!Number.isFinite(expiry) || expiry <= 0) return null;
  if (nowSeconds >= expiry) return null;
  return Math.floor(expiry - nowSeconds);
}

/**
 * Transforms raw smart contract data into a processed format ready for UI consumption.
 * Encapsulates logic for odds, status, and time remaining calculations.
 *
 * @param pool - The input pool data
 * @param nowSeconds - Current Unix time in seconds; defaults to `Date.now()`
 * @returns Enriched market object with computed fields
 */
export function processMarketData(pool: PoolData, nowSeconds?: number): ProcessedMarket {
  const now = nowSeconds ?? currentTimestampSeconds();
  const odds = calculateOdds(pool.totalA, pool.totalB);
  const status = calculateMarketStatus(pool, now);
  const timeRemaining = calculateTimeRemaining(pool.expiry, now);
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
 * Formats a stroops amount into a compact human-readable string.
 *
 * #1285 — Delegates to the shared `formatTokenAmountCompact` helper so the
 * stroops→unit conversion and token symbol come from a single source of truth
 * (`TOKEN_CONFIG.STROOPS_PER_UNIT` = 1 XLM = 10_000_000 stroops) instead of the
 * local 1e6 divisor and hardcoded "STX" suffix this function used to carry.
 *
 * @param amount - The amount in stroops
 * @returns Formatted currency string
 */
export function formatSTXAmount(amount: number): string {
  return formatTokenAmountCompact(BigInt(Math.round(amount)));
}

/**
 * Formats human-readable time remaining from a number of seconds.
 *
 * #1284 — Takes seconds directly; the old version multiplied a block count by
 * an assumed 5s block time, which compounded the block-height/timestamp mixup.
 *
 * @param secondsRemaining - The number of seconds until expiry
 * @returns Formatted duration string (e.g., "2d", "5h", "45m")
 */
export function formatTimeRemaining(secondsRemaining: number | null): string {
  if (secondsRemaining === null) return 'Expired';
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) return 'Expired';

  const minutesRemaining = Math.floor(secondsRemaining / 60);

  if (minutesRemaining < 1) {
    return '<1m';
  } else if (minutesRemaining < 60) {
    return `${minutesRemaining}m`;
  } else if (minutesRemaining < 1440) { // 24 hours
    return `${Math.floor(minutesRemaining / 60)}h`;
  } else {
    return `${Math.floor(minutesRemaining / 1440)}d`;
  }
}

/**
 * Retrieves the current block height of the Stellar network.
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
 * Live fetch Stellar chain tip block height.
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
  const url = cfg.soroban.rpcUrl;

  try {
    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timeoutId =
      controller && timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (timeoutId) window.clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Soroban API status failed: ${res.status}`);
    }

    const data = await res.json();
    const rawHeight = data?.result?.sequence;

    const height =
      typeof rawHeight === 'string' ? Number.parseInt(rawHeight, 10) : Number(rawHeight);

    if (!Number.isFinite(height) || height <= 0) {
      throw new Error('Invalid Soroban tip height response');
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
