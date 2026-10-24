/**
 * Unit tests for the retry utility.
 *
 * We use a 0ms base delay so tests complete near-instantly without fake timers.
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "success";
    });

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 0,
    });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting all retries", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("permanent failure");
    });

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 0 }),
    ).rejects.toThrow("permanent failure");

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects shouldRetry predicate — does not retry when false", async () => {
    const fn = vi.fn().mockImplementation(async () => {
      throw new Error("fatal error");
    });

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 0,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("fatal error");

    expect(fn).toHaveBeenCalledTimes(1); // no retries
  });
});
