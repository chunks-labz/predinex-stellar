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
    delete process.env["HEALTH_CHECK_ENABLED"];
    delete process.env["HEALTH_CHECK_PORT"];
    delete process.env["ALLOW_HTTP"];
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
    expect(config.healthCheckEnabled).toBe(true);
    expect(config.healthCheckPort).toBe(3000);
    expect(config.allowHttp).toBe(false);
  });

  it("defaults allowHttp to true when STELLAR_RPC_URL is http://", async () => {
    process.env["STELLAR_RPC_URL"] = "http://localhost:8000/soroban/rpc";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.allowHttp).toBe(true);
  });

  it("defaults allowHttp to false when STELLAR_RPC_URL is https://", async () => {
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.allowHttp).toBe(false);
  });

  it("respects an explicit ALLOW_HTTP=true override even for an https:// URL", async () => {
    process.env["ALLOW_HTTP"] = "true";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.allowHttp).toBe(true);
  });

  it("respects an explicit ALLOW_HTTP=false override even for an http:// URL", async () => {
    process.env["STELLAR_RPC_URL"] = "http://localhost:8000/soroban/rpc";
    process.env["ALLOW_HTTP"] = "false";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.allowHttp).toBe(false);
  });

  it("parses HEALTH_CHECK_ENABLED=false correctly", async () => {
    process.env["HEALTH_CHECK_ENABLED"] = "false";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.healthCheckEnabled).toBe(false);
  });

  it("parses a custom HEALTH_CHECK_PORT correctly", async () => {
    process.env["HEALTH_CHECK_PORT"] = "8080";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.healthCheckPort).toBe(8080);
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
    process.env["WEBHOOK_SECRET"] = "my-super-secret-key";
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.webhookUrl).toBe("https://example.com/hooks");
    expect(config.webhookSecret).toBe("my-super-secret-key");
  });

  it("exits when WEBHOOK_URL is invalid", async () => {
    process.env["WEBHOOK_URL"] = "not-a-url";
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    await expect(() => loadConfig()).toThrow("exit 1");
  });

  it("exits when WEBHOOK_SECRET is too short", async () => {
    process.env["WEBHOOK_SECRET"] = "short";
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    await expect(() => loadConfig()).toThrow("exit 1");
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

  // ── Oracle config fields ──────────────────────────────────────────────────

  it("defaults oracle fields to null/false when env vars are absent", async () => {
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();

    expect(config.oracleUrl).toBeNull();
    expect(config.oracleSecret).toBeNull();
    expect(config.oracleFallbackToDefault).toBe(false);
  });

  it("reads ORACLE_URL correctly", async () => {
    process.env["ORACLE_URL"] = "https://oracle.example.com";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleUrl).toBe("https://oracle.example.com");
  });

  it("treats blank ORACLE_URL as null", async () => {
    process.env["ORACLE_URL"] = "   ";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleUrl).toBeNull();
  });

  it("reads ORACLE_SECRET correctly", async () => {
    process.env["ORACLE_SECRET"] = "my-bearer-token";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleSecret).toBe("my-bearer-token");
  });

  it("treats blank ORACLE_SECRET as null", async () => {
    process.env["ORACLE_SECRET"] = "";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleSecret).toBeNull();
  });

  it("parses ORACLE_FALLBACK_TO_DEFAULT=true correctly", async () => {
    process.env["ORACLE_FALLBACK_TO_DEFAULT"] = "true";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleFallbackToDefault).toBe(true);
  });

  it("parses ORACLE_FALLBACK_TO_DEFAULT=false correctly", async () => {
    process.env["ORACLE_FALLBACK_TO_DEFAULT"] = "false";
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleFallbackToDefault).toBe(false);
  });

  it("defaults ORACLE_FALLBACK_TO_DEFAULT to false when set to unexpected value", async () => {
    process.env["ORACLE_FALLBACK_TO_DEFAULT"] = "yes"; // not "true"
    vi.resetModules();
    const { loadConfig } = await import("./config.js");
    const config = loadConfig();
    expect(config.oracleFallbackToDefault).toBe(false);
  });
});
