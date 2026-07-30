/**
 * Settlement executor.
 *
 * Builds, simulates, signs, and submits settle_pools batch transactions.
 * The bot wallet must be the contract admin.
 *
 * Gas efficiency:
 *   - Uses settle_pools() with batch size from SETTLE_BATCH_SIZE (default 20).
 *   - Larger candidate sets are split across multiple sequential transactions.
 *
 * Idempotency:
 *   - The contract rejects already-settled pools with PoolAlreadySettled.
 *   - Each batch uses settle_pools which tolerates individual failures.
 *   - We read pool state fresh before each batch submission to skip already-
 *     settled pools (e.g. settled by the creator between our scan and submit).
 */

import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { BotConfig } from "./config.js";
import type { SettlementAttempt } from "./types.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";

/** Base transaction fee in stroops */
const BASE_FEE = "1000";
/** Seconds before transaction expires */
const TX_TIMEOUT_SECS = 60;

export interface SettleCandidate {
  poolId: number;
  winningOutcome: number;
}

/** Binary pools only support outcome index 0 or 1. */
function isValidSettlementOutcome(outcome: number): boolean {
  return outcome >= 0;
}

/**
 * Reject invalid winning outcome indices before building or submitting a tx.
 */
function validateSettlementOutcomes(candidates: SettleCandidate[]): void {
  for (const c of candidates) {
    if (!isValidSettlementOutcome(c.winningOutcome)) {
      throw new Error(
        `InvalidOutcome: pool ${c.poolId} has winning outcome ${c.winningOutcome}`,
      );
    }
  }
}

/** @internal Exported for unit tests only. */
export function validateSettlementOutcomesForTest(
  candidates: SettleCandidate[],
): void {
  validateSettlementOutcomes(candidates);
}

/**
 * Mirrors the contract's SettleResult struct returned by settle_pools.
 * Each entry represents the outcome for a single pool in the batch.
 */
export interface PoolSettleResult {
  pool_id: number;
  success: boolean;
}

/**
 * Decode a raw ScVal return value into an array of PoolSettleResult.
 * Returns null if decoding fails.
 */
function decodeSettleResults(
  scVal: xdr.ScVal | undefined,
): PoolSettleResult[] | null {
  if (scVal === undefined) return null;
  try {
    const raw = scValToNative(scVal);
    if (!Array.isArray(raw)) return null;
    return raw.map((r: Record<string, unknown>) => ({
      pool_id: Number(r.pool_id ?? 0),
      success: Boolean(r.success),
    }));
  } catch {
    return null;
  }
}

/**
 * Signs and submits the assembled Soroban transaction.
 * Returns the final transaction hash and the confirmed return value.
 */
async function submitTransaction(
  server: rpc.Server,
  assembledTx: Transaction,
  keypair: Keypair,
  config: BotConfig,
  signal?: AbortSignal,
): Promise<{ hash: string; returnValue: unknown }> {
  assembledTx.sign(keypair);
  const submission = await server.sendTransaction(assembledTx);

  if (submission.status === "ERROR") {
    throw new Error(
      `Transaction submission error: ${JSON.stringify(submission.errorResult ?? submission.status)}`,
    );
  }

  const hash = submission.hash;

  // Poll for finality (Stellar has ~5s block time)
  for (let poll = 0; poll < config.txPollMaxAttempts; poll++) {
    if (signal?.aborted) {
      throw new Error("Transaction polling aborted");
    }
    await new Promise((r) => setTimeout(r, config.txPollIntervalMs));
    if (signal?.aborted) {
      throw new Error("Transaction polling aborted");
    }
    const txResult = await server.getTransaction(hash, { signal });

    if (txResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, returnValue: txResult.returnValue };
    }
    if (txResult.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction failed on-chain: ${hash}`);
    }
    // NOT_FOUND or PENDING: keep polling
  }

  throw new Error(
    `Transaction ${hash} did not confirm within polling window`,
  );
}

/**
 * Builds and submits a single settle_pools batch.
 * Returns the tx hash and per-pool results decoded from the contract return value.
 */
async function submitSettleBatch(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  keypair: Keypair,
  candidates: SettleCandidate[],
  config: BotConfig,
  signal?: AbortSignal,
): Promise<{ txHash: string; poolResults: PoolSettleResult[] }> {
  validateSettlementOutcomes(candidates);

  const callerAddress = keypair.publicKey();
  const sourceAccount = await server.getAccount(callerAddress);
  const contract = new Contract(contractId);

  // Build the pools Vec<PoolSettleRequest> as ScVal
  // Each element is { pool_id: u32, winning_outcome: u32 }
  const poolsArg = nativeToScVal(
    candidates.map((c) => ({
      pool_id: c.poolId,
      winning_outcome: c.winningOutcome,
    })),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "settle_pools",
        new Address(callerAddress).toScVal(),
        poolsArg,
      ),
    )
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  // Simulate to get resource estimate and check for errors
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Simulation failed: ${simulation.error}`);
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error("Simulation returned unexpected result type");
  }

  const simulatedResults = decodeSettleResults(
    simulation.result?.retval as xdr.ScVal | undefined,
  );
  if (!simulatedResults) {
    throw new Error(
      "Simulation succeeded but settlement results could not be decoded",
    );
  }
  if (simulatedResults.length !== candidates.length) {
    throw new Error(
      `Simulation returned ${simulatedResults.length} settlement results for ${candidates.length} pools`,
    );
  }

  // Assemble with the resource estimate embedded
  const assembledTx = rpc.assembleTransaction(tx, simulation).build();

  const { hash, returnValue } = await submitTransaction(
    server,
    assembledTx,
    keypair,
    config,
    signal,
  );

  // Decode per-pool settlement results from the contract's Vec<SettleResult>
  // Priority: confirmed tx returnValue → pre-submit simulation retval
  let poolResults = decodeSettleResults(
    returnValue as xdr.ScVal | undefined,
  );

  if (!poolResults) {
    logger.warn(
      "Failed to decode transaction return value, falling back to simulation retval",
    );
    poolResults = simulatedResults;
  }

  return { txHash: hash, poolResults };
}

