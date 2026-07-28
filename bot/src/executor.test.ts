/**
 * Unit tests for settlement outcome validation in the executor.
 */
import { describe, it, expect } from "vitest";
import { validateSettlementOutcomesForTest } from "./executor.js";

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
});
