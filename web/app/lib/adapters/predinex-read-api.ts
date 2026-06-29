/**
 * Read-side adapter: Canonical Soroban read-only calls for the Predinex contract.
 * UI and hooks should import chain reads from here instead of `stacks-api` where practical.
 *
 * This adapter uses the Soroban RPC layer for pool and user bet data,
 * providing the canonical target-chain read path for Stellar.
 */
import { getRuntimeConfig } from "../runtime-config";
import {
  getPoolFromSoroban,
  getUserBetFromSoroban,
  getPoolCountFromSoroban,
  getPoolBetLimitsFromSoroban,
  type Pool,
  type UserBetData,
} from "../soroban-read-api";
import { getUserActivityFromSoroban } from "../soroban-event-service";
import { getMarkets, getTotalVolume, getUserActivity } from "../stacks-api";
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('predinexReadApi');
import type { ActivityItem } from "./types";

/**
 * Get the base URL of the configured Stacks Core API.
 *
 * @returns The Stacks Core API base URL from runtime config
 */
export function getStacksCoreApiBaseUrl(): string {
  return getRuntimeConfig().api.coreApiUrl;
}

/**
 * Fetch raw contract events from the Stacks Core API.
 *
 * @param limit - Maximum number of events to fetch
 * @returns Raw JSON response from the events endpoint
 *
 * @example
 * ```ts
 * const events = await fetchPredinexContractEvents(50);
 * ```
 */
export async function fetchPredinexContractEvents(
  limit = 100,
): Promise<unknown> {
  const cfg = getRuntimeConfig();
  const url = `${cfg.api.coreApiUrl}/extended/v1/contract/${cfg.contract.address}/${cfg.contract.name}/events?limit=${limit}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch contract events: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetches user activity via the Soroban event pipeline.
 * Falls back to an empty array if the Soroban contract ID is not configured.
 */
async function getUserActivitySoroban(
  address: string,
  limit: number,
): Promise<ActivityItem[]> {
  const cfg = getRuntimeConfig();
  const { soroban } = cfg;
  return getUserActivityFromSoroban(address, limit, {
    rpcUrl: soroban.rpcUrl,
    explorerUrl: soroban.explorerUrl,
    contractId: soroban.contractId,
  });
}

/**
 * Get pool data from Soroban (canonical read path).
 * Unwraps the result to return Pool | null for backward compatibility.
 */
async function getPool(poolId: number): Promise<Pool | null> {
  const result = await getPoolFromSoroban(poolId);
  if (result.error) {
    log.error(`[predinexReadApi] Error fetching pool ${poolId}:`, result.error);
  }

  if (!result.pool) return null;

  const limits = await getPoolBetLimitsFromSoroban(poolId);

  return {
    ...result.pool,
    minBet: limits?.minBet,
    maxBet: limits?.maxBet,
  };
}

/**
 * Get user bet data from Soroban (canonical read path).
 * Unwraps the result to return UserBetData | null for backward compatibility.
 */
async function getUserBet(
  poolId: number,
  userAddress: string,
): Promise<UserBetData | null> {
  const result = await getUserBetFromSoroban(poolId, userAddress);
  if (result.error) {
    log.error(
      `[predinexReadApi] Error fetching user bet for pool ${poolId}:`,
      result.error,
    );
  }
  return result.bet;
}

/**
 * Get total pool count from Soroban (canonical read path).
 */
async function getPoolCount(): Promise<number> {
  return getPoolCountFromSoroban();
}

/**
 * Public read API for the SDK client. Prefers Soroban read paths; retains
 * legacy Stacks delegates for callers still migrating.
 */
export const predinexReadApi = {
  /** Canonical Soroban read: get pool by ID */
  getPool,
  /** Canonical Soroban read: get user's bet in a pool */
  getUserBet,
  /** Canonical Soroban read: get total pool count */
  getPoolCount,
  /** Canonical Soroban read: get user activity via events */
  getUserActivitySoroban,
  /** Canonical Soroban read: get user activity via events */
  getUserActivity: getUserActivitySoroban,
  /** Legacy delegates retained for compatibility while callers migrate */
  getMarkets,
  getTotalVolume,
  getStacksCoreApiBaseUrl,
  fetchPredinexContractEvents,
  /** Legacy delegate: get user activity via the Stacks API */
  getStacksActivity: getUserActivity,
};
