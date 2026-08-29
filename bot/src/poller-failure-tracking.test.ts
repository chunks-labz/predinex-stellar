/**
 * Unit tests for the poller's persistent-failure tracking map.
 *
 * The map is the one piece of unbounded-by-construction state in a
 * long-running bot process, so these tests pin down its two bounds:
 * a per-pool failure ceiling (entries are evicted at MAX_FAILURE_COUNT) and
 * per-cycle pruning of pools that left the active scan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Pool, SettlementAttempt } from "./types.js";
import type { BotConfig } from "./config.js";

// ─── Module mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  findExpiredUnsettledPools: vi.fn(),
  getPoolCount: vi.fn(),
  settleAll: vi.fn(),
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

vi.mock("./webhook.js", () => ({ notify: vi.fn(async () => {}) }));

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { Poller, MAX_FAILURE_COUNT, FAILURE_ESCALATION_THRESHOLD } from "./poller.js";
import { logger } from "./logger.js";

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
    expiry: BigInt(nowSecs - 60),
    deposit_deadline: BigInt(nowSecs - 60),
    status: { tag: "Open" },
    cumulative_volume: BigInt(300),
    template_id: null,
    ...overrides,
  };
}

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
    // Resolve outcomes locally so no cycle touches the network.
    oracleFallbackToDefault: true,
    txPollIntervalMs: 3_000,
    txPollMaxAttempts: 30,
    maxRetries: 3,
    retryBaseDelayMs: 1_000,
    webhookUrl: null,
    webhookSecret: null,
    webhookTimeoutMs: 10_000,
    logLevel: "error",
    ...overrides,
  };
}

/** Point the mocked client at a fixed set of expired pool IDs. */
function scanReturns(poolIds: number[]): void {
  mocks.findExpiredUnsettledPools.mockResolvedValue(
    poolIds.map((poolId) => ({ poolId, pool: makePool() })),
  );
  mocks.getPoolCount.mockResolvedValue(Math.max(poolIds.length, 1));
}

/** Make the mocked executor fail (or succeed) for every candidate it is given. */
function settlementsResolve(success: boolean, error = "HostError: auth failed"): void {
  mocks.settleAll.mockImplementation(
    async (candidates: Array<{ poolId: number; winningOutcome: number }>) =>
      candidates.map(
        ({ poolId, winningOutcome }): SettlementAttempt => ({
          poolId,
          winningOutcome,
          success,
          txHash: success ? "tx" + poolId : null,
          error: success ? undefined : error,
        }),
      ),
  );
}

function tracked(poller: Poller): number {
  return poller.getMetrics().trackedFailurePools;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("persistent failure tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("escalates once the failure threshold is reached", async () => {
    scanReturns([1]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    for (let i = 0; i < FAILURE_ESCALATION_THRESHOLD; i++) {
      await poller.runCycle();
    }

    const escalations = vi
      .mocked(logger.error)
      .mock.calls.filter(([msg]) =>
        String(msg).includes("failed to settle repeatedly"),
      );
    expect(escalations.length).toBe(1);
    expect(escalations[0][1]).toMatchObject({
      poolId: 1,
      failureCount: FAILURE_ESCALATION_THRESHOLD,
    });
  });

  it("caps the failure count and evicts the entry at MAX_FAILURE_COUNT", async () => {
    scanReturns([1]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    for (let i = 0; i < MAX_FAILURE_COUNT - 1; i++) {
      await poller.runCycle();
    }
    expect(tracked(poller)).toBe(1);

    // The cycle that reaches the ceiling alerts and drops the entry.
    await poller.runCycle();
    expect(tracked(poller)).toBe(0);

    const giveUps = vi
      .mocked(logger.error)
      .mock.calls.filter(([msg]) =>
        String(msg).includes("maximum consecutive failure count"),
      );
    expect(giveUps.length).toBe(1);
    expect(giveUps[0][1]).toMatchObject({
      poolId: 1,
      failureCount: MAX_FAILURE_COUNT,
      maxFailureCount: MAX_FAILURE_COUNT,
    });
  });

  it("never lets a single pool's counter exceed the ceiling", async () => {
    scanReturns([1]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    // Well past the ceiling — the counter restarts after each eviction rather
    // than growing without bound.
    for (let i = 0; i < MAX_FAILURE_COUNT * 3; i++) {
      await poller.runCycle();
    }

    const recorded = vi
      .mocked(logger.error)
      .mock.calls.map(([, meta]) => (meta as { failureCount?: number })?.failureCount ?? 0);
    expect(Math.max(...recorded)).toBe(MAX_FAILURE_COUNT);
    expect(tracked(poller)).toBe(0);
  });

  it("prunes entries for pools that leave the active scan", async () => {
    scanReturns([1, 2]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    await poller.runCycle();
    expect(tracked(poller)).toBe(2);

    // Pool 2 drops out of the scan (settled elsewhere / out of range).
    scanReturns([1]);
    await poller.runCycle();
    expect(tracked(poller)).toBe(1);

    expect(
      vi
        .mocked(logger.debug)
        .mock.calls.some(([msg]) => String(msg).includes("Pruned stale failure-tracking")),
    ).toBe(true);
  });

  it("clears all entries when the scan comes back empty", async () => {
    scanReturns([1, 2, 3]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    await poller.runCycle();
    expect(tracked(poller)).toBe(3);

    scanReturns([]);
    await poller.runCycle();
    expect(tracked(poller)).toBe(0);
  });

  it("keeps the map bounded by the active scan across many cycles", async () => {
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    // Each cycle scans a fresh, disjoint window of 5 pools. Without pruning
    // the map would hold 250 entries by the end.
    for (let cycle = 0; cycle < 50; cycle++) {
      const window = Array.from({ length: 5 }, (_, i) => cycle * 5 + i);
      scanReturns(window);
      await poller.runCycle();
      expect(tracked(poller)).toBeLessThanOrEqual(window.length);
    }

    expect(tracked(poller)).toBe(5);
  });

  it("drops the entry as soon as a pool settles successfully", async () => {
    scanReturns([1]);
    settlementsResolve(false);
    const poller = new Poller(makeConfig());

    await poller.runCycle();
    expect(tracked(poller)).toBe(1);

    settlementsResolve(true);
    await poller.runCycle();
    expect(tracked(poller)).toBe(0);
  });

  it("does not count PoolAlreadySettled as a failure", async () => {
    scanReturns([1]);
    settlementsResolve(false, "PoolAlreadySettled");
    const poller = new Poller(makeConfig());

    await poller.runCycle();

    expect(tracked(poller)).toBe(0);
  });
});
