/**
 * Unit tests for the config loader.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("loadConfig", () => {
  const requiredEnv: Record<string, string> = {
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_NETWORK: "testnet",
    CONTRACT_ID: "C" + "A".repeat(55),
    BOT_SECRET_KEY: "S" + "A".repeat(55),
  };

  beforeEach(() => {
    // Set required env vars
    for (const [k, v] of Object.entries(requiredEnv)) {
      process.env[k] = v;
    }
  });

  afterEach(() => {
    // Clean up
    for (const k of Object.keys(requiredEnv)) {
      delete process.env[k];
    }
    delete process.env["DRY_RUN"];
    delete process.env["AUTO_SETTLE_ENABLED"];
    delete process.env["POLL_INTERVAL_MS"];
    delete process.env["BATCH_SIZE"];
    delete process.env["SETTLE_BATCH_SIZE"];
    delete process.env["LOG_LEVEL"];
    delete process.env["WEBHOOK_URL"];
    delete process.env["WEBHOOK_SECRET"];
    delete process.env["MAX_RETRIES"];
    delete process.env["RETRY_BASE_DELAY_MS"];
    delete process.env["DEFAULT_WINNING_OUTCOME"];
  });

  it("applies correct defaults for optional variables", async () => {
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();

    expect(config.pollIntervalMs).toBe(300000);
    expect(config.batchSize).toBe(100);
    expect(config.settleBatchSize).toBe(20);
    expect(config.dryRun).toBe(false);
    expect(config.autoSettleEnabled).toBe(false);
    expect(config.defaultWinningOutcome).toBe(0);
    expect(config.maxRetries).toBe(3);
    expect(config.retryBaseDelayMs).toBe(1000);
    expect(config.logLevel).toBe("info");
    expect(config.webhookUrl).toBeNull();
    expect(config.webhookSecret).toBeNull();
  });

  it("parses DRY_RUN=true correctly", async () => {
    process.env["DRY_RUN"] = "true";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.dryRun).toBe(true);
  });

  it("parses AUTO_SETTLE_ENABLED=true correctly", async () => {
    process.env["AUTO_SETTLE_ENABLED"] = "true";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.autoSettleEnabled).toBe(true);
  });

  it("parses webhook URL and secret", async () => {
    process.env["WEBHOOK_URL"] = "https://example.com/hooks";
    process.env["WEBHOOK_SECRET"] = "mysecret";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.webhookUrl).toBe("https://example.com/hooks");
    expect(config.webhookSecret).toBe("mysecret");
  });

  it("selects testnet passphrase for testnet network", async () => {
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.networkPassphrase).toContain("Test");
  });

  it("selects PUBLIC passphrase for mainnet network", async () => {
    process.env["STELLAR_NETWORK"] = "mainnet";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.networkPassphrase).toContain("Public");
  });

  it("clamps batchSize to 100 when over the limit", async () => {
    process.env["BATCH_SIZE"] = "999";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.batchSize).toBe(100);
  });

  it("parses SETTLE_BATCH_SIZE within allowed range", async () => {
    process.env["SETTLE_BATCH_SIZE"] = "10";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.settleBatchSize).toBe(10);
  });

  it("exits when SETTLE_BATCH_SIZE is out of range", async () => {
    process.env["SETTLE_BATCH_SIZE"] = "51";
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    await expect(() => loadConfig()).toThrow("exit 1");
  });
});
