/**
 * Tests for /healthz (liveness) and /readyz (readiness) probes. (#1429)
 *
 * Acceptance criteria:
 *   - Liveness always returns 200 when the process is up.
 *   - Readiness reflects dependency availability.
 */

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('Liveness probe — GET /healthz', () => {
  it('returns 200 with { status: "ok" } when the process is up', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/healthz');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not reveal internal details in the liveness response', async () => {
    const res = await request(app).get('/healthz');

    // Liveness must be minimal — only { status } is guaranteed.
    expect(Object.keys(res.body)).toEqual(['status']);
  });
});

describe('Readiness probe — GET /readyz', () => {
  it('returns 200 with { status: "ok" } when all checks pass', async () => {
    // NODE_ENV is always set in test runner (vitest sets it to "test")
    const res = await request(app).get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('response includes a checks map', async () => {
    const res = await request(app).get('/readyz');

    expect(res.body).toHaveProperty('checks');
    expect(typeof res.body.checks).toBe('object');
  });

  it('config check is ok when NODE_ENV is set', async () => {
    const res = await request(app).get('/readyz');

    expect(res.body.checks.config).toEqual({ ok: true });
  });

  it('api check is ok when module is loaded', async () => {
    const res = await request(app).get('/readyz');

    expect(res.body.checks.api).toEqual({ ok: true });
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/readyz');

    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('Backwards-compatible health aliases', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/health returns 200', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