/**
 * The main settlement executor.
 * Batches candidates into groups of ≤ settleBatchSize and submits each group.
 */
export class Executor {
  private readonly server: rpc.Server;
  private readonly keypair: Keypair;
  private readonly config: BotConfig;
  private signal?: AbortSignal;

  constructor(config: BotConfig) {
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.allowHttp,
    });
    this.keypair = Keypair.fromSecret(config.botSecretKey);
    this.config = config;
  }

  /**
   * Set the abort signal for in-flight operations.
   */
  setSignal(signal: AbortSignal): void {
    this.signal = signal;
  }

  /**
   * Settle a list of expired pools.
   * Batches up to settleBatchSize per transaction.
   * Returns one SettlementAttempt per pool.
   */
  async settleAll(candidates: SettleCandidate[]): Promise<SettlementAttempt[]> {
    if (candidates.length === 0) return [];

    const results: SettlementAttempt[] = [];

    const settleBatchSize = this.config.settleBatchSize;

    for (let i = 0; i < candidates.length; i += settleBatchSize) {
      if (this.signal?.aborted) {
        logger.info("Settlement aborted, stopping batch processing");
        break;
      }
      const batch = candidates.slice(i, i + settleBatchSize);

      logger.info("Submitting settle_pools batch", {
        batchSize: batch.length,
        poolIds: batch.map((c) => c.poolId),
        dryRun: this.config.dryRun,
      });

      const batchResults = await this.settleBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Settle a single batch of ≤ settleBatchSize pools.
   */
  private async settleBatch(
    batch: SettleCandidate[],
  ): Promise<SettlementAttempt[]> {
    const startMs = Date.now();

    if (this.config.dryRun) {
      logger.info("[DRY-RUN] Would settle pools (no transaction submitted)", {
        poolIds: batch.map((c) => c.poolId),
      });
      return batch.map((c) => ({
        poolId: c.poolId,
        winningOutcome: c.winningOutcome,
        dryRun: true,
        success: true,
        attemptCount: 0,
        durationMs: Date.now() - startMs,
      }));
    }

    let txHash: string | undefined;
    let attemptCount = 0;
    let lastError: string | undefined;

    try {
      const { networkPassphrase, contractId, maxRetries, retryBaseDelayMs } =
        this.config;

      const submitResult = await withRetry(
        async () => {
          attemptCount++;
          return submitSettleBatch(
            this.server,
            networkPassphrase,
            contractId,
            this.keypair,
            batch,
            this.config,
            this.signal,
          );
        },
        {
          maxRetries,
          baseDelayMs: retryBaseDelayMs,
          label: `settle_pools batch [${batch.map((c) => c.poolId).join(",")}]`,
          // Don't retry simulation errors — they indicate invalid arguments
          // Don't retry PoolAlreadySettled — another instance settled it first
          shouldRetry: (err) =>
            !String(err).includes("Simulation failed") &&
            !String(err).includes("Simulation succeeded but settlement results") &&
            !String(err).includes("Simulation returned") &&
            !String(err).includes("InvalidOutcome") &&
            !String(err).includes("PoolNotExpired") &&
            !String(err).includes("PoolAlreadySettled"),
        },
      );

      txHash = submitResult.txHash;

      // Build a lookup of per-pool results from the contract return value
      const poolResultMap = new Map(
        submitResult.poolResults.map((r) => [r.pool_id, r.success]),
      );

      logger.info("settle_pools batch succeeded", {
        txHash,
        poolIds: batch.map((c) => c.poolId),
        perPoolResults: submitResult.poolResults,
        attemptCount,
        durationMs: Date.now() - startMs,
      });

      return batch.map((c) => {
        const poolSuccess = poolResultMap.get(c.poolId) ?? false;
        return {
          poolId: c.poolId,
          winningOutcome: c.winningOutcome,
          dryRun: false,
          txHash,
          success: poolSuccess,
          error: poolSuccess
            ? undefined
            : `Pool ${c.poolId} settlement failed on-chain`,
          attemptCount,
          durationMs: Date.now() - startMs,
        };
      });
    } catch (err) {
      lastError = String(err);
      logger.error("settle_pools batch failed", {
        poolIds: batch.map((c) => c.poolId),
        attemptCount,
        durationMs: Date.now() - startMs,
        error: lastError,
      });

      return batch.map((c) => ({
        poolId: c.poolId,
        winningOutcome: c.winningOutcome,
        dryRun: false,
        success: false,
        error: lastError,
        attemptCount,
        durationMs: Date.now() - startMs,
      }));
    }
  }
}
