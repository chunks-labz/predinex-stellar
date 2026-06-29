// Enhanced Stacks API integration for Market Discovery System

import { STACKS_MAINNET, STACKS_TESTNET, StacksNetwork } from "@stacks/network";
import { fetchCallReadOnlyFunction, cvToValue, uintCV } from "@stacks/transactions";
import { PoolData } from "./market-types";
import { getRuntimeConfig } from "./runtime-config";
import { withRetry, RetryOptions } from "./retry";
import { createScopedLogger } from "./logger";

const log = createScopedLogger('enhanced-stacks-api');

/** Default retry policy for market discovery API calls. */
const MARKET_DISCOVERY_RETRY: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 8000,
};

let didLogMarketDiscoveryNetwork = false;

function getStacksNetwork(): StacksNetwork {
  const { network } = getRuntimeConfig();
  return network === 'testnet' ? STACKS_TESTNET : STACKS_MAINNET;
}

function logMarketDiscoveryNetworkOnce(): void {
  if (didLogMarketDiscoveryNetwork) return;
  didLogMarketDiscoveryNetwork = true;

  try {
    const cfg = getRuntimeConfig();
    const stacksNetwork = getStacksNetwork();
    log.info(
      `network=${cfg.network} stacksApiBaseUrl=${stacksNetwork.client.baseUrl} contract=${cfg.contract.id}`
    );
  } catch (e) {
    // If config is invalid/missing, fail-fast will throw elsewhere; avoid masking it here.
  }
}

/**
 * Get total number of pools from the contract.
 * Retries up to 4 times with exponential backoff on transient failures.
 * Returns 0 and logs when all attempts are exhausted.
 *
 * @returns Total pool count, or 0 if all retries fail
 */
export async function getPoolCount(): Promise<number> {
  try {
    logMarketDiscoveryNetworkOnce();
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();

    const result = await withRetry(
      () =>
        fetchCallReadOnlyFunction({
          contractAddress: cfg.contract.address,
          contractName: cfg.contract.name,
          functionName: 'get_pool_count',
          functionArgs: [],
          senderAddress: cfg.contract.address,
          network,
        }),
      MARKET_DISCOVERY_RETRY
    );

    const value = cvToValue(result);
    return Number(value);
  } catch (e) {
    log.error('Failed to fetch pool count after retries', e);
    return 0;
  }
}

/**
 * Get individual pool data with enhanced type safety.
 * Retries up to 4 times with exponential backoff on transient failures.
 * Returns null and logs when all attempts are exhausted.
 *
 * @param poolId - ID of the pool to fetch
 * @returns The pool's data, or null if not found or all retries fail
 */
export async function getEnhancedPool(poolId: number): Promise<PoolData | null> {
  try {
    logMarketDiscoveryNetworkOnce();
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();

    const result = await withRetry(
      () =>
        fetchCallReadOnlyFunction({
          contractAddress: cfg.contract.address,
          contractName: cfg.contract.name,
          functionName: 'get_pool',
          functionArgs: [uintCV(poolId)],
          senderAddress: cfg.contract.address,
          network,
        }),
      MARKET_DISCOVERY_RETRY
    );

    const value = cvToValue(result, true);
    if (!value) return null;

    return {
      poolId,
      creator: value.creator,
      title: value.title,
      description: value.description,
      outcomeAName: value['outcome-a-name'],
      outcomeBName: value['outcome-b-name'],
      totalA: BigInt(value['total-a'] || 0),
      totalB: BigInt(value['total-b'] || 0),
      settled: value.settled,
      winningOutcome: value['winning-outcome'] ?? null,
      createdAt: Number(value['created-at'] || 0),
      settledAt: value['settled-at'] ? Number(value['settled-at']) : null,
      expiry: Number(value.expiry || 0),
      participantCount: Number(value['participant-count'] ?? value.participant_count ?? 0),
      assetType: typeof value['asset-type'] === 'string' ? value['asset-type'] : undefined,
      disputed: Boolean(value.disputed ?? value['is-disputed'] ?? false),
    };
  } catch (e) {
    log.error(`Failed to fetch pool ${poolId} after retries`, e);
    return null;
  }
}

/**
 * Get multiple pools efficiently using batch fetching.
 * Retries up to 4 times with exponential backoff on transient failures.
 * Falls back to individual fetching when the batch function is unavailable or returns unexpected data.
 *
 * @param startId - ID of the first pool in the range to fetch
 * @param count - Number of pools to fetch starting from `startId`
 * @returns Array of pool data for the requested range
 *
 * @example
 * ```ts
 * const pools = await getPoolsBatch(0, 20);
 * ```
 */
