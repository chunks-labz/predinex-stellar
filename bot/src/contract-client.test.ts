/**
 * Unit tests for ContractClient transient RPC retry behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Account, Keypair, nativeToScVal, rpc, StrKey } from "@stellar/stellar-sdk";
import { ContractClient } from "./contract-client.js";
import type { BotConfig } from "./config.js";

const VALID_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  const keypair = Keypair.random();
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
    allowHttp: false,
    contractId: VALID_CONTRACT_ID,
    botSecretKey: keypair.secret(),
    botPublicKey: keypair.publicKey(),
    pollIntervalMs: 300_000,
    batchSize: 100,
    settleBatchSize: 20,
    dryRun: false,
    autoSettleEnabled: true,
    defaultWinningOutcome: 0,
    oracleUrl: null,
    oracleSecret: null,
    oracleFallbackToDefault: false,
    txPollIntervalMs: 3_000,
    txPollMaxAttempts: 30,
    maxRetries: 2,
    retryBaseDelayMs: 0,
    webhookUrl: null,
    webhookSecret: null,
    failureAlertThreshold: 3,
    failureAlertIntervalMs: 3600000,
    failureMaxCountCeiling: 100,
    ...overrides,
  };
}

describe("ContractClient retry behavior", () => {
  const config = makeConfig({
    maxRetries: 2,
    retryBaseDelayMs: 0,
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(rpc.Api, "isSimulationError").mockImplementation(
      (res: unknown) => Boolean((res as { error?: unknown })?.error),
    );
    vi.spyOn(rpc.Api, "isSimulationSuccess").mockImplementation(
      (res: unknown) => Boolean((res as { result?: unknown })?.result),
    );
  });

  it("succeeds on first attempt when RPC does not fail", async () => {
    const mockGetAccount = vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
      new Account(config.botPublicKey, "100"),
    );

    const mockSimulate = vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: nativeToScVal(0),
      },
    } as any);

    const client = new ContractClient(config);
    const count = await client.getPoolCount();

    expect(count).toBe(0);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it("retries on transient RPC getAccount network failure and succeeds", async () => {
    let attempts = 0;
    const mockGetAccount = vi.spyOn(rpc.Server.prototype, "getAccount").mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("HTTP 503 Service Unavailable");
      }
      return new Account(config.botPublicKey, "100");
    });

    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: nativeToScVal(5),
      },
    } as any);

    const client = new ContractClient(config);
    const count = await client.getPoolCount();

    expect(count).toBe(5);
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  it("retries on transient simulateTransaction failure and succeeds", async () => {
    vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
      new Account(config.botPublicKey, "100"),
    );

    let attempts = 0;
    const mockSimulate = vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("HTTP 429 Too Many Requests");
      }
      return {
        result: {
          retval: nativeToScVal(10),
        },
      } as any;
    });

    const client = new ContractClient(config);
    const count = await client.getPoolCount();

    expect(count).toBe(10);
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting maxRetries on persistent transient error", async () => {
    const mockGetAccount = vi.spyOn(rpc.Server.prototype, "getAccount").mockRejectedValue(
      new Error("Connection reset by peer"),
    );

    const client = new ContractClient(config);

    await expect(client.getPoolCount()).rejects.toThrow("Connection reset by peer");
    // Initial attempt + 2 retries = 3 total attempts
    expect(mockGetAccount).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on permanent contract simulation errors", async () => {
    const mockGetAccount = vi.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(
      new Account(config.botPublicKey, "100"),
    );

    const mockSimulate = vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      error: "Host function error: BadContractArgs",
    } as any);

    const client = new ContractClient(config);

    await expect(client.getPoolCount()).rejects.toThrow("Simulation error for get_pool_count");
    // Fails fast on 1st attempt (no retries)
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });
});
