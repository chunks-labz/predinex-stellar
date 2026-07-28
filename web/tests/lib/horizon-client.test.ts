import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchHorizon,
  parseRetryAfterHeader,
  HorizonRateLimiter,
} from '../../app/lib/horizon-client';

describe('parseRetryAfterHeader', () => {
  it('returns null when header is missing or empty', () => {
    expect(parseRetryAfterHeader(null)).toBeNull();
    expect(parseRetryAfterHeader('')).toBeNull();
  });

  it('parses numeric seconds into milliseconds', () => {
    expect(parseRetryAfterHeader('5')).toBe(5000);
    expect(parseRetryAfterHeader('120')).toBe(120000);
  });
});

describe('HorizonRateLimiter', () => {
  it('acquires and releases permits cleanly', async () => {
    const limiter = new HorizonRateLimiter(2, 10);
    await limiter.acquire();
    expect(() => limiter.release()).not.toThrow();
  });
});

describe('fetchHorizon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fetches successfully on HTTP 200 response', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

    const promise = fetchHorizon('https://horizon.stellar.org/accounts/test', {}, { maxAttempts: 1 });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
  });
});
