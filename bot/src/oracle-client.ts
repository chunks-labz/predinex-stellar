import type { BotConfig } from "./config.js";
import { logger } from "./logger.js";
import { withUpstreamTimeout } from "./upstream.js";

export class OracleRateLimitError extends Error {
  constructor(public readonly provider: string) {
    super(`Oracle rate limit exceeded for ${provider}`);
    this.name = "OracleRateLimitError";
  }
}

export interface OracleRequestOptions {
  signal?: AbortSignal;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type OracleClientConfig = Pick<
  BotConfig,
  | "oracleRequestsPerSecond"
  | "oracleRateLimitBurst"
  | "oracleMaxConcurrency"
  | "oracleRateLimitMode"
  | "oracleRetryMaxAttempts"
  | "oracleRetryBaseDelayMs"
  | "oracleRetryMaxDelayMs"
  | "oracleRequestTimeoutMs"
>;

interface ProviderBucket {
  tokens: number;
  lastRefill: number;
  activeRequests: number;
}

const providerBuckets = new Map<string, ProviderBucket>();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function bucketFor(provider: string, burst: number, now: number): ProviderBucket {
  let bucket = providerBuckets.get(provider);
  if (!bucket) {
    bucket = { tokens: burst, lastRefill: now, activeRequests: 0 };
    providerBuckets.set(provider, bucket);
  }
  return bucket;
}

async function acquireProviderSlot(
  provider: string,
  config: OracleClientConfig,
  options: OracleRequestOptions,
): Promise<() => void> {
  const now = options.now ?? Date.now;
  const pause = options.sleep ?? sleep;
  const bucket = bucketFor(provider, config.oracleRateLimitBurst, now());
  let loggedWait = false;

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const current = now();
    const elapsedMs = Math.max(0, current - bucket.lastRefill);
    bucket.tokens = Math.min(
      config.oracleRateLimitBurst,
      bucket.tokens + (elapsedMs * config.oracleRequestsPerSecond) / 1000,
    );
    bucket.lastRefill = current;

    const hasConcurrencySlot = bucket.activeRequests < config.oracleMaxConcurrency;
    if (hasConcurrencySlot && bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.activeRequests += 1;
      return () => {
        bucket.activeRequests -= 1;
      };
    }

    if (config.oracleRateLimitMode === "reject") {
      logger.warn("Oracle provider rate limit rejected request", {
        provider,
        activeRequests: bucket.activeRequests,
        maxConcurrency: config.oracleMaxConcurrency,
      });
      throw new OracleRateLimitError(provider);
    }

    const tokenWaitMs =
      bucket.tokens < 1
        ? Math.ceil(((1 - bucket.tokens) / config.oracleRequestsPerSecond) * 1000)
        : 0;
    const waitMs = hasConcurrencySlot ? Math.max(1, tokenWaitMs) : Math.max(1, tokenWaitMs, 25);
    if (!loggedWait) {
      logger.info("Waiting for oracle provider rate/concurrency budget", {
        provider,
        waitMs,
      });
      loggedWait = true;
    }
    await pause(waitMs, options.signal);
  }
}

function retryAfterMs(response: Response, now: number): number | null {
  const value = response.headers?.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function backoffMs(
  attempt: number,
  response: Response | undefined,
  config: OracleClientConfig,
  options: OracleRequestOptions,
): number {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const exponential = Math.min(
    config.oracleRetryMaxDelayMs,
    config.oracleRetryBaseDelayMs * 2 ** (attempt - 1),
  );
  const jittered = Math.floor(exponential * (0.5 + random()));
  const retryAfter = response ? retryAfterMs(response, now()) : null;
  return Math.min(
    config.oracleRetryMaxDelayMs,
    Math.max(jittered, retryAfter ?? 0),
  );
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function combineAbortSignals(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timeout = false;
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal?.aborted) onParentAbort();
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort(new DOMException("Oracle request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export async function fetchOracleWithRetry(
  url: string,
  init: RequestInit,
  config: OracleClientConfig,
  options: OracleRequestOptions = {},
): Promise<Response> {
  const provider = new URL(url).origin;

  for (let attempt = 1; attempt <= config.oracleRetryMaxAttempts; attempt += 1) {
    const release = await acquireProviderSlot(provider, config, options);
    const abort = combineAbortSignals(options.signal, config.oracleRequestTimeoutMs);
    let response: Response | undefined;
    let requestError: unknown;

    try {
      response = await withUpstreamTimeout(
        fetch(url, { ...init, signal: abort.signal }),
        provider,
        config.oracleRequestTimeoutMs,
      );
    } catch (error) {
      requestError = error;
    } finally {
      abort.dispose();
      release();
    }

    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const transientStatus = response !== undefined && isTransientStatus(response.status);
    const timedOut = abort.timedOut();
    const retryableError = requestError !== undefined && (timedOut || !options.signal?.aborted);
    if (!transientStatus && !retryableError) {
      if (requestError !== undefined) throw requestError;
      if (!response) throw new Error("Oracle request completed without a response");
      return response;
    }

    if (attempt >= config.oracleRetryMaxAttempts) {
      if (response) return response;
      if (timedOut) {
        throw new Error(`Oracle request timed out after ${config.oracleRequestTimeoutMs}ms`);
      }
      throw requestError;
    }

    const delayMs = backoffMs(attempt, response, config, options);
    logger.warn("Retrying transient oracle request failure", {
      provider,
      attempt,
      maxAttempts: config.oracleRetryMaxAttempts,
      status: response?.status,
      timedOut,
      error: requestError === undefined ? undefined : String(requestError),
      delayMs,
    });
    await (options.sleep ?? sleep)(delayMs, options.signal);
  }

  throw new Error("Oracle retry loop ended unexpectedly");
}

export function resetOracleClientStateForTests(): void {
  providerBuckets.clear();
}
