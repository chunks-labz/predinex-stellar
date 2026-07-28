/**
 * Security unit tests for botSecretKey isolation and non-leakage.
 *
 * Verifies that:
 *  1. instanceId is derived from the bot's public key (starts with 'G') and never leaks botSecretKey.
 *  2. Structured log lines do not contain botSecretKey or its prefix.
 *  3. A code-boundary check ensures botSecretKey is not referenced in bot/src/ files outside config.ts and executor.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Keypair } from "@stellar/stellar-sdk";

import type { BotConfig } from "./config.js";
import { deriveBotPublicKey } from "./config.js";
import { Poller } from "./poller.js";
import { logger } from "./logger.js";

// Mock external dependencies for Poller unit testing
const mocks = vi.hoisted(() => ({
  findExpiredUnsettledPools: vi.fn().mockResolvedValue([]),
  getPoolCount: vi.fn().mockResolvedValue(0),
  settleAll: vi.fn().mockResolvedValue([]),
}));

vi.mock("./contract-client.js", () => ({
  ContractClient: class {
    findExpiredUnsettledPools = mocks.findExpiredUnsettledPools;
    getPoolCount = mocks.getPoolCount;
  },
}));

vi.mock("./executor.js", () => ({
  Executor: class {
    settleAll = mocks.settleAll;
    setSignal = vi.fn();
  },
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeValidConfig(): { config: BotConfig; secretKey: string; publicKey: string } {
  const kp = Keypair.random();
  const secretKey = kp.secret();
  const publicKey = kp.publicKey();

  const config: BotConfig = {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
    allowHttp: false,
    contractId: "C" + "A".repeat(55),
    botSecretKey: secretKey,
    botPublicKey: publicKey,
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
    maxRetries: 3,
    retryBaseDelayMs: 1_000,
    webhookUrl: null,
    webhookSecret: null,
    webhookTimeoutMs: 10_000,
    logLevel: "info",
  };

  return { config, secretKey, publicKey };
}

describe("botSecretKey security & isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives public key correctly using deriveBotPublicKey", () => {
    const { secretKey, publicKey } = makeValidConfig();
    const derived = deriveBotPublicKey(secretKey);
    expect(derived).toBe(publicKey);
    expect(derived.startsWith("G")).toBe(true);
  });

  it("derives instanceId from public key and contains no secret key characters", async () => {
    const { config, secretKey, publicKey } = makeValidConfig();
    const poller = new Poller(config);

    await poller.runCycle();

    const expectedInstanceId = publicKey.slice(0, 10);
    const secretPrefix = secretKey.slice(0, 8);

    // Verify instanceId derived from public key
    const infoCalls = vi.mocked(logger.info).mock.calls;
    const cycleStartLog = infoCalls.find(([msg]) => String(msg).includes("Starting settlement cycle"));

    expect(cycleStartLog).toBeDefined();
    const meta = cycleStartLog![1] as { instance: string };
    expect(meta.instance).toBe(expectedInstanceId);
    expect(meta.instance.startsWith("G")).toBe(true);
    expect(meta.instance).not.toContain(secretPrefix);
  });

  it("ensures no log call outputs any portion of BOT_SECRET_KEY", async () => {
    const { config, secretKey } = makeValidConfig();
    const poller = new Poller(config);

    await poller.runCycle();

    const secretPrefix = secretKey.slice(0, 8);
    const allLogCalls = [
      ...vi.mocked(logger.debug).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.error).mock.calls,
    ];

    for (const [msg, meta] of allLogCalls) {
      const fullText = JSON.stringify({ msg, meta });
      expect(fullText).not.toContain(secretKey);
      expect(fullText).not.toContain(secretPrefix);
    }
  });

  it("enforces lint rule: botSecretKey is NOT referenced in src files outside config.ts and executor.ts", () => {
    const srcDir = join(process.cwd(), "src");
    const files = readdirSync(srcDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "config.ts" && f !== "executor.ts",
    );

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(join(srcDir, file), "utf-8");
      if (content.includes("botSecretKey")) {
        violations.push(file);
      }
    }

    expect(
      violations,
      `Forbidden botSecretKey reference found in runtime files: ${violations.join(", ")}. botSecretKey must only be referenced in config.ts and executor.ts.`,
    ).toEqual([]);
  });
});
