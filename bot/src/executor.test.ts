/**
 * Unit tests for settlement outcome validation in the executor.
 */
import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { BotConfig } from "./config.js";
import { Executor, shouldRetrySettlement, validateSettlementOutcomesForTest } from "./executor.js";

describe("validateSettlementOutcomes", () => {
  it("accepts binary outcome indices 0 and 1", () => {
    expect(() =>
      validateSettlementOutcomesForTest([
        { poolId: 1, winningOutcome: 0 },
        { poolId: 2, winningOutcome: 1 },
      ]),
    ).not.toThrow();
  });

  it("rejects invalid winning outcome before submit", () => {
    expect(() =>
      validateSettlementOutcomesForTest([
        { poolId: 5, winningOutcome: 2 },
      ]),
    ).toThrow(/InvalidOutcome: pool 5 has winning outcome 2/);
  });

  it("rejects non-integer and negative winning outcomes", () => {
    expect(() =>
      validateSettlementOutcomesForTest([
        { poolId: 6, winningOutcome: -1 },
      ]),
    ).toThrow(/InvalidOutcome: pool 6 has winning outcome -1/);

    expect(() =>
      validateSettlementOutcomesForTest([
        { poolId: 7, winningOutcome: 1.5 },
      ]),
    ).toThrow(/InvalidOutcome: pool 7 has winning outcome 1.5/);
  });

  it("rejects invalid outcomes in dry-run mode instead of reporting success", async () => {
    const keypair = Keypair.random();
    const config = {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      network: "testnet",
      allowHttp: false,
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      botSecretKey: keypair.secret(),
      botPublicKey: keypair.publicKey(),
      pollIntervalMs: 1000,
      batchSize: 100,
      settleBatchSize: 20,
      dryRun: true,
      autoSettleEnabled: true,
      defaultWinningOutcome: 0,
      oracleUrl: null,
      oracleSecret: null,
      oracleFallbackToDefault: false,
      txPollIntervalMs: 100,
      txPollMaxAttempts: 2,
      maxRetries: 3,
      retryBaseDelayMs: 1,
      webhookUrl: null,
      webhookSecret: null,
      webhookTimeoutMs: 1000,
      logLevel: "error",
    } satisfies BotConfig;

    await expect(
      new Executor(config).settleAll([{ poolId: 9, winningOutcome: -1 }]),
    ).rejects.toThrow(/InvalidOutcome/);
  });
});

describe("settlement retry classification", () => {
  it("does not retry confirmation timeouts or shutdown aborts", () => {
    expect(shouldRetrySettlement(new Error("Transaction abc did not confirm within polling window"))).toBe(false);
    expect(shouldRetrySettlement(new Error("Transaction polling aborted"))).toBe(false);
  });

  it("still retries transient transport failures", () => {
    expect(shouldRetrySettlement(new Error("RPC connection reset"))).toBe(true);
  });
});
