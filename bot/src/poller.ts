/**
 * Polling orchestrator.
 *
 * Runs a periodic loop that:
 *   1. Scans all pools for expired-but-unsettled entries.
 *   2. Determines the winning outcome for each (oracle or default).
 *   3. Batches them into settle_pools calls.
 *   4. Logs and notifies on results.
 *
 * Winning outcome resolution
 * ─────────────────────────
 * Binary prediction pools require an external signal to determine the winner.
 * The bot supports two modes:
 *
 *   AUTO_SETTLE_ENABLED=false (default)
 *     The bot only LOGS expired pools — it does NOT submit transactions.
 *     A human admin reviews the list and calls settle_pool manually (or
 *     integrates an oracle before enabling auto-settle).
 *
 *   AUTO_SETTLE_ENABLED=true
 *     The bot resolves each pool's winning outcome via a three-step chain:
 *
 *       1. External oracle API (ORACLE_URL)
 *          GET {ORACLE_URL}/resolve/{poolId}
 *          Returns { "outcome": 0 | 1 } to settle, { "outcome": null } to skip.
 *          HTTP errors or malformed responses fall through to step 2.
 *
 *       2. On-chain winning_outcome field
 *          If an admin has already written the outcome to the pool on-chain,
 *          it is used directly.
 *
 *       3. Default fallback (ORACLE_FALLBACK_TO_DEFAULT=true only)
 *          Falls back to DEFAULT_WINNING_OUTCOME. Intentionally opt-in to
 *          prevent silent mis-settlement in production.
 *
 *       4. Skip — pool is logged for manual settlement.
 *
 *   Custom oracle integration
 *     Set ORACLE_URL to point at your resolution service.
 *     Optionally set ORACLE_SECRET for Bearer-token authentication.
 */

import type { BotConfig } from "./config.js";
import type { CycleSummary, PollerMetrics, SettlementAttempt, SettlementCycleContext } from "./types.js";
import type { Pool } from "./types.js";
import { ContractClient } from "./contract-client.js";
import { Executor } from "./executor.js";
import { logger } from "./logger.js";
import { notify } from "./webhook.js";

// ─── Oracle hook ─────────────────────────────────────────────────────────────

/**
 * Response shape expected from the external oracle endpoint.
 *
 * GET {oracleUrl}/resolve/{poolId}
 *   Headers: Authorization: Bearer {oracleSecret}  (if configured)
 *
 * Expected JSON body:
 *   { "outcome": 0 }   // 0 = outcome_a wins, 1 = outcome_b wins
 *   { "outcome": null } // pool not yet resolvable — skip it
 *
 * Any HTTP error (non-2xx) or unexpected body shape causes the oracle leg
 * to be skipped and the next fallback to be tried.
 */
interface OracleResponse {
  outcome: number | null;
}

/**
 * Validate that an unknown value is a valid outcome index (0 or 1).
 */
function isValidOutcome(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && (value === 0 || value === 1);
}

/**
 * Call the external oracle API to resolve a pool's winning outcome.
 *
 * Returns:
 *   - A number (0 or 1) if the oracle resolved successfully.
 *   - null if the oracle explicitly deferred resolution ("outcome": null).
 *   - undefined if the call failed or the response was malformed — caller
 *     should try the next fallback.
 */
async function queryOracle(
  oracleUrl: string,
  oracleSecret: string | null,
  poolId: number,
  pool: Pool,
): Promise<number | null | undefined> {
  const url = `${oracleUrl.replace(/\/$/, "")}/resolve/${poolId}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (oracleSecret) {
    headers["Authorization"] = `Bearer ${oracleSecret}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    logger.warn("Oracle request failed (network error) — will try fallback", {
      poolId,
      url,
      error: String(err),
    });
    return undefined; // signal: try next fallback
  }

  if (!response.ok) {
    logger.warn("Oracle returned non-2xx status — will try fallback", {
      poolId,
      url,
      status: response.status,
    });
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    logger.warn("Oracle response is not valid JSON — will try fallback", {
      poolId,
      url,
      error: String(err),
    });
    return undefined;
  }

  if (
    body === null ||
    typeof body !== "object" ||
    !("outcome" in (body as object))
  ) {
    logger.warn("Oracle response missing 'outcome' field — will try fallback", {
      poolId,
      url,
      body,
    });
    return undefined;
  }

  const { outcome } = body as OracleResponse;

  if (outcome === null) {
    // Oracle deliberately deferred — not yet resolvable
    logger.info("Oracle deferred resolution for pool", {
      poolId,
      title: pool.title,
    });
    return null;
  }

  if (!isValidOutcome(outcome)) {
    logger.warn("Oracle returned invalid outcome value — will try fallback", {
      poolId,
      url,
      outcome,
    });
    return undefined;
  }

  logger.info("Oracle resolved pool outcome", {
    poolId,
    outcome,
    outcomeLabel: outcome === 0 ? pool.outcome_a_name : pool.outcome_b_name,
  });

  return outcome;
}

