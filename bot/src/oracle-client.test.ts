import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOracleWithRetry,
  OracleRateLimitError,
  resetOracleClientStateForTests,
  type OracleClientConfig,
} from "./oracle-client.js";

const config: OracleClientConfig = {
  oracleRequestsPerSecond: 10,
  oracleRateLimitBurst: 10,
  oracleMaxConcurrency: 1,
  oracleRateLimitMode: "reject",
  oracleRetryMaxAttempts: 3,
  oracleRetryBaseDelayMs: 100,
  oracleRetryMaxDelayMs: 1000,
  oracleRequestTimeoutMs: 1000,
};

afterEach(() => {
  resetOracleClientStateForTests();
  vi.restoreAllMocks();
});

describe("fetchOracleWithRetry", () => {
  it("returns successful provider responses without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const response = await fetchOracleWithRetry(
      "https://oracle.example.com/resolve/1",
      {},
      config,
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx response with exponential backoff and then succeeds", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("recovered", { status: 200 }));
    const delays: number[] = [];
    vi.stubGlobal("fetch", fetcher);

    const response = await fetchOracleWithRetry(
      "https://oracle.example.com/resolve/2",
      {},
      config,
      {
        random: () => 0.5,
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([100]);
  });

  it("retries a timed-out request when the provider recovers", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "AbortError"));
            });
          }),
      )
      .mockResolvedValueOnce(new Response("recovered", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const response = await fetchOracleWithRetry(
      "https://oracle.example.com/resolve/2-timeout",
      {},
      { ...config, oracleRequestTimeoutMs: 1 },
      { random: () => 0.5, sleep: async () => {} },
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns the last transient response after exhausting attempts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetcher);

    const response = await fetchOracleWithRetry(
      "https://oracle.example.com/resolve/3",
      {},
      config,
      { random: () => 0.5, sleep: async () => {} },
    );

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(config.oracleRetryMaxAttempts);
  });

  it("waits until the per-provider token budget is refilled", async () => {
    let clock = 0;
    const waits: number[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const waitConfig: OracleClientConfig = {
      ...config,
      oracleRequestsPerSecond: 2,
      oracleRateLimitBurst: 1,
      oracleRateLimitMode: "wait",
    };

    await fetchOracleWithRetry("https://oracle.example.com/one", {}, waitConfig, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await fetchOracleWithRetry("https://oracle.example.com/two", {}, waitConfig, {
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });

    expect(waits).toEqual([500]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects calls that exceed a provider's configured budget in fail-fast mode", async () => {
    let finishFirstRequest: ((response: Response) => void) | undefined;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishFirstRequest = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);

    const limitedConfig: OracleClientConfig = {
      ...config,
      oracleRateLimitBurst: 1,
      oracleRateLimitMode: "reject",
    };
    const first = fetchOracleWithRetry(
      "https://oracle.example.com/resolve/4",
      {},
      limitedConfig,
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    await expect(
      fetchOracleWithRetry("https://oracle.example.com/resolve/5", {}, limitedConfig),
    ).rejects.toBeInstanceOf(OracleRateLimitError);

    finishFirstRequest?.(new Response("ok", { status: 200 }));
    await first;
  });
});
