/**
 * Unit tests for normalizeStatus.
 *
 * The settlement poller decides whether to spend gas on a pool by reading
 * `pool.status.tag === "Open"`. These tests pin down that no malformed or
 * unrecognised status can reach that comparison as "Open".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: {
    debug: mocks.debug,
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  },
  setLogLevel: vi.fn(),
}));

const { normalizeStatus } = await import("./contract-client.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeStatus — recognised statuses", () => {
  it("parses the bare-string form", () => {
    expect(normalizeStatus("Open")).toEqual({ tag: "Open", source: "string" });
    expect(normalizeStatus("Voided")).toEqual({ tag: "Voided", source: "string" });
  });

  it("parses the { tag, values } form", () => {
    expect(normalizeStatus({ tag: "Settled", values: [1] })).toEqual({
      tag: "Settled",
      values: [1],
      source: "tag",
    });
  });

  it("parses the keyed form with values", () => {
    expect(normalizeStatus({ Settled: [0] })).toEqual({
      tag: "Settled",
      values: [0],
      source: "keyed",
    });
  });

  it("parses the keyed form without values", () => {
    expect(normalizeStatus({ Open: [] })).toEqual({ tag: "Open", source: "keyed" });
  });

  it.each(["Open", "Settled", "Voided", "Frozen", "Disputed", "Cancelled", "Scheduled"])(
    "accepts the contract variant %s",
    (tag) => {
      expect(normalizeStatus(tag)).not.toBeNull();
    },
  );

  it("does not warn on a recognised status", () => {
    normalizeStatus("Open");
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});

describe("normalizeStatus — rejected statuses", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a boolean", true],
    ["an empty object", {}],
    ["a non-string tag", { tag: 7 }],
  ])("rejects %s instead of defaulting to Open", (_label, raw) => {
    expect(normalizeStatus(raw)).toBeNull();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("rejects a status string the contract does not define", () => {
    expect(normalizeStatus("Liquidated")).toBeNull();
  });

  it("logs a warning naming the unknown tag", () => {
    normalizeStatus("Liquidated");
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown status tag"),
      expect.objectContaining({ tag: "Liquidated" }),
    );
  });

  it("rejects an unknown tag in the keyed form", () => {
    expect(normalizeStatus({ Liquidated: [] })).toBeNull();
    expect(normalizeStatus({ tag: "Liquidated", values: [3] })).toBeNull();
  });

  it("never returns Open for an unrecognised input", () => {
    const unrecognised = [null, undefined, 0, "", [], {}, "Migrated", { tag: "Migrated" }];
    for (const raw of unrecognised) {
      expect(normalizeStatus(raw)?.tag).not.toBe("Open");
    }
  });
});