export async function getPoolsBatch(startId: number, count: number): Promise<PoolData[]> {
  try {
    logMarketDiscoveryNetworkOnce();
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();

    // Try to use the batch function if available
    const result = await withRetry(
      () =>
        fetchCallReadOnlyFunction({
          contractAddress: cfg.contract.address,
          contractName: cfg.contract.name,
          functionName: 'get_pools_batch',
          functionArgs: [uintCV(startId), uintCV(count)],
          senderAddress: cfg.contract.address,
          network,
        }),
      MARKET_DISCOVERY_RETRY
    );

    const value = cvToValue(result, true);
    if (!value || !Array.isArray(value)) {
      // Fallback to individual fetching
      return await getPoolsIndividually(startId, count);
    }

    const pools: PoolData[] = [];
    for (let i = 0; i < value.length; i++) {
      const poolData = value[i];
      if (poolData) {
        pools.push({
          poolId: startId + i,
          creator: poolData.creator,
          title: poolData.title,
          description: poolData.description,
          outcomeAName: poolData['outcome-a-name'],
          outcomeBName: poolData['outcome-b-name'],
          totalA: BigInt(poolData['total-a'] || 0),
          totalB: BigInt(poolData['total-b'] || 0),
          settled: poolData.settled,
          winningOutcome: poolData['winning-outcome'] ?? null,
          createdAt: Number(poolData['created-at'] || 0),
          settledAt: poolData['settled-at'] ? Number(poolData['settled-at']) : null,
          expiry: Number(poolData.expiry || 0),
          participantCount: Number(poolData['participant-count'] ?? poolData.participant_count ?? 0),
          assetType: typeof poolData['asset-type'] === 'string' ? poolData['asset-type'] : undefined,
          disputed: Boolean(poolData.disputed ?? poolData['is-disputed'] ?? false),
        });
      }
    }

    return pools;
  } catch (e) {
    log.error(`Failed to fetch pools batch ${startId}-${startId + count} after retries`, e);
    // Fallback to individual fetching
    return await getPoolsIndividually(startId, count);
  }
}

/**
 * Default concurrency limit for parallel pool fetching.
 * Prevents overwhelming the upstream API with too many simultaneous requests.
 */
const DEFAULT_POOL_FETCH_CONCURRENCY = 5;

/**
 * Fetches items with bounded concurrency using a semaphore pattern.
 * @param items Array of items to process
 * @param fetcher Function to fetch each item
 * @param concurrency Maximum concurrent requests
 */
async function fetchWithBoundedConcurrency<T, R>(
  items: T[],
  fetcher: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_POOL_FETCH_CONCURRENCY
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fetcher(item).then((result) => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex((p) => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Fallback method to fetch pools individually with bounded concurrency.
 * Uses a configurable concurrency limit to prevent request storms.
 * @param startId Starting pool ID
 * @param count Number of pools to fetch
 * @param concurrency Maximum concurrent requests (default: 5)
 */
async function getPoolsIndividually(
  startId: number,
  count: number,
  concurrency: number = DEFAULT_POOL_FETCH_CONCURRENCY
): Promise<PoolData[]> {
  const poolIds = Array.from({ length: count }, (_, i) => startId + i);
  
  const results = await fetchWithBoundedConcurrency(
    poolIds,
    (id) => getEnhancedPool(id),
    concurrency
  );

  return results.filter((pool): pool is PoolData => pool !== null);
}

/**
 * Fetch all pools with pagination support
 *
 * @param page - Zero-indexed page number to fetch
 * @param pageSize - Number of pools per page
 * @returns Pools for the requested page, sorted newest first
 *
 * @example
 * ```ts
 * const latest = await fetchAllPools(0, 50);
 * ```
 */
export async function fetchAllPools(page: number = 0, pageSize: number = 50): Promise<PoolData[]> {
  const totalCount = await getPoolCount();
  if (totalCount === 0) return [];

  const startId = Math.max(0, totalCount - (page * pageSize));
  const endId = Math.max(0, startId - pageSize + 1);
  const actualCount = startId - endId + 1;

  if (actualCount <= 0) return [];

  const pools = await getPoolsBatch(endId, actualCount);
  
  // Sort by pool ID descending (newest first)
  return pools.sort((a, b) => b.poolId - a.poolId);
}

/**
 * Get pool statistics using enhanced contract function
 *
 * @param poolId - ID of the pool to get stats for
 * @returns Total pool size and each outcome's percentage share, or null if unavailable
 */
export async function getPoolStats(poolId: number): Promise<{
  totalPool: number;
  percentageA: number;
  percentageB: number;
} | null> {
  try {
    logMarketDiscoveryNetworkOnce();
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();
    const result = await fetchCallReadOnlyFunction({
      contractAddress: cfg.contract.address,
      contractName: cfg.contract.name,
      functionName: 'get_pool_stats',
      functionArgs: [uintCV(poolId)],
      senderAddress: cfg.contract.address,
      network,
    });

    const value = cvToValue(result, true);
    if (!value) return null;

    return {
      totalPool: Number(value['total-pool'] || 0),
      percentageA: Number(value['percentage-a'] || 0),
      percentageB: Number(value['percentage-b'] || 0),
    };
  } catch (e) {
    log.error(`Failed to fetch pool stats ${poolId}`, e);
    return null;
  }
}