/**
 * Determine the winning outcome index for an expired pool.
 *
 * Resolution is attempted in order:
 *
 *   1. External oracle API (if ORACLE_URL is set)
 *      GET {ORACLE_URL}/resolve/{poolId}
 *        → returns { outcome: 0 | 1 }  to settle
 *        → returns { outcome: null }   to skip (not yet resolvable)
 *        → HTTP error / bad body       falls through to step 2
 *
 *   2. On-chain winning_outcome field
 *      If the pool already has a winning_outcome written on-chain (e.g.
 *      by an admin or oracle contract), use it directly.
 *
 *   3. Default fallback (only when ORACLE_FALLBACK_TO_DEFAULT=true)
 *      Falls back to config.defaultWinningOutcome.
 *      This is intentionally opt-in to prevent silent mis-settlement in
 *      production environments that have not yet wired a real oracle.
 *
 *   4. Return null → pool is skipped and logged for manual settlement.
 *
 * Return null to skip settling this pool (the bot will log it as needing
 * manual settlement).
 */
export async function resolveWinningOutcome(
  poolId: number,
  pool: Pool,
  config: BotConfig,
): Promise<number | null> {
  // ── Step 1: external oracle ───────────────────────────────────────────────
  if (config.oracleUrl) {
    const oracleResult = await queryOracle(
      config.oracleUrl,
      config.oracleSecret,
      poolId,
      pool,
    );

    if (oracleResult !== undefined) {
      // undefined = oracle failed / skipped; null or number = intentional answer
      return oracleResult;
    }
    // fall through to on-chain check
  }

  // ── Step 2: on-chain winning_outcome ─────────────────────────────────────
  // Pools in Open status won't normally have this set, but it costs nothing
  // to check (an admin might have written it via a separate mechanism).
  if (isValidOutcome(pool.winning_outcome)) {
    logger.info("Using on-chain winning_outcome for pool", {
      poolId,
      outcome: pool.winning_outcome,
    });
    return pool.winning_outcome;
  }

  // ── Step 3: explicit default fallback ────────────────────────────────────
  if (config.oracleFallbackToDefault) {
    logger.warn(
      "Could not resolve outcome from oracle or on-chain — using DEFAULT_WINNING_OUTCOME (ORACLE_FALLBACK_TO_DEFAULT=true)",
      {
        poolId,
        title: pool.title,
        defaultWinningOutcome: config.defaultWinningOutcome,
      },
    );
    return config.defaultWinningOutcome;
  }

  // ── Step 4: skip ─────────────────────────────────────────────────────────
  logger.warn(
    "Could not resolve winning outcome — skipping pool (set ORACLE_URL or ORACLE_FALLBACK_TO_DEFAULT=true to enable auto-settlement)",
    {
      poolId,
      title: pool.title,
      outcome_a: pool.outcome_a_name,
      outcome_b: pool.outcome_b_name,
    },
  );
  return null;
}

// ─── Poller ───────────────────────────────────────────────────────────────────

/**
 * Consecutive-failure count at which a pool is escalated in the logs.
 */
export const FAILURE_ESCALATION_THRESHOLD = 3;

/**
 * Hard ceiling on a pool's tracked consecutive-failure count.
 *
 * Once a pool reaches this many consecutive failures it is treated as
 * permanently broken (auth failure, contract panic, …): it is escalated once,
 * then evicted from the tracking map. It re-enters tracking from zero if a
 * later cycle attempts it again, so a transient outage still recovers, but the
 * counter can never grow without bound.
 */
export const MAX_FAILURE_COUNT = 10;

