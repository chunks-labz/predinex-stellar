import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getAllowedOrigins, DEFAULT_ALLOWED_ORIGINS } from '../src/config/cors.js';

describe('CORS Configuration & Enforcement (Issue #1200)', () => {
  it('has an explicit allowlist sourced from configuration without wildcard origins', () => {
    const origins = getAllowedOrigins();
    expect(origins.length).toBeGreaterThan(0);
    expect(origins).not.toContain('*');
    for (const origin of DEFAULT_ALLOWED_ORIGINS) {
      expect(origins).toContain(origin);
    }
  });

  it('does not set Access-Control-Allow-Origin for disallowed origins', async () => {
    const disallowedOrigin = 'https://unauthorized-attacker.com';
    const res = await request(app)
      .get('/health')
      .set('Origin', disallowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets Access-Control-Allow-Origin for explicit allowed origins', async () => {
    const allowedOrigin = 'https://app.predinex.stellar.org';
    const res = await request(app)
      .get('/health')
      .set('Origin', allowedOrigin);

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
  });

  it('handles OPTIONS preflight for allowed origin and omits wildcard header', async () => {
    const allowedOrigin = 'https://predinex.stellar.org';
    const res = await request(app)
      .options('/api/budget/health')
      .set('Origin', allowedOrigin)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('rejects preflight for disallowed origin without returning allow header', async () => {
    const disallowedOrigin = 'https://malicious-site.xyz';
    const res = await request(app)
      .options('/api/budget/plan')
      .set('Origin', disallowedOrigin)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
