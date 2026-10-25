import { describe, it, expect } from 'vitest';
import { checkRateLimit, clientIpFromHeaders, rateLimitHeaders } from '@/app/lib/rate-limit';

describe('clientIpFromHeaders', () => {
  it('uses the left-most x-forwarded-for entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(clientIpFromHeaders(headers)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers({ 'x-real-ip': '198.51.100.4' });
    expect(clientIpFromHeaders(headers)).toBe('198.51.100.4');
  });

  it('buckets headerless requests together as anonymous', () => {
    expect(clientIpFromHeaders(new Headers())).toBe('anonymous');
  });

  it('ignores an empty x-forwarded-for value', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '  ' }))).toBe('anonymous');
  });
});

describe('checkRateLimit', () => {
  it('allows up to max and then blocks within the window', () => {
    const key = `test-rate-limit-${Math.random()}`;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit(key, { max: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, { max: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('keys callers independently', () => {
    const opts = { max: 1, windowMs: 60_000 };
    expect(checkRateLimit('caller-a', opts).allowed).toBe(true);
    expect(checkRateLimit('caller-b', opts).allowed).toBe(true);
    expect(checkRateLimit('caller-a', opts).allowed).toBe(false);
  });

  it('exposes RFC-7235 style headers', () => {
    const rl = checkRateLimit(`header-test-${Math.random()}`, { max: 5, windowMs: 60_000 });
    const headers = rateLimitHeaders(rl);
    expect(headers['X-RateLimit-Limit']).toBe('5');
    expect(headers['X-RateLimit-Remaining']).toBe('4');
    expect(Number(headers['X-RateLimit-Reset'])).toBeGreaterThan(0);
  });
});