export class Poller {
  private readonly client: ContractClient;
  private readonly executor: Executor;
  private readonly config: BotConfig;
  private running = false;
  private cycleCount = 0;
  private _sleepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Unique instance identifier for multi-instance debugging */
  private readonly instanceId: string;
  /**
   * Pool IDs that failed in a previous cycle -- tracked for escalation logging.
   *
   * Bounded on both axes: each value is capped at {@link MAX_FAILURE_COUNT}
   * (entries are evicted once they reach it), and every cycle prunes entries
   * for pools that are no longer in the active expired-unsettled scan.
   */
  private readonly persistentFailures = new Map<number, number>();
  /** Epoch ms of the last cycle that successfully settled at least one pool */
  private lastSettlementTs: number | null = null;
  /** Cumulative count of failed settlement attempts and unhandled cycle errors */
  private errorCount = 0;
  /** Number of expired-but-unsettled pools found in the most recent cycle */
  private pendingPoolsCount = 0;
  /** AbortController for interrupting in-flight operations on shutdown */
  private abortController: AbortController | null = null;

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new ContractClient(config);
    this.executor = new Executor(config);
    // Generate a short instance ID from the bot's public key for logging
    this.instanceId = config.botPublicKey.slice(0, 10);
  }

  /**
   * Run one complete poll cycle.
   * Returns a summary of what was found and settled.
   */
  async runCycle(): Promise<CycleSummary> {
    const cycleStart = Date.now();
    this.cycleCount++;

    // Create a new AbortController for this cycle
    this.abortController = new AbortController();
    this.executor.setSignal(this.abortController.signal);

    logger.info("Starting settlement cycle", {
      cycle: this.cycleCount,
      instance: this.instanceId,
      dryRun: this.config.dryRun,
      autoSettle: this.config.autoSettleEnabled,
      settleBatchSize: this.config.settleBatchSize,
    });

    let poolsScanned = 0;
    let poolsExpiredUnsettled = 0;
    let settlementsAttempted = 0;
    let settlementsSucceeded = 0;
    let settlementsFailed = 0;

    try {
      // ── Step 1: find expired unsettled pools ────────────────────────────
      const expired = await this.client.findExpiredUnsettledPools(
        this.config.batchSize,
      );

      // We need the total pool count for the "scanned" metric but we already
      // fetched it inside findExpiredUnsettledPools. Re-fetch is cheap enough.
      poolsScanned = await this.client.getPoolCount();
      poolsExpiredUnsettled = expired.length;

      // Drop failure counters for pools that are no longer candidates (settled
      // elsewhere, voided, or out of the scan range). Without this the map
      // grows for the lifetime of the process.
      this.pruneFailureTracking(new Set(expired.map(({ poolId }) => poolId)));

      logger.info("Pool scan complete", {
        poolsScanned,
        poolsExpiredUnsettled,
        cycle: this.cycleCount,
      });

      if (poolsExpiredUnsettled === 0) {
        logger.info("No expired unsettled pools found");
        this.pendingPoolsCount = 0;
        return {
          cycleStartTs: cycleStart,
          poolsScanned,
          poolsExpiredUnsettled: 0,
          settlementsAttempted: 0,
          settlementsSucceeded: 0,
          settlementsFailed: 0,
          durationMs: Date.now() - cycleStart,
        };
      }

      // ── Step 2: resolve winning outcomes ────────────────────────────────
      const candidates: Array<{ poolId: number; winningOutcome: number }> = [];

      for (const { poolId, pool } of expired) {
        if (!this.config.autoSettleEnabled) {
          // Alert mode only: log but don't settle
          logger.warn("Pool needs manual settlement (AUTO_SETTLE_ENABLED=false)", {
            poolId,
            title: pool.title,
            expiry: new Date(Number(pool.expiry) * 1000).toISOString(),
            participant_count: pool.participant_count,
            outcome_a: pool.outcome_a_name,
            outcome_b: pool.outcome_b_name,
          });
          continue;
        }

        const winningOutcome = await resolveWinningOutcome(poolId, pool, this.config);

        if (winningOutcome === null) {
          logger.warn("Could not resolve winning outcome — skipping pool", {
            poolId,
            title: pool.title,
          });
          continue;
        }

        candidates.push({ poolId, winningOutcome });
      }

      if (candidates.length === 0) {
        logger.info("No pools to settle in this cycle", {
          reason: this.config.autoSettleEnabled
            ? "all outcomes unresolvable"
            : "AUTO_SETTLE_ENABLED=false",
        });

        this.pendingPoolsCount = poolsExpiredUnsettled;
        return {
          cycleStartTs: cycleStart,
          poolsScanned,
          poolsExpiredUnsettled,
          settlementsAttempted: 0,
          settlementsSucceeded: 0,
          settlementsFailed: 0,
          durationMs: Date.now() - cycleStart,
        };
      }

      // ── Step 3: execute settlements ──────────────────────────────────────
      settlementsAttempted = candidates.length;
      const results: SettlementAttempt[] = await this.executor.settleAll(candidates);

      settlementsSucceeded = results.filter((r) => r.success).length;
      settlementsFailed = results.filter((r) => !r.success).length;
      this.errorCount += settlementsFailed;
      this.pendingPoolsCount = poolsExpiredUnsettled - settlementsSucceeded;

      // ── Step 4: track persistent failures ───────────────────────────────
      for (const result of results) {
        if (result.success) {
          this.persistentFailures.delete(result.poolId);
        } else if (result.error?.includes("PoolAlreadySettled")) {
          // Another instance settled this pool first — not a real failure
          logger.info("Pool already settled by another instance", {
            instance: this.instanceId,
            poolId: result.poolId,
          });
          this.persistentFailures.delete(result.poolId);
        } else {
          const prev = this.persistentFailures.get(result.poolId) ?? 0;
          const failCount = prev + 1;

          if (failCount >= MAX_FAILURE_COUNT) {
            // Treat as permanently broken: alert once, then stop tracking so a
            // pool that never succeeds cannot pin an entry forever.
            logger.error(
              "Pool hit the maximum consecutive failure count — giving up tracking it, settle it manually",
              {
                poolId: result.poolId,
                failureCount: failCount,
                maxFailureCount: MAX_FAILURE_COUNT,
                lastError: result.error,
              },
            );
            this.persistentFailures.delete(result.poolId);
          } else {
            this.persistentFailures.set(result.poolId, failCount);

            if (failCount >= FAILURE_ESCALATION_THRESHOLD) {
              logger.error("Pool has failed to settle repeatedly — manual intervention needed", {
                poolId: result.poolId,
                failureCount: failCount,
                lastError: result.error,
              });
            }
          }
        }
      }

      // ── Step 5: notify ───────────────────────────────────────────────────
      const successfulSettlements = results.filter((r) => r.success);
      if (successfulSettlements.length > 0) {
        this.lastSettlementTs = Date.now();
        const cycleContext: SettlementCycleContext = {
          cycleNumber: this.cycleCount,
          instanceId: this.instanceId,
          settlementTimestamp: new Date().toISOString(),
        };
        await notify(this.config, successfulSettlements, cycleContext);
      }

      logger.info("Settlement cycle complete", {
        cycle: this.cycleCount,
        poolsScanned,
        poolsExpiredUnsettled,
        settlementsAttempted,
        settlementsSucceeded,
        settlementsFailed,
        durationMs: Date.now() - cycleStart,
      });
    } catch (err) {
      this.errorCount += 1;
      logger.error("Settlement cycle encountered unhandled error", {
        cycle: this.cycleCount,
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined,
        durationMs: Date.now() - cycleStart,
      });
    }

    return {
      cycleStartTs: cycleStart,
      poolsScanned,
      poolsExpiredUnsettled,
      settlementsAttempted,
      settlementsSucceeded,
      settlementsFailed,
      durationMs: Date.now() - cycleStart,
    };
  }

  /**
   * Drop consecutive-failure entries for pools outside the current scan.
   *
   * A pool leaves the scan once it is settled, voided, or falls out of the
   * scanned range, at which point its failure history is no longer actionable.
   * Keeping the map a subset of the active scan is what bounds its size
   * regardless of how many pools the contract has accumulated.
   */
  private pruneFailureTracking(activePoolIds: Set<number>): void {
    if (this.persistentFailures.size === 0) return;

    const pruned: number[] = [];
    for (const poolId of this.persistentFailures.keys()) {
      if (!activePoolIds.has(poolId)) {
        this.persistentFailures.delete(poolId);
        pruned.push(poolId);
      }
    }

    if (pruned.length > 0) {
      logger.debug("Pruned stale failure-tracking entries", {
        cycle: this.cycleCount,
        prunedPoolIds: pruned,
        tracked: this.persistentFailures.size,
      });
    }
  }

  /**
   * Start the polling loop. Runs indefinitely until stop() is called or
   * the process receives a termination signal.
   *
   * The interval timer is reset after each cycle completes so long-running
   * cycles don't pile up (scheduling is "every N ms after completion").
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn("Poller already running");
      return;
    }

    this.running = true;
    logger.info("Settlement bot started", {
      instance: this.instanceId,
      network: this.config.network,
      contractId: this.config.contractId,
      pollIntervalMs: this.config.pollIntervalMs,
      dryRun: this.config.dryRun,
      autoSettleEnabled: this.config.autoSettleEnabled,
    });

    while (this.running) {
      await this.runCycle();

      if (!this.running) break;

      logger.debug("Sleeping until next cycle", {
        sleepMs: this.config.pollIntervalMs,
      });
      await new Promise<void>((resolve) => {
        this._sleepTimer = setTimeout(() => {
          this._sleepTimer = null;
          resolve();
        }, this.config.pollIntervalMs);
      });
    }

    logger.info("Settlement bot stopped gracefully");
  }

  stop(): void {
    this.running = false;
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    this.abortController?.abort();
  }

  /**
   * Delegates to the contract client to verify the Stellar RPC endpoint
   * is reachable. Used by the health check server's readiness probe.
   */
  async checkReadiness(): ReturnType<ContractClient["checkRpcHealth"]> {
    return this.client.checkRpcHealth();
  }

  /**
   * Returns a snapshot of current runtime metrics for the health check
   * server's `/health/metrics` endpoint.
   */
  getMetrics(): PollerMetrics {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastSettlementAt: this.lastSettlementTs
        ? new Date(this.lastSettlementTs).toISOString()
        : null,
      pendingPoolsCount: this.pendingPoolsCount,
      errorCount: this.errorCount,
      trackedFailurePools: this.persistentFailures.size,
    };
  }
}
