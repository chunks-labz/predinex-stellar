/**
 * Unit tests for the health check HTTP server.
 * Uses a minimal fake in place of Poller so we don't need a live Stellar RPC.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HealthServer } from "./health.js";
import type { Poller } from "./poller.js";
import type { PollerMetrics } from "./types.js";

type ReadinessResult =
  | { healthy: true; latestLedger: number }
  | { healthy: false; error: string };

function makeFakePoller(overrides: {
  readiness?: ReadinessResult;
  metrics?: Partial<PollerMetrics>;
} = {}): Poller {
  const readiness: ReadinessResult = overrides.readiness ?? {
    healthy: true,
    latestLedger: 12345,
  };
  const metrics: PollerMetrics = {
    running: true,
    cycleCount: 3,
    lastSettlementAt: null,
    pendingPoolsCount: 0,
    errorCount: 0,
    trackedFailurePools: 0,
    ...overrides.metrics,
  };

  return {
    checkReadiness: async () => readiness,
    getMetrics: () => metrics,
  } as unknown as Poller;
}

describe("HealthServer", () => {
  let server: HealthServer;
  let baseUrl: string;

  afterEach(async () => {
    await server?.stop();
  });

  it("responds 200 on /health/live", async () => {
    server = new HealthServer(makeFakePoller(), 0);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.boundPort}`;

    const res = await fetch(`${baseUrl}/health/live`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("responds 200 on /health/ready when RPC is healthy", async () => {
    server = new HealthServer(
      makeFakePoller({ readiness: { healthy: true, latestLedger: 999 } }),
      0,
    );
    await server.start();
    baseUrl = `http://127.0.0.1:${server.boundPort}`;

    const res = await fetch(`${baseUrl}/health/ready`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rpc.connected).toBe(true);
    expect(body.rpc.latestLedger).toBe(999);
  });

  it("responds 503 on /health/ready when RPC is unreachable", async () => {
    server = new HealthServer(
      makeFakePoller({
        readiness: { healthy: false, error: "connection refused" },
      }),
      0,
    );
    await server.start();
    baseUrl = `http://127.0.0.1:${server.boundPort}`;

    const res = await fetch(`${baseUrl}/health/ready`);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.rpc.connected).toBe(false);
    expect(body.rpc.error).toContain("connection refused");
  });

  it("returns metrics as JSON on /health/metrics", async () => {
    server = new HealthServer(
      makeFakePoller({
        metrics: {
          cycleCount: 42,
          lastSettlementAt: "2026-07-25T00:00:00.000Z",
          pendingPoolsCount: 7,
          errorCount: 2,
        },
      }),
      0,
    );
    await server.start();
    baseUrl = `http://127.0.0.1:${server.boundPort}`;

    const res = await fetch(`${baseUrl}/health/metrics`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cycleCount).toBe(42);
    expect(body.lastSettlementAt).toBe("2026-07-25T00:00:00.000Z");
    expect(body.pendingPoolsCount).toBe(7);
    expect(body.errorCount).toBe(2);
  });

  it("responds 404 for unknown paths", async () => {
    server = new HealthServer(makeFakePoller(), 0);
    await server.start();
    baseUrl = `http://127.0.0.1:${server.boundPort}`;

    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
