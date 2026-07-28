/**
 * Horizon & Soroban RPC API Client with Rate Limiting & Bounded Exponential Backoff.
 * Prevents HTTP 429 (Too Many Requests) cascades by rate limiting and handling
 * retries with backoff + jitter and respecting Retry-After headers.
 */

import { withRetry, RetryOptions } from './retry';
import { createScopedLogger } from './logger';

const log = createScopedLogger('horizon-client');

/** Simple token-bucket / concurrency rate limiter to prevent request bursts */
export class HorizonRateLimiter {
  private queue: Array<() => void> = [];
  private activeRequests = 0;
  private maxConcurrent: number;
  private minIntervalMs: number;
  private lastRequestTime = 0;

  constructor(maxConcurrent = 5, minIntervalMs = 50) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
  }

  async acquire(): Promise<void> {
    if (this.activeRequests >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
    this.activeRequests++;
  }

  release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }
}

export const globalHorizonRateLimiter = new HorizonRateLimiter(5, 50);

/**
 * Parses Retry-After header value (seconds or HTTP date format) into milliseconds.
 */
export function parseRetryAfterHeader(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = parseFloat(headerValue);
  if (!isNaN(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }
  const dateMs = Date.parse(headerValue);
  if (!isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

/**
 * Fetch wrapper for Horizon API / Soroban RPC calls.
 * Applies rate-limiting, handles 429 response status with exponential backoff
 * and Retry-After header parsing.
 */
export async function fetchHorizon(
  url: string,
  init?: RequestInit,
  retryOpts?: RetryOptions
): Promise<Response> {
  const options: RetryOptions = {
    maxAttempts: 4,
    baseDelayMs: 500,
    backoffFactor: 2,
    maxDelayMs: 8000,
    isTransient: (err: unknown) => {
      if (err instanceof Error) {
        if (err.name === 'HorizonRateLimitError' || err.name === 'HorizonServerError') {
          return true;
        }
      }
      return true;
    },
    ...retryOpts,
  };

  return withRetry(async () => {
    await globalHorizonRateLimiter.acquire();
    try {
      const response = await fetch(url, init);

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfterMs = parseRetryAfterHeader(retryAfterHeader);

        log.warn(`Horizon API 429 Rate Limit hit for ${url}. Retry-After: ${retryAfterHeader ?? 'none'}`);

        if (retryAfterMs !== null && retryAfterMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 10000)));
        }

        const error = new Error(`Horizon API rate limit exceeded (429)`);
        error.name = 'HorizonRateLimitError';
        throw error;
      }

      if (response.status >= 500 && response.status < 600) {
        log.warn(`Horizon API server error ${response.status} for ${url}`);
        const error = new Error(`Horizon API server error (${response.status})`);
        error.name = 'HorizonServerError';
        throw error;
      }

      return response;
    } finally {
      globalHorizonRateLimiter.release();
    }
  }, options);
}
