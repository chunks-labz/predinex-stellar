/**
 * TypeScript types mirroring the Soroban contract data structures.
 * See contracts/predinex/src/lib.rs for the canonical Rust definitions.
 */

/**
 * Mirrors the on-chain PoolStatus enum.
 * tag field matches the Soroban XDR enum variant name.
 */
export type PoolStatus =
  | { tag: "Open" }
  | { tag: "Settled"; values: [number] }
  | { tag: "Voided" }
  | { tag: "Frozen" }
  | { tag: "Disputed" }
  | { tag: "Cancelled" }
  | { tag: "Scheduled"; values: [bigint] };

/**
 * Mirrors the on-chain Pool struct.
 */
export interface Pool {
  creator: string;
  title: string;
  description: string;
  outcome_a_name: string;
  outcome_b_name: string;
  total_a: bigint;
  total_b: bigint;
  participant_count: number;
  settled: boolean;
  winning_outcome: number | null;
  created_at: bigint;
  /** Unix timestamp (seconds) — pool expired when Date.now()/1000 >= expiry */
  expiry: bigint;
  deposit_deadline: bigint;
  status: PoolStatus;
  cumulative_volume: bigint;
  template_id: number | null;
}

/**
 * A pool that the bot has identified as eligible for settlement.
 */
export interface ExpiredPool {
  poolId: number;
  pool: Pool;
  expiryTs: number; // epoch seconds
}

/**
 * Matches PoolSettleRequest in the contract for batch settlement.
 */
export interface PoolSettleRequest {
  pool_id: number;
  winning_outcome: number;
}

/**
 * Outcome of a single settle attempt.
 */
export interface SettlementAttempt {
  poolId: number;
  winningOutcome: number;
  dryRun: boolean;
  txHash?: string;
  success: boolean;
  error?: string;
  attemptCount: number;
  durationMs: number;
}

/**
 * Summary of one full polling cycle.
 */
export interface CycleSummary {
  cycleStartTs: number;
  poolsScanned: number;
  poolsExpiredUnsettled: number;
  settlementsAttempted: number;
  settlementsSucceeded: number;
  settlementsFailed: number;
  durationMs: number;
}

/**
 * Runtime metrics exposed by the Poller for the health check server.
 */
export interface PollerMetrics {
  /** Whether the poll loop is currently running. */
  running: boolean;
  /** Total number of poll cycles completed since startup. */
  cycleCount: number;
  /** ISO 8601 timestamp of the last cycle that settled at least one pool, or null if none yet. */
  lastSettlementAt: string | null;
  /** Number of expired-but-unsettled pools observed in the most recent cycle. */
  pendingPoolsCount: number;
  /** Cumulative count of failed settlement attempts and unhandled cycle errors. */
  errorCount: number;
  /**
   * Number of pools currently tracked in the consecutive-failure map. Bounded
   * by the size of the active scan, so a steady climb here signals a leak.
   */
  trackedFailurePools: number;
}

/**
 * Context passed from the poller into the webhook so orchestrators can
 * correlate settlements with on-chain events and identify bot instances.
 */
export interface SettlementCycleContext {
  /** Monotonically increasing cycle counter (starts at 1). */
  cycleNumber: number;
  /** Short identifier for this bot instance (derived from the secret key). */
  instanceId: string;
  /** ISO 8601 timestamp of when the settlement cycle completed. */
  settlementTimestamp: string;
}

/**
 * Mirrors the on-chain incentive configuration.
 * The volume bonus is expressed as a whole percentage (e.g., 2 = 2%).
 */
export interface IncentiveConfig {
  /** Percentage used when calculating the volume bonus. */
  volumeBonusPercent: number;
}
