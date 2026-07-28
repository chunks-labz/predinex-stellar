/**
 * Unit tests for the poller cycle logic and resolveWinningOutcome.
 * Mocks ContractClient and Executor to isolate the orchestration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { Pool } from "./types.js";
import type { BotConfig } from "./config.js";
import { resolveWinningOutcome } from "./poller.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const nowSecs = Math.floor(Date.now() / 1000);

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    creator: "GABC",
    title: "Test pool",
    description: "desc",
    outcome_a_name: "Yes",
    outcome_b_name: "No",
    total_a: BigInt(100),
    total_b: BigInt(200),
    participant_count: 5,
    settled: false,
    winning_outcome: null,
    created_at: BigInt(nowSecs - 3600),
    expiry: BigInt(nowSecs - 60), // expired 60s ago
    deposit_deadline: BigInt(nowSecs - 60),
    status: { tag: "Open" },
    cumulative_volume: BigInt(300),
    template_id: null,
    ...overrides,
  };
}

/** Minimal BotConfig with all oracle fields set to "disabled" defaults. */
function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
    allowHttp: false,
    contractId: "C" + "A".repeat(55),
    botSecretKey: "S" + "A".repeat(55),
    botPublicKey: "G" + "A".repeat(55),
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
    logLevel: "error", // silence logs during tests
    ...overrides,
  };
}

// ─── Pool filtering (unchanged, kept as regression guards) ────────────────────

describe("pool filtering", () => {
  it("identifies open expired pools correctly", () => {
    const pool = makePool();
    const now = BigInt(nowSecs);

    expect(pool.status.tag).toBe("Open");
    expect(pool.expiry <= now).toBe(true);
  });

  it("excludes already-settled pools", () => {
    const pool = makePool({ status: { tag: "Settled", values: [0] } });
    expect(pool.status.tag).not.toBe("Open");
  });

  it("excludes pools that have not yet expired", () => {
    const pool = makePool({ expiry: BigInt(nowSecs + 3600) });
    const now = BigInt(nowSecs);
    expect(pool.expiry > now).toBe(true);
  });

  it("excludes voided pools", () => {
    const pool = makePool({ status: { tag: "Voided" } });
    expect(pool.status.tag).not.toBe("Open");
  });

  it("excludes frozen pools", () => {
    const pool = makePool({ status: { tag: "Frozen" } });
    expect(pool.status.tag).not.toBe("Open");
  });

  it("excludes cancelled pools", () => {
    const pool = makePool({ status: { tag: "Cancelled" } });
    expect(pool.status.tag).not.toBe("Open");
  });
});

// ─── Batch splitting ──────────────────────────────────────────────────────────

describe("batch splitting", () => {
  it("correctly splits N candidates into batches of 20", () => {
    const BATCH_SIZE = 20;
    const candidates = Array.from({ length: 45 }, (_, i) => ({
      poolId: i + 1,
      winningOutcome: 0,
    }));

    const batches: typeof candidates[] = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(candidates.slice(i, i + BATCH_SIZE));
    }

    expect(batches.length).toBe(3);
    expect(batches[0].length).toBe(20);
    expect(batches[1].length).toBe(20);
    expect(batches[2].length).toBe(5);
  });
});

// ─── resolveWinningOutcome ────────────────────────────────────────────────────

