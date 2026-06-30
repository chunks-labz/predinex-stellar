/**
 * Settlement executor.
 *
 * Builds, simulates, signs, and submits settle_pools batch transactions.
 * The bot wallet must be the contract admin.
 *
 * Gas efficiency:
 *   - Uses settle_pools() to batch up to 20 pools per transaction.
 *   - One transaction covers 20 pools; larger sets are split across
 *     multiple sequential transactions.
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
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { BotConfig } from "./config.js";
import type { SettlementAttempt } from "./types.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";

/** Soroban contract batch limit for settle_pools */
const BATCH_SETTLE_LIMIT = 20;
/** Base transaction fee in stroops */
const BASE_FEE = "1000";
/** Seconds before transaction expires */
const TX_TIMEOUT_SECS = 60;

export interface SettleCandidate {
  poolId: number;
  winningOutcome: number;
}

/**
 * Signs and submits the assembled Soroban transaction.
 * Returns the final transaction hash.
 */
async function submitTransaction(
  server: rpc.Server,
  assembledTx: Transaction,
  keypair: Keypair,
): Promise<string> {
  assembledTx.sign(keypair);
  const submission = await server.sendTransaction(assembledTx);

  if (submission.status === "ERROR") {
    throw new Error(
      `Transaction submission error: ${JSON.stringify(submission.errorResult ?? submission.status)}`,
    );
  }

  const hash = submission.hash;

  // Poll for finality (Stellar has ~5s block time)
  for (let poll = 0; poll < 30; poll++) {
    await new Promise((r) => setTimeout(r, 3000));
    const txResult = await server.getTransaction(hash);

    if (txResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
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
 * Returns the tx hash on success.
 */
async function submitSettleBatch(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  keypair: Keypair,
  candidates: SettleCandidate[],
): Promise<string> {
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

  // Assemble with the resource estimate embedded
  const assembledTx = rpc.assembleTransaction(tx, simulation).build();

  return submitTransaction(server, assembledTx, keypair);
}

/**
 * The main settlement executor.
 * Batches candidates into groups of ≤20 and submits each group.
 */
export class Executor {
  private readonly server: rpc.Server;
  private readonly keypair: Keypair;
  private readonly config: BotConfig;

  constructor(config: BotConfig) {
    this.server = new rpc.Server(config.rpcUrl, { allowHttp: false });
    this.keypair = Keypair.fromSecret(config.botSecretKey);
    this.config = config;
  }

  /**
   * Settle a list of expired pools.
   * Batches up to 20 per transaction.
   * Returns one SettlementAttempt per pool.
   */
  async settleAll(candidates: SettleCandidate[]): Promise<SettlementAttempt[]> {
    if (candidates.length === 0) return [];

    const results: SettlementAttempt[] = [];

    // Split into batches of BATCH_SETTLE_LIMIT
    for (let i = 0; i < candidates.length; i += BATCH_SETTLE_LIMIT) {
      const batch = candidates.slice(i, i + BATCH_SETTLE_LIMIT);

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
   * Settle a single batch of ≤20 pools.
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

      txHash = await withRetry(
        async () => {
          attemptCount++;
          return submitSettleBatch(
            this.server,
            networkPassphrase,
            contractId,
            this.keypair,
            batch,
          );
        },
        {
          maxRetries,
          baseDelayMs: retryBaseDelayMs,
          label: `settle_pools batch [${batch.map((c) => c.poolId).join(",")}]`,
          // Don't retry simulation errors — they indicate invalid arguments
          shouldRetry: (err) =>
            !String(err).includes("Simulation failed") &&
            !String(err).includes("InvalidOutcome") &&
            !String(err).includes("PoolNotExpired"),
        },
      );

      logger.info("settle_pools batch succeeded", {
        txHash,
        poolIds: batch.map((c) => c.poolId),
        attemptCount,
        durationMs: Date.now() - startMs,
      });

      return batch.map((c) => ({
        poolId: c.poolId,
        winningOutcome: c.winningOutcome,
        dryRun: false,
        txHash,
        success: true,
        attemptCount,
        durationMs: Date.now() - startMs,
      }));
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
