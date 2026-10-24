/**
 * Generic retry utility with bounded exponential backoff and circuit breaker.
 * Used by market discovery and RPC API calls to survive transient failures
 * and fail fast when upstream RPC services are down.
 */

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is OPEN - RPC/service endpoint unavailable') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Cooldown time in ms before transitioning from OPEN to HALF_OPEN. Default: 30000 (30s) */
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastStateChange: number = Date.now();
  private failureThreshold: number;
  private resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
  }

  getState(): CircuitBreakerState {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastStateChange >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = Date.now();
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      this.lastStateChange = Date.now();
    }
  }

  onFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      if (this.state !== 'OPEN') {
        this.state = 'OPEN';
        this.lastStateChange = Date.now();
      }
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastStateChange = Date.now();
  }
}

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 4 */
  maxAttempts?: number;
  /** Base delay in ms for the first retry. Default: 500 */
  baseDelayMs?: number;
  /** Multiplier applied to the delay after each failure. Default: 2 */
  backoffFactor?: number;
  /** Hard cap on any single delay in ms. Default: 8000 */
  maxDelayMs?: number;
  /**
   * Predicate that decides whether an error is transient (worth retrying).
   * Non-transient errors (e.g. auth, not-found) are thrown immediately.
   * Defaults to treating all errors as transient.
   */
  isTransient?: (error: unknown) => boolean;
  /** Called after each failed attempt — useful for logging / state updates. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** Optional CircuitBreaker instance to fail fast when RPC endpoint is down. */
  circuitBreaker?: CircuitBreaker;
}

/** Resolved retry configuration with all defaults filled in. */
export interface ResolvedRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  isTransient: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  circuitBreaker?: CircuitBreaker;
}

const DEFAULTS: ResolvedRetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 8000,
  isTransient: () => true,
};

/**
 * Calculates the delay (ms) for a given retry attempt using exponential backoff
 * with full jitter to avoid thundering-herd issues.
 *
 * @param attempt    - Zero-based retry index (0 = first retry after first failure)
 * @param opts       - Resolved retry options
 */
export function computeBackoffDelay(attempt: number, opts: ResolvedRetryOptions): number {
  const exponential = opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt);
  const capped = Math.min(exponential, opts.maxDelayMs);
  // Full jitter: random value in [0, capped]
  return Math.floor(Math.random() * capped);
}

/**
 * Executes `fn` with retry, exponential backoff, and optional circuit breaker protection.
 *
 * - Retries up to `maxAttempts - 1` times on transient errors.
 * - Fails fast with `CircuitBreakerOpenError` if the circuit breaker is OPEN.
 * - Non-transient errors (per `isTransient`) are re-thrown immediately.
 * - After all attempts are exhausted the last error is re-thrown.
 *
 * @param fn   - Async operation to execute
 * @param opts - Retry configuration (all fields optional)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const resolved: ResolvedRetryOptions = { ...DEFAULTS, ...opts };

  if (resolved.circuitBreaker && !resolved.circuitBreaker.canExecute()) {
    throw new CircuitBreakerOpenError();
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < resolved.maxAttempts; attempt++) {
    try {
      const result = await fn();
      resolved.circuitBreaker?.onSuccess();
      return result;
    } catch (error) {
      lastError = error;
      resolved.circuitBreaker?.onFailure();

      if (!resolved.isTransient(error)) {
        throw error;
      }

      const isLastAttempt = attempt === resolved.maxAttempts - 1;
      if (isLastAttempt) break;

      if (resolved.circuitBreaker && !resolved.circuitBreaker.canExecute()) {
        throw new CircuitBreakerOpenError();
      }

      const delayMs = computeBackoffDelay(attempt, resolved);
      resolved.onRetry?.(attempt + 1, error, delayMs);

      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
