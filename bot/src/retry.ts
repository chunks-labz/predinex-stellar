/**
 * Retry utility with exponential back-off and jitter.
 *
 * The delay between attempts follows the formula:
 *   delay = baseDelayMs * 2^(attempt - 1) + jitter
 * where jitter is a random value in [0, baseDelayMs].
 *
 * This avoids thundering-herd problems when multiple bot instances race.
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  /** Human-readable label for log messages */
  label?: string;
  /** Optional predicate — return false to skip retrying a specific error */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

function jitteredDelay(baseMs: number, attempt: number): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * baseMs;
  return Math.min(exponential + jitter, 30_000); // cap at 30 s
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry `fn` up to `maxRetries` additional times on failure.
 * Returns the result of the first successful attempt.
 * Throws the last error if all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, label = "operation" } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const shouldRetry = options.shouldRetry
        ? options.shouldRetry(err, attempt)
        : true;

      if (!shouldRetry || attempt > maxRetries) {
        logger.error(`${label} failed permanently`, {
          attempt,
          maxRetries,
          error: String(err),
        });
        throw err;
      }

      const delay = jitteredDelay(baseDelayMs, attempt);
      logger.warn(`${label} failed, retrying`, {
        attempt,
        maxRetries,
        retryAfterMs: Math.round(delay),
        error: String(err),
      });

      await sleep(delay);
    }
  }

  throw lastError;
}
