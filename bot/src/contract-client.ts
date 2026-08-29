/**
 * Read-only Soroban contract client.
 *
 * Uses simulateTransaction to call view functions:
 *   - get_pool_count()
 *   - get_pools_batch(start_id, count)
 *
 * No authentication or signing required for reads.
 */

import {
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import type { BotConfig } from "./config.js";
import type { Pool, PoolStatus } from "./types.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";

/** Maximum ledger sequence validity window for simulation txns (5 min at ~5s/ledger) */
const SIMULATE_TIMEOUT_SECS = 60;

/**
 * Builds and simulates a read-only Soroban call with retry logic for transient RPC errors.
 * Returns the deserialized return value or throws on error.
 */
async function simulateContractCall(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  /** A dummy source account — we only need a valid public key for building */
  sourcePublicKey: string,
  functionName: string,
  args: xdr.ScVal[],
  config: BotConfig,
): Promise<unknown> {
  return withRetry(
    async () => {
      const sourceAccount = await server.getAccount(sourcePublicKey);

      const contract = new Contract(contractId);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(contract.call(functionName, ...args))
        .setTimeout(SIMULATE_TIMEOUT_SECS)
        .build();

      const result = await server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(result)) {
        throw new Error(
          `Simulation error for ${functionName}: ${result.error}`,
        );
      }

      if (!rpc.Api.isSimulationSuccess(result) || !result.result) {
        throw new Error(
          `Simulation returned no result for ${functionName}`,
        );
      }

      return scValToNative(result.result.retval);
    },
    {
      maxRetries: config.maxRetries,
      baseDelayMs: config.retryBaseDelayMs,
      label: `simulateContractCall [${functionName}]`,
      shouldRetry: (err) => {
        const msg = String(err);
        return (
          !msg.includes("Simulation error for") &&
          !msg.includes("Simulation returned no result")
        );
      },
    },
  );
}

/**
 * Soroban contract read client.
 * Reads pool data without requiring any private key.
 */
export class ContractClient {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly contractId: string;
  /** Public key used as the simulated source — does not need funds for reads */
  private readonly sourcePublicKey: string;
  private readonly config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.server = new rpc.Server(config.rpcUrl, {
      allowHttp: config.allowHttp,
    });
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    // Use public key for simulation source
    this.sourcePublicKey = config.botPublicKey;
  }

  /**
   * Returns the current pool counter (highest pool_id ever created).
   * Pool IDs are sequential starting from 1.
   */
  async getPoolCount(): Promise<number> {
    const result = await simulateContractCall(
      this.server,
      this.networkPassphrase,
      this.contractId,
      this.sourcePublicKey,
      "get_pool_count",
      [],
      this.config,
    );
    return Number(result as bigint | number);
  }

  /**
   * Fetches a batch of pools from the contract.
   * Returns an array where missing pool IDs are represented as null.
   * The contract caps count at 100 per call.
   *
   * @param startId - First pool ID to fetch (inclusive)
   * @param count   - How many to fetch (max 100)
   */
  async getPoolsBatch(startId: number, count: number): Promise<(Pool | null)[]> {
    const result = await simulateContractCall(
      this.server,
      this.networkPassphrase,
      this.contractId,
      this.sourcePublicKey,
      "get_pools_batch",
      [
        nativeToScVal(startId, { type: "u32" }),
        nativeToScVal(Math.min(count, 100), { type: "u32" }),
      ],
      this.config,
    );

    // scValToNative returns an array of pool objects or nulls
    const raw = result as Array<Record<string, unknown> | null>;

    return raw.map((item, index): Pool | null => {
      if (!item) return null;

      // Normalize status from scValToNative's enum representation.
      // A pool whose status cannot be recognised is treated as unreadable
      // rather than assumed Open, so the poller never tries to settle it.
      const status = normalizeStatus(item["status"]);
      if (!status) {
        logger.warn("Skipping pool with unrecognised status", {
          poolId: startId + index,
          rawStatus: item["status"],
        });
        return null;
      }

      return {
        creator: String(item["creator"]),
        title: String(item["title"] ?? ""),
        description: String(item["description"] ?? ""),
        outcome_a_name: String(item["outcome_a_name"] ?? ""),
        outcome_b_name: String(item["outcome_b_name"] ?? ""),
        total_a: BigInt(String(item["total_a"] ?? 0)),
        total_b: BigInt(String(item["total_b"] ?? 0)),
        participant_count: Number(item["participant_count"] ?? 0),
        settled: Boolean(item["settled"]),
        winning_outcome:
          item["winning_outcome"] != null
            ? Number(item["winning_outcome"])
            : null,
        created_at: BigInt(String(item["created_at"] ?? 0)),
        expiry: BigInt(String(item["expiry"] ?? 0)),
        deposit_deadline: BigInt(String(item["deposit_deadline"] ?? 0)),
        status,
        cumulative_volume: BigInt(String(item["cumulative_volume"] ?? 0)),
        template_id:
          item["template_id"] != null ? Number(item["template_id"]) : null,
      };
    });
  }

  /**
   * Scans all pools in batches and returns those that are:
   *   - expired (expiry <= nowSecs)
   *   - status === "Open" (not settled, voided, frozen, etc.)
   *
   * @param batchSize - Pools per batch read (max 100)
   */
  async findExpiredUnsettledPools(
    batchSize: number,
  ): Promise<Array<{ poolId: number; pool: Pool }>> {
    const nowSecs = BigInt(Math.floor(Date.now() / 1000));
    const totalPools = await this.getPoolCount();

    logger.info("Scanning pools", { totalPools, batchSize });

    if (totalPools === 0) {
      logger.info("No pools found, nothing to settle");
      return [];
    }

    const expired: Array<{ poolId: number; pool: Pool }> = [];
    // Pool IDs start at 1
    let startId = 1;

    while (startId <= totalPools) {
      const count = Math.min(batchSize, totalPools - startId + 1);

      logger.debug("Fetching pool batch", { startId, count });

      const batch = await this.getPoolsBatch(startId, count);

      for (let i = 0; i < batch.length; i++) {
        const pool = batch[i];
        const poolId = startId + i;

        if (!pool) continue;

        const isOpen = pool.status.tag === "Open";
        const isExpired = pool.expiry <= nowSecs;

        if (isOpen && isExpired) {
          logger.debug("Found expired unsettled pool", {
            poolId,
            expiry: pool.expiry.toString(),
            nowSecs: nowSecs.toString(),
            participant_count: pool.participant_count,
          });
          expired.push({ poolId, pool });
        }
      }

      startId += count;
    }

    return expired;
  }

  /**
   * Checks whether the underlying Stellar RPC endpoint is reachable and
   * healthy. Used by the health check server's readiness probe.
   *
   * Returns `{ healthy: true, latestLedger }` on success, or
   * `{ healthy: false, error }` if the RPC call fails or times out.
   */
  async checkRpcHealth(): Promise<
    { healthy: true; latestLedger: number } | { healthy: false; error: string }
  > {
    try {
      const health = await this.server.getHealth();
      return { healthy: true, latestLedger: health.latestLedger };
    } catch (err) {
      return { healthy: false, error: String(err) };
    }
  }
}

