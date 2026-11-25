import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sharedAuthValidator } from '../src/middleware/auth.js';

const ADMIN_KEY = 'test-admin-key-observability-1686';
const app = createApp();

describe('observability routes', () => {
  beforeAll(() => {
    delete process.env.SOROBAN_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.INDEXER_STATUS_URL;
    sharedAuthValidator.registerKey(ADMIN_KEY, 'Admin');
  });

  it('requires admin access', async () => {
    const response = await request(app).get('/api/observability/indexer-lag');
    expect(response.status).toBe(401);
  });

  it('serves Prometheus metrics', async () => {
    const response = await request(app)
      .get('/api/observability/metrics')
      .set('x-api-key', ADMIN_KEY);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# TYPE predinex_indexer_current_ledger_height gauge');
    expect(response.text).toContain('# TYPE predinex_oracle_feed_stale gauge');
  });

  it('records a successful feed update', async () => {
    const response = await request(app)
      .post('/api/observability/oracle-feeds')
      .set('x-api-key', ADMIN_KEY)
      .send({ feed: 'pool:42', updatedAt: Date.now() });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ feed: 'pool:42', stale: false });
  });
});
