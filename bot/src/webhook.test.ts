/**
 * Unit tests for the webhook notifier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BotConfig } from "./config.js";
import type { SettlementAttempt, SettlementCycleContext } from "./types.js";

const mockConfig = (overrides: Partial<BotConfig> = {}): BotConfig => ({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  network: "testnet",
  allowHttp: false,
  contractId: "C" + "A".repeat(55),
  botSecretKey: "S" + "A".repeat(55),
  botPublicKey: "G" + "A".repeat(55),
  pollIntervalMs: 300000,
  batchSize: 100,
  settleBatchSize: 20,
  dryRun: false,
  autoSettleEnabled: true,
  defaultWinningOutcome: 0,
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  webhookUrl: "https://example.com/hook",
  webhookSecret: "supersecret",
  webhookTimeoutMs: 10_000,
  logLevel: "info",
  ...overrides,
});

const mockCycleContext: SettlementCycleContext = {
  cycleNumber: 42,
  instanceId: "GAAAAAAAAA",
  settlementTimestamp: "2026-07-24T12:00:00.000Z",
};

const mockSettlements: SettlementAttempt[] = [
  {
    poolId: 1,
    winningOutcome: 0,
    dryRun: false,
    txHash: "abc123",
    success: true,
    attemptCount: 1,
    durationMs: 500,
  },
  {
    poolId: 2,
    winningOutcome: 1,
    dryRun: false,
    success: false,
    error: "PoolNotExpired",
    attemptCount: 3,
    durationMs: 2000,
  },
];

describe("notify", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call fetch when webhookUrl is null", async () => {
    const { notify } = await import("./webhook.js");
    const config = mockConfig({ webhookUrl: null });
    await notify(config, mockSettlements, mockCycleContext);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("POSTs JSON to the configured webhook URL", async () => {
    const { notify } = await import("./webhook.js");
    const config = mockConfig();
    await notify(config, mockSettlements, mockCycleContext);

    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("includes HMAC signature when webhookSecret is set", async () => {
    const { notify } = await import("./webhook.js");
    const config = mockConfig();
    await notify(config, mockSettlements, mockCycleContext);

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-Predinex-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("does not include signature when webhookSecret is null", async () => {
    const { notify } = await import("./webhook.js");
    const config = mockConfig({ webhookSecret: null });
    await notify(config, mockSettlements, mockCycleContext);

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-Predinex-Signature"]).toBeUndefined();
  });

  it("includes correct settlement summary in payload", async () => {
    const { notify } = await import("./webhook.js");
    const config = mockConfig();
    await notify(config, mockSettlements, mockCycleContext);

    const [, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);

    expect(body.event).toBe("settlement_cycle");
    expect(body.cycleNumber).toBe(42);
    expect(body.instanceId).toBe("GAAAAAAAAA");
    expect(body.settlementTimestamp).toBe("2026-07-24T12:00:00.000Z");
    expect(body.summary.attempted).toBe(2);
    expect(body.summary.succeeded).toBe(1);
    expect(body.summary.failed).toBe(1);
    expect(body.settlements).toHaveLength(2);
  });

  it("retries failed deliveries with backoff, then does not throw once the budget is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
      vi.stubGlobal("fetch", fetchMock);
      const { notify } = await import("./webhook.js");
      const config = mockConfig();

      const notifyPromise = notify(config, mockSettlements, mockCycleContext);
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(notifyPromise).resolves.toBeUndefined();

      // 1 initial attempt + up to 3 retries = 4 total calls.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds after a transient failure without exhausting the full retry budget", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce({ ok: true, status: 200 });
      vi.stubGlobal("fetch", fetchMock);
      const { notify } = await import("./webhook.js");
      const config = mockConfig();

      const notifyPromise = notify(config, mockSettlements, mockCycleContext);
      await vi.advanceTimersByTimeAsync(60_000);
      await notifyPromise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured webhookTimeoutMs for the request's abort signal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { notify } = await import("./webhook.js");
    const config = mockConfig({ webhookTimeoutMs: 5_000 });

    await notify(config, mockSettlements, mockCycleContext);

    expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    timeoutSpy.mockRestore();
  });
});
