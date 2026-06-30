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
 *     The bot settles using DEFAULT_WINNING_OUTCOME for every pool.
 *     This is suitable when:
 *       - The contract has a built-in oracle already writing the winner, OR
 *       - You are running a protocol-controlled market where a specific
 *         outcome is always authoritative (e.g., "resolved by admin"), OR
 *       - You have patched resolveWinningOutcome() below with your own logic.
 *
 *   Custom oracle integration
 *     Replace the resolveWinningOutcome() function body with a call to your
 *     off-chain oracle or API. The function receives the full Pool object so
 *     you can use pool.title / pool.outcome_a_name / pool.outcome_b_name to
 *     look up the correct outcome.
 */

import type { BotConfig } from "./config.js";
import type { CycleSummary, SettlementAttempt } from "./types.js";
import type { Pool } from "./types.js";
import { ContractClient } from "./contract-client.js";
import { Executor } from "./executor.js";
import { logger } from "./logger.js";
import { notify } from "./webhook.js";

// ─── Oracle hook ─────────────────────────────────────────────────────────────

/**
 * Determine the winning outcome index for an expired pool.
 *
 * Override this function to plug in your own oracle, data source, or
 * decision logic. The default implementation returns config.defaultWinningOutcome.
 *
 * Return null to skip settling this pool (the bot will log it as needing
 * manual settlement).
 */
async function resolveWinningOutcome(
  poolId: number,
  pool: Pool,
  config: BotConfig,
): Promise<number | null> {
  // ── CUSTOM ORACLE LOGIC HERE ──────────────────────────────────────────────
  //
  // Example: call an external API
  //   const res = await fetch(`https://oracle.example.com/resolve/${poolId}`);
  //   const { outcome } = await res.json();
  //   return outcome;  // 0 or 1
  //
  // Example: check pool title for known patterns
  //   if (pool.title.toLowerCase().includes("btc > 100k")) { ... }
  //
  // ─────────────────────────────────────────────────────────────────────────

  void poolId;
  void pool;

  return config.defaultWinningOutcome;
}

// ─── Poller ───────────────────────────────────────────────────────────────────

export class Poller {
  private readonly client: ContractClient;
  private readonly executor: Executor;
  private readonly config: BotConfig;
  private running = false;
  private cycleCount = 0;
  /** Pool IDs that failed in a previous cycle — tracked for escalation logging */
  private readonly persistentFailures = new Map<number, number>();

  constructor(config: BotConfig) {
    this.config = config;
    this.client = new ContractClient(config);
    this.executor = new Executor(config);
  }

  /**
   * Run one complete poll cycle.
   * Returns a summary of what was found and settled.
   */
  async runCycle(): Promise<CycleSummary> {
    const cycleStart = Date.now();
    this.cycleCount++;

    logger.info("Starting settlement cycle", {
      cycle: this.cycleCount,
      dryRun: this.config.dryRun,
      autoSettle: this.config.autoSettleEnabled,
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

      logger.info("Pool scan complete", {
        poolsScanned,
        poolsExpiredUnsettled,
        cycle: this.cycleCount,
      });

      if (poolsExpiredUnsettled === 0) {
        logger.info("No expired unsettled pools found");
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

      // ── Step 4: track persistent failures ───────────────────────────────
      for (const result of results) {
        if (result.success) {
          this.persistentFailures.delete(result.poolId);
        } else {
          const prev = this.persistentFailures.get(result.poolId) ?? 0;
          const failCount = prev + 1;
          this.persistentFailures.set(result.poolId, failCount);

          if (failCount >= 3) {
            logger.error("Pool has failed to settle repeatedly — manual intervention needed", {
              poolId: result.poolId,
              failureCount: failCount,
              lastError: result.error,
            });
          }
        }
      }

      // ── Step 5: notify ───────────────────────────────────────────────────
      const successfulSettlements = results.filter((r) => r.success);
      if (successfulSettlements.length > 0) {
        await notify(this.config, successfulSettlements);
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
        const timer = setTimeout(() => {
          resolve();
        }, this.config.pollIntervalMs);

        // Allow the timer to be cleared by stop()
        (this as unknown as Record<string, unknown>)["_sleepTimer"] = timer;
      });
    }

    logger.info("Settlement bot stopped gracefully");
  }

  stop(): void {
    this.running = false;
    const timer = (this as unknown as Record<string, unknown>)["_sleepTimer"];
    if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
  }
}
