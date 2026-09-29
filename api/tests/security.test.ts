import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/middleware/rate-limit.js';
import { AuthValidator } from '../src/middleware/auth.js';
import { SecuritySanitizer } from '../src/middleware/security.js';

describe('Security Measures & Middleware Validation', () => {
  it('enforces sliding-window rate limiting', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    const client = '192.168.1.100';

    expect(limiter.checkLimit(client).allowed).toBe(true);
    expect(limiter.checkLimit(client).allowed).toBe(true);
    expect(limiter.checkLimit(client).allowed).toBe(true);
    // 4th request blocked
    const blocked = limiter.checkLimit(client);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('verifies HMAC-SHA256 signatures with constant-time equality', () => {
    const auth = new AuthValidator('my-secret-key-123');
    const payload = JSON.stringify({ action: 'verify', user: 'G123' });
    const validSig = auth.signPayload(payload);

    expect(auth.verifySignature(payload, validSig)).toBe(true);
    expect(auth.verifySignature(payload, 'sha256=invalidhex00000000000000000000000000000000000000000000000000000000')).toBe(false);
  });

  it('sanitizes addresses and rejects malformed Stellar public keys', () => {
    expect(SecuritySanitizer.isValidStellarAddress('GAX765YUVH7654321012345678901234567890123456789012345678')).toBe(true);
    expect(SecuritySanitizer.isValidStellarAddress('invalid_address_format')).toBe(false);
    expect(SecuritySanitizer.isValidStellarAddress('0x1234567890abcdef')).toBe(false);
  });

  it('detects and rejects prototype pollution attempts', () => {
    const cleanObj = { key: 'value' };
    expect(SecuritySanitizer.isSafeJson(cleanObj)).toBe(true);

    const polluted = JSON.parse('{"__proto__": {"admin": true}}');
    expect(SecuritySanitizer.isSafeJson(polluted)).toBe(false);
  });
});


describe('Extended Auth & Rate Limit Coverage', () => {
  it('authenticates role-based headers correctly', () => {
    const auth = new AuthValidator('secret-key-123');
    auth.registerKey('adm-1', 'Admin');
    auth.registerKey('off-1', 'ComplianceOfficer');
    auth.registerKey('ass-1', 'Assessor');

    expect(auth.authenticate({})).toEqual({ role: 'User' });
    expect(auth.authenticate({ 'x-api-key': 'adm-1' })).toEqual({ apiKey: 'adm-1', role: 'Admin' });
    expect(auth.authenticate({ 'x-api-key': 'off-1' })).toEqual({ apiKey: 'off-1', role: 'ComplianceOfficer' });
    expect(auth.authenticate({ 'x-api-key': 'ass-1' })).toEqual({ apiKey: 'ass-1', role: 'Assessor' });
    expect(auth.authenticate({ 'x-api-key': 'unknown' })).toEqual({ apiKey: 'unknown', role: 'User' });
  });

  it('handles invalid signature prefixes and length mismatches', () => {
    const auth = new AuthValidator('secret-key-123');
    expect(auth.verifySignature('test', 'badprefix_123')).toBe(false);
    expect(auth.verifySignature('test', 'sha256=tooshort')).toBe(false);
  });

  it('resets rate limit tracker for specific client or globally', () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
    limiter.checkLimit('client-a');
    limiter.checkLimit('client-a');
    expect(limiter.checkLimit('client-a').allowed).toBe(false);

    limiter.reset('client-a');
    expect(limiter.checkLimit('client-a').allowed).toBe(true);

    limiter.reset();
    expect(limiter.checkLimit('client-a').allowed).toBe(true);
  });
});
