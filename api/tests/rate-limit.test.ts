import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  createRateLimitMiddleware,
  DEFAULT_RATE_LIMIT_CONFIG,
  loadRateLimitConfig,
  RateLimiter,
  setDefaultTokenVerifier,
} from '../src/middleware/rate-limit.js';

function request(ip: string, apiKey: string, forwardedFor: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: { 'x-api-key': apiKey, 'x-forwarded-for': forwardedFor },
  } as unknown as Request;
}

function response() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & typeof res;
}

describe('rate limit identity', () => {
  it('keeps changing API keys and forwarded headers in the same socket IP bucket', () => {
    const middleware = createRateLimitMiddleware(new RateLimiter({ windowMs: 60_000, maxRequests: 1 }));
    const next = vi.fn() as unknown as NextFunction;

    const firstResponse = response();
    middleware(request('192.0.2.10', 'unregistered-one', '198.51.100.1'), firstResponse, next);
    expect(next).toHaveBeenCalledTimes(1);

    const secondResponse = response();
    const secondNext = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.10', 'unregistered-two', '203.0.113.9'), secondResponse, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondResponse.status).toHaveBeenCalledWith(429);
  });
});

describe('rate limit allow/throttle behaviour (#1423)', () => {
  it('allows requests up to the limit, then throttles with 429 and Retry-After', () => {
    const middleware = createRateLimitMiddleware(new RateLimiter({ windowMs: 30_000, maxRequests: 2 }));

    for (let i = 0; i < 2; i += 1) {
      const res = response();
      const next = vi.fn() as unknown as NextFunction;
      middleware(request('192.0.2.20', '', ''), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalledWith('Retry-After', expect.anything());
    }

    const throttled = response();
    const throttledNext = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.20', '', ''), throttled, throttledNext);

    expect(throttledNext).not.toHaveBeenCalled();
    expect(throttled.status).toHaveBeenCalledWith(429);
    expect(throttled.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(throttled.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '0');
    const body = throttled.json.mock.calls[0][0];
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryAfter).toBe(30);
  });

  it('keeps separate buckets for different client IPs', () => {
    const middleware = createRateLimitMiddleware(new RateLimiter({ windowMs: 60_000, maxRequests: 1 }));

    const first = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.30', '', ''), response(), first);
    const second = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.31', '', ''), response(), second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('allows again after the window resets', () => {
    const limiter = new RateLimiter({ windowMs: 1_000, maxRequests: 1 });
    expect(limiter.checkLimit('ip:a', 0).allowed).toBe(true);
    expect(limiter.checkLimit('ip:a', 500).allowed).toBe(false);
    expect(limiter.checkLimit('ip:a', 1_000).allowed).toBe(true);
  });

  it('gives registered API keys their own bucket, independent of IP', () => {
    const middleware = createRateLimitMiddleware(
      new RateLimiter({ windowMs: 60_000, maxRequests: 1 }),
      { isKnownToken: (key) => key === 'registered-key' }
    );

    const ipNext = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.40', 'unregistered', ''), response(), ipNext);
    expect(ipNext).toHaveBeenCalledTimes(1);

    // Same IP, but a verified key: separate bucket, so still allowed.
    const tokenNext = vi.fn() as unknown as NextFunction;
    middleware(request('192.0.2.40', 'registered-key', ''), response(), tokenNext);
    expect(tokenNext).toHaveBeenCalledTimes(1);

    // The token bucket follows the key across IPs.
    const tokenRes = response();
    const tokenNext2 = vi.fn() as unknown as NextFunction;
    middleware(request('198.51.100.7', 'registered-key', ''), tokenRes, tokenNext2);
    expect(tokenNext2).not.toHaveBeenCalled();
    expect(tokenRes.status).toHaveBeenCalledWith(429);
  });

  it('uses the default token verifier when none is passed explicitly', () => {
    setDefaultTokenVerifier((key) => key === 'default-known');
    try {
      const middleware = createRateLimitMiddleware(new RateLimiter({ windowMs: 60_000, maxRequests: 1 }));
      const a = vi.fn() as unknown as NextFunction;
      middleware(request('192.0.2.50', '', ''), response(), a);
      const b = vi.fn() as unknown as NextFunction;
      middleware(request('192.0.2.50', 'default-known', ''), response(), b);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    } finally {
      setDefaultTokenVerifier(undefined);
    }
  });
});

describe('rate limit configuration (#1423)', () => {
  it('uses defaults when env vars are unset', () => {
    expect(loadRateLimitConfig({})).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
  });

  it('reads limits from env vars', () => {
    expect(
      loadRateLimitConfig({
        RATE_LIMIT_WINDOW_MS: '15000',
        RATE_LIMIT_MAX_REQUESTS: '250',
        RATE_LIMIT_STRICT_MAX_REQUESTS: '5',
      })
    ).toEqual({ windowMs: 15_000, maxRequests: 250, strictMaxRequests: 5 });
  });

  it('falls back to defaults for invalid values', () => {
    expect(
      loadRateLimitConfig({
        RATE_LIMIT_WINDOW_MS: '0',
        RATE_LIMIT_MAX_REQUESTS: '-3',
        RATE_LIMIT_STRICT_MAX_REQUESTS: '10abc',
      })
    ).toEqual(DEFAULT_RATE_LIMIT_CONFIG);
  });
});
