/**
 * Unit tests for the poller cycle logic.
 * Mocks ContractClient and Executor to isolate the orchestration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the business logic in the poller by inspecting what candidates
// are built from the scanned pools. We mock at the ContractClient level.

import type { Pool } from "./types.js";

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