/**
 * Discriminated union result from normalizeStatus indicating which branch parsed the value.
 */
export type NormalizedStatus = Pool["status"] & { source: "string" | "tag" | "keyed" };

/**
 * Every PoolStatus variant the contract can return.
 * Mirrors `pub enum PoolStatus` in contracts/predinex/src/lib.rs.
 */
const KNOWN_POOL_STATUS_TAGS = new Set<PoolStatus["tag"]>([
  "Open",
  "Settled",
  "Voided",
  "Frozen",
  "Disputed",
  "Cancelled",
  "Scheduled",
]);

function isKnownStatusTag(tag: unknown): tag is PoolStatus["tag"] {
  return typeof tag === "string" && KNOWN_POOL_STATUS_TAGS.has(tag as PoolStatus["tag"]);
}

/**
 * Normalize the status field from scValToNative's enum representation.
 * scValToNative returns enums as either a string ("Open") or an object
 * ({ "Settled": [0] } or { tag: "Settled", values: [0] }).
 *
 * Returns a discriminated union with a `source` field so callers can
 * distinguish which shape was parsed, or `null` when the value is not a
 * recognised status. Unrecognised values are never coerced to "Open": doing so
 * would make the settlement poller treat a malformed or newly-added status as
 * settleable and burn gas on transactions the contract would reject.
 */
export function normalizeStatus(raw: unknown): NormalizedStatus | null {
  const parsed = parseStatusShape(raw);

  if (!parsed) {
    logger.warn("normalizeStatus: unrecognised status shape, rejecting", {
      raw,
      type: typeof raw,
    });
    return null;
  }

  if (!isKnownStatusTag(parsed.tag)) {
    // A contract upgrade may introduce statuses this bot predates. Surface it
    // loudly instead of silently mapping it onto a known variant.
    logger.warn("normalizeStatus: unknown status tag, rejecting", {
      tag: parsed.tag,
      source: parsed.source,
      raw,
    });
    return null;
  }

  return parsed as NormalizedStatus;
}

/** Extracts `{ tag, values? }` from the shapes scValToNative produces, without validating the tag. */
function parseStatusShape(
  raw: unknown,
): { tag: string; values?: unknown; source: NormalizedStatus["source"] } | null {
  if (typeof raw === "string") {
    return { tag: raw, source: "string" };
  }

  if (!raw || typeof raw !== "object") return null;

  // Handle { tag: "Settled", values: [0] } form
  if ("tag" in raw) {
    const { tag } = raw as { tag: unknown };
    if (typeof tag !== "string") return null;
    return { ...(raw as object), tag, source: "tag" };
  }

  // Handle { "Open": [] } or { "Settled": [0] } form
  const key = Object.keys(raw as object)[0];
  if (!key) return null;

  const values = (raw as Record<string, unknown>)[key];
  if (Array.isArray(values) && values.length > 0) {
    return { tag: key, values, source: "keyed" };
  }
  return { tag: key, source: "keyed" };
}