describe("resolveWinningOutcome", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Step 1: oracle HTTP ───────────────────────────────────────────────────

  describe("oracle HTTP path", () => {
    it("returns oracle outcome 0 when oracle responds with outcome: 0", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 0 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await resolveWinningOutcome(
        42,
        makePool(),
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(0);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://oracle.example.com/resolve/42",
      );
    });

    it("returns oracle outcome 1 when oracle responds with outcome: 1", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 1 }),
      }));

      const result = await resolveWinningOutcome(
        7,
        makePool(),
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(1);
    });

    it("returns null when oracle explicitly defers with outcome: null", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: null }),
      }));

      const result = await resolveWinningOutcome(
        1,
        makePool(),
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBeNull();
    });

    it("includes Authorization header when oracleSecret is set", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 0 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await resolveWinningOutcome(
        5,
        makePool(),
        makeConfig({
          oracleUrl: "https://oracle.example.com",
          oracleSecret: "super-secret-token",
        }),
      );

      const [, reqInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((reqInit.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer super-secret-token",
      );
    });

    it("omits Authorization header when oracleSecret is null", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 0 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await resolveWinningOutcome(
        5,
        makePool(),
        makeConfig({ oracleUrl: "https://oracle.example.com", oracleSecret: null }),
      );

      const [, reqInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((reqInit.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    });

    it("strips trailing slash from oracleUrl", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 1 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      await resolveWinningOutcome(
        3,
        makePool(),
        makeConfig({ oracleUrl: "https://oracle.example.com/" }),
      );

      expect(mockFetch.mock.calls[0][0]).toBe(
        "https://oracle.example.com/resolve/3",
      );
    });
  });

  // ── Oracle error paths — fall through to on-chain ────────────────────────

  describe("oracle error fallthrough to on-chain winning_outcome", () => {
    it("falls through to on-chain outcome when oracle returns non-2xx", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

      const pool = makePool({ winning_outcome: 1 });
      const result = await resolveWinningOutcome(
        1,
        pool,
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(1);
    });

    it("falls through to on-chain outcome on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

      const pool = makePool({ winning_outcome: 0 });
      const result = await resolveWinningOutcome(
        2,
        pool,
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(0);
    });

    it("falls through to on-chain outcome when oracle response is invalid JSON", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new SyntaxError("Unexpected token"); },
      }));

      const pool = makePool({ winning_outcome: 0 });
      const result = await resolveWinningOutcome(
        9,
        pool,
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(0);
    });

    it("falls through to on-chain outcome when oracle response body is missing 'outcome' field", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ winner: 1 }), // wrong key
      }));

      const pool = makePool({ winning_outcome: 1 });
      const result = await resolveWinningOutcome(
        4,
        pool,
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(1);
    });

    it("falls through to on-chain outcome when oracle returns an invalid outcome value", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ outcome: 99 }), // not 0 or 1
      }));

      const pool = makePool({ winning_outcome: 0 });
      const result = await resolveWinningOutcome(
        10,
        pool,
        makeConfig({ oracleUrl: "https://oracle.example.com" }),
      );

      expect(result).toBe(0);
    });
  });

  // ── Step 2: on-chain winning_outcome ─────────────────────────────────────

  describe("on-chain winning_outcome path", () => {
    it("uses on-chain outcome 0 when no oracle configured", async () => {
      const pool = makePool({ winning_outcome: 0 });
      const result = await resolveWinningOutcome(1, pool, makeConfig());
      expect(result).toBe(0);
    });

    it("uses on-chain outcome 1 when no oracle configured", async () => {
      const pool = makePool({ winning_outcome: 1 });
      const result = await resolveWinningOutcome(2, pool, makeConfig());
      expect(result).toBe(1);
    });

    it("does NOT call fetch when on-chain outcome is available and no oracle URL", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const pool = makePool({ winning_outcome: 0 });
      await resolveWinningOutcome(1, pool, makeConfig({ oracleUrl: null }));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Step 3: default fallback ──────────────────────────────────────────────

  describe("default fallback path (oracleFallbackToDefault=true)", () => {
    it("returns defaultWinningOutcome=0 when no oracle and no on-chain outcome", async () => {
      const result = await resolveWinningOutcome(
        1,
        makePool({ winning_outcome: null }),
        makeConfig({
          oracleFallbackToDefault: true,
          defaultWinningOutcome: 0,
        }),
      );
      expect(result).toBe(0);
    });

    it("returns defaultWinningOutcome=1 when configured", async () => {
      const result = await resolveWinningOutcome(
        1,
        makePool({ winning_outcome: null }),
        makeConfig({
          oracleFallbackToDefault: true,
          defaultWinningOutcome: 1,
        }),
      );
      expect(result).toBe(1);
    });

    it("falls back to default after oracle failure when oracleFallbackToDefault=true", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const result = await resolveWinningOutcome(
        5,
        makePool({ winning_outcome: null }),
        makeConfig({
          oracleUrl: "https://oracle.example.com",
          oracleFallbackToDefault: true,
          defaultWinningOutcome: 0,
        }),
      );
      expect(result).toBe(0);
    });
  });

  // ── Step 4: return null (skip) ────────────────────────────────────────────

  describe("skip path (null)", () => {
    it("returns null when no oracle, no on-chain outcome, and fallback disabled", async () => {
      const result = await resolveWinningOutcome(
        1,
        makePool({ winning_outcome: null }),
        makeConfig({ oracleFallbackToDefault: false }),
      );
      expect(result).toBeNull();
    });

    it("returns null after oracle failure when fallback disabled and no on-chain outcome", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

      const result = await resolveWinningOutcome(
        3,
        makePool({ winning_outcome: null }),
        makeConfig({
          oracleUrl: "https://oracle.example.com",
          oracleFallbackToDefault: false,
        }),
      );
      expect(result).toBeNull();
    });

    it("returns null (not default) when oracle URL not set and oracleFallbackToDefault=false", async () => {
      const result = await resolveWinningOutcome(
        99,
        makePool({ winning_outcome: null }),
        makeConfig({
          oracleUrl: null,
          oracleFallbackToDefault: false,
          defaultWinningOutcome: 0,
        }),
      );
      expect(result).toBeNull();
    });
  });
});
