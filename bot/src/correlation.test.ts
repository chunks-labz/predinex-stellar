/**
 * Worker correlation propagation and structured log tests (Issue #1491).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, setLogLevel } from "./logger.js";
import {
  extractWorkerTraceContext,
  getActiveCorrelationId,
  injectWorkerTraceHeaders,
  withWorkerSpan,
} from "./tracing.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID = "00f067aa0ba902b7";

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel("info");
});

function captureStdout(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

function parseLines(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("worker correlation (Issue #1491)", () => {
  it("extracts x-correlation-id from a job carrier", () => {
    const context = extractWorkerTraceContext({
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
      "x-correlation-id": "api-request-corr",
    });

    expect(context).toMatchObject({
      traceId: TRACE_ID,
      spanId: PARENT_SPAN_ID,
      correlationId: "api-request-corr",
    });
  });

  it("falls back to the trace ID when no correlation header is present", () => {
    const context = extractWorkerTraceContext({
      traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
    });

    expect(context?.correlationId).toBe(TRACE_ID);
  });

  it("creates a context from a correlation-only carrier", () => {
    const context = extractWorkerTraceContext({ "x-correlation-id": "api-only-corr" });

    expect(context?.correlationId).toBe("api-only-corr");
    expect(context?.traceId).toHaveLength(32);
  });

  it("inherits and re-injects the API correlation ID across a worker span", async () => {
    const stdout = captureStdout();

  let injectedOutside: string | undefined;
  const observed = await withWorkerSpan(
    "worker.job.settlement_cycle",
    async () => {
      logger.info("settlement_step_complete", { poolId: 7 });
      expect(injectWorkerTraceHeaders()["x-correlation-id"]).toBe("api-request-corr");
      return getActiveCorrelationId();
    },
    {
      parentContext: {
        traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`,
        "x-correlation-id": "api-request-corr",
      },
    },
  );

  expect(observed).toBe("api-request-corr");
  expect(injectWorkerTraceHeaders()["x-correlation-id"]).toBeUndefined();

    const [line] = parseLines(stdout);
    expect(line).toMatchObject({
      level: "info",
      service: "predinex-settlement-bot",
      msg: "settlement_step_complete",
      correlationId: "api-request-corr",
      traceId: TRACE_ID,
      poolId: 7,
    });
    expect(typeof line.spanId).toBe("string");
  });

  it("generates one correlation ID per cycle when no parent is supplied", async () => {
    captureStdout();

    await withWorkerSpan("worker.job.settlement_cycle", async (spanCtx) => {
      expect(getActiveCorrelationId()).toBe(spanCtx.correlationId);
      expect(spanCtx.correlationId).toBe(spanCtx.traceId);
      logger.info("cycle_started");
    });
  });
});
