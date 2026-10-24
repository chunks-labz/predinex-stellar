import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';
import { AuthValidator, resolveAuthSecret } from '../src/middleware/auth.js';

// Issue #1301: the HMAC secret must never fall back to a literal published in
// this repository.
const PUBLIC_DEFAULT = 'stellar-lend-production-secret-key-32b';

describe('AuthValidator secret handling (issue #1301)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects the publicly known default secret in production mode', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => new AuthValidator(PUBLIC_DEFAULT)).toThrow(/publicly known default/);
  });

  it('rejects the publicly known default secret outside production too', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => new AuthValidator(PUBLIC_DEFAULT)).toThrow(/publicly known default/);
  });

  it('rejects an empty or blank secret', () => {
    expect(() => new AuthValidator('')).toThrow(/non-empty/);
    expect(() => new AuthValidator('   ')).toThrow(/non-empty/);
    expect(() => new AuthValidator(undefined as unknown as string)).toThrow(/non-empty/);
  });

  it('accepts an operator-supplied secret', () => {
    const auth = new AuthValidator('operator-supplied-secret');
    const payload = '{"action":"verify"}';
    expect(auth.verifySignature(payload, auth.signPayload(payload))).toBe(true);
  });

  it('resolveAuthSecret throws a clear error when AUTH_SECRET is missing or blank', () => {
    expect(() => resolveAuthSecret({})).toThrow(/AUTH_SECRET is not set/);
    expect(() => resolveAuthSecret({ AUTH_SECRET: '' })).toThrow(/AUTH_SECRET is not set/);
    expect(() => resolveAuthSecret({ AUTH_SECRET: '  \n' })).toThrow(/AUTH_SECRET is not set/);
  });

  it('resolveAuthSecret returns AUTH_SECRET unchanged when it is set', () => {
    expect(resolveAuthSecret({ AUTH_SECRET: 'from-env' })).toBe('from-env');
  });

  it('fails at startup instead of falling back when AUTH_SECRET is unset', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.resetModules();
    await expect(import('../src/middleware/auth.js')).rejects.toThrow(/AUTH_SECRET is not set/);
  });

  it('signs with AUTH_SECRET and does not accept signatures made with the old default', async () => {
    vi.stubEnv('AUTH_SECRET', 'deployment-specific-secret');
    vi.resetModules();
    const { sharedAuthValidator } = await import('../src/middleware/auth.js');

    const payload = '{"action":"verify"}';
    const expected =
      'sha256=' + createHmac('sha256', 'deployment-specific-secret').update(payload).digest('hex');
    const forged = 'sha256=' + createHmac('sha256', PUBLIC_DEFAULT).update(payload).digest('hex');

    expect(sharedAuthValidator.signPayload(payload)).toBe(expected);
    expect(sharedAuthValidator.verifySignature(payload, expected)).toBe(true);
    expect(sharedAuthValidator.verifySignature(payload, forged)).toBe(false);
  });
});
