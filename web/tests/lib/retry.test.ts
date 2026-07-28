import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, computeBackoffDelay, ResolvedRetryOptions, CircuitBreaker, CircuitBreakerOpenError } from '../../app/lib/retry';

// Deterministic backoff for tests — remove jitter by mocking Math.random
// and replace setTimeout with an immediate fake so tests don't wait.
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(1); // always returns max delay
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Helper: runs `fn` through `withRetry`, flushes fake timers, and returns the
 * settled outcome so tests can assert on it without triggering unhandled
 * rejection warnings (Vitest fires those before `.rejects` can claim them).
 */
async function runWithRetrySettled<T>(
  fn: () => Promise<T>,
  opts: Parameters<typeof withRetry>[1]
): Promise<{ status: 'fulfilled'; value: T } | { status: 'rejected'; reason: Error }> {
  const promise = withRetry(fn, opts);
  // Attach the rejection handler immediately so the promise is never
  // "unhandled" from Vitest's perspective.
  const settled = promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: Error) => ({ status: 'rejected' as const, reason })
  );
  await vi.runAllTimersAsync();
  return settled;
}

describe('computeBackoffDelay', () => {
  const opts: ResolvedRetryOptions = {
    maxAttempts: 4,
    baseDelayMs: 500,
    backoffFactor: 2,
    maxDelayMs: 8000,
    isTransient: () => true,
  };

  it('returns baseDelayMs * factor^0 for attempt 0', () => {
    // Math.random mocked to 1 → delay = floor(1 * capped) = capped
    expect(computeBackoffDelay(0, opts)).toBe(500);
  });

  it('doubles delay on each subsequent attempt', () => {
    expect(computeBackoffDelay(1, opts)).toBe(1000);
    expect(computeBackoffDelay(2, opts)).toBe(2000);
  });

  it('caps delay at maxDelayMs', () => {
    expect(computeBackoffDelay(10, opts)).toBe(8000);
  });
});

describe('withRetry', () => {
  it('resolves immediately on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await runWithRetrySettled(fn, { maxAttempts: 4, baseDelayMs: 0 });

    expect(result.status).toBe('fulfilled');
    if (result.status === 'fulfilled') expect(result.value).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and resolves when a later attempt succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    const result = await runWithRetrySettled(fn, { maxAttempts: 4, baseDelayMs: 0 });

    expect(result.status).toBe('fulfilled');
    if (result.status === 'fulfilled') expect(result.value).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after all attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent failure'));

    const result = await runWithRetrySettled(fn, { maxAttempts: 3, baseDelayMs: 0 });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.message).toBe('permanent failure');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('unauthorized'));

    const result = await runWithRetrySettled(fn, {
      maxAttempts: 4,
      baseDelayMs: 0,
      isTransient: (e) => (e as Error).message !== 'unauthorized',
    });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.message).toBe('unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with attempt number, error, and delay on each failure', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('done');

    const result = await runWithRetrySettled(fn, { maxAttempts: 4, baseDelayMs: 0, onRetry });

    expect(result.status).toBe('fulfilled');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), expect.any(Number));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), expect.any(Number));
  });

  it('respects maxAttempts of 1 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const result = await runWithRetrySettled(fn, { maxAttempts: 1, baseDelayMs: 0 });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.message).toBe('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails fast when circuit breaker is OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });
    cb.onFailure();
    cb.onFailure();

    expect(cb.getState()).toBe('OPEN');

    const fn = vi.fn().mockResolvedValue('ok');
    const result = await runWithRetrySettled(fn, { circuitBreaker: cb });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBeInstanceOf(CircuitBreakerOpenError);
    }
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after reaching failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.onFailure();
    expect(cb.getState()).toBe('CLOSED');
    cb.onFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to HALF_OPEN after reset timeout', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe('OPEN');

    vi.advanceTimersByTime(1001);
    expect(cb.getState()).toBe('HALF_OPEN');
    expect(cb.canExecute()).toBe(true);
  });

  it('resets to CLOSED on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.getState()).toBe('OPEN');

    cb.onSuccess();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
  });
});
