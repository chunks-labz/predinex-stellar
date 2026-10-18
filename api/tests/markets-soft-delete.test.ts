/**
 * #1436 — Soft-delete for cancelled markets.
 *
 * Cancelling a market keeps its record (status set to `cancelled`, audit
 * fields attached) instead of deleting it. Cancelled markets disappear from
 * the default listing, remain readable by admins, and can be restored.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createMarketsRouter,
  InMemoryMarketSource,
  MarketAuditEntry,
  MarketSummary,
} from '../src/routes/markets.js';
import { sharedRateLimiter, strictRateLimiter } from '../src/middleware/rate-limit.js';
import { sharedAuthValidator } from '../src/middleware/auth.js';

const ADMIN_KEY = 'test-admin-key-soft-delete';
const USER_KEY = 'test-user-key-soft-delete';

function market(id: number, overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    id,
    title: `Market ${id}`,
    outcomes: ['Yes', 'No'],
    status: 'open',
    expiry: 1_700_000_000 + id,
    totalVolume: String(id * 1_000),
    ...overrides,
  };
}

function settledMarket(id: number, settledAt: string): MarketSummary {
  return market(id, { status: 'settled', settledAt });
}

function makeMarkets(n: number): MarketSummary[] {
  return Array.from({ length: n }, (_, i) => market(i + 1));
}

describe('market soft-delete (#1436)', () => {
  let app: express.Express;
  let source: InMemoryMarketSource;

  beforeAll(() => {
    sharedAuthValidator.registerKey(ADMIN_KEY, 'Admin');
    sharedAuthValidator.registerKey(USER_KEY, 'User');
  });

  beforeEach(() => {
    sharedRateLimiter.reset();
    strictRateLimiter.reset();
    source = new InMemoryMarketSource(makeMarkets(5));
    app = express();
    app.use(express.json());
    app.use('/api/markets', createMarketsRouter(source));
  });

  const asAdmin = (req: request.Test) => req.set('x-api-key', ADMIN_KEY);

  it('marks a cancelled market instead of deleting it', async () => {
    const res = await asAdmin(
      request(app).post('/api/markets/2/cancel').send({ reason: 'duplicate market' })
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: 2,
      title: 'Market 2',
      outcomes: ['Yes', 'No'],
      status: 'cancelled',
      totalVolume: '2000',
      cancelledBy: 'admin',
      cancelReason: 'duplicate market',
    });
    expect(typeof res.body.data.cancelledAt).toBe('string');
    expect(res.body.data.expiry).toBe(1_700_000_002);
  });

  it('keeps the cancelled record readable by id and via the admin listing', async () => {
    await asAdmin(request(app).post('/api/markets/2/cancel'));
    sharedRateLimiter.reset();

    // The backing store still holds the row...
    expect(await source.get(2)).toMatchObject({ id: 2, status: 'cancelled' });

    // ...and the admin listing exposes it with pagination metadata.
    const listing = await asAdmin(request(app).get('/api/markets/admin/cancelled'));
    expect(listing.status).toBe(200);
    expect(listing.body.data).toHaveLength(1);
    expect(listing.body.data[0]).toMatchObject({ id: 2, status: 'cancelled' });
    expect(listing.body.pagination).toMatchObject({ total: 1, offset: 0 });
  });

  it('hides cancelled markets from the default listing', async () => {
    await asAdmin(request(app).post('/api/markets/2/cancel'));
    sharedRateLimiter.reset();

    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(4);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([1, 3, 4, 5]);
  });

  it('archives resolved markets older than the configured window and keeps them out of the default listing', async () => {
    const archiveSource = new InMemoryMarketSource([
      market(1),
      settledMarket(2, '2025-01-01T00:00:00.000Z'),
      settledMarket(3, new Date().toISOString()),
    ]);
    const archiveApp = express();
    archiveApp.use(express.json());
    archiveApp.use('/api/markets', createMarketsRouter(archiveSource));

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const res = await request(archiveApp)
        .post('/api/markets/admin/archive-resolved')
        .set('x-api-key', ADMIN_KEY)
        .send({ windowDays: 30 });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ archivedCount: 1, windowDays: 30 });
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Archived 1 resolved markets'));

      const listing = await request(archiveApp).get('/api/markets');
      expect(listing.body.data.map((m: MarketSummary) => m.id)).toEqual([1, 3]);
      expect(await archiveSource.get(2)).toMatchObject({ id: 2, status: 'archived' });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('rate limits repeated write requests with 429 and Retry-After', async () => {
    let lastResponse: request.Response | null = null;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      lastResponse = await asAdmin(request(app).post('/api/markets/4/cancel'));
    }

    expect(lastResponse).not.toBeNull();
    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.headers['retry-after']).toBeDefined();
  });

  it('preserves the audit history of a cancellation', async () => {
    await asAdmin(
      request(app).post('/api/markets/3/cancel').send({ reason: 'oracle outage' })
    );
    sharedRateLimiter.reset();

    const res = await asAdmin(request(app).get('/api/markets/admin/audit?marketId=3'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      marketId: 3,
      action: 'cancelled',
      actor: 'admin',
      reason: 'oracle outage',
      fromStatus: 'open',
      toStatus: 'cancelled',
    });
    expect(typeof res.body.data[0].timestamp).toBe('string');
  });

  it('restores a cancelled market to its previous status', async () => {
    await asAdmin(request(app).post('/api/markets/2/cancel').send({ reason: 'mistake' }));
    sharedRateLimiter.reset();

    const restored = await asAdmin(request(app).post('/api/markets/2/restore'));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ id: 2, status: 'open' });
    expect(restored.body.data.cancelledAt).toBeUndefined();
    expect(restored.body.data.cancelledBy).toBeUndefined();
    expect(restored.body.data.cancelReason).toBeUndefined();

    // Back in the default listing...
    sharedRateLimiter.reset();
    const listing = await request(app).get('/api/markets');
    expect(listing.body.pagination.total).toBe(5);
    expect(listing.body.data.map((m: MarketSummary) => m.id)).toContain(2);

    // ...and the restoration is audited.
    const audit = await asAdmin(request(app).get('/api/markets/admin/audit?marketId=2'));
    expect(audit.body.data.map((e: MarketAuditEntry) => e.action)).toEqual([
      'restored',
      'cancelled',
    ]);
    expect(audit.body.data[0]).toMatchObject({ fromStatus: 'cancelled', toStatus: 'open' });
  });

  it('restores a settled market to settled, not open', async () => {
    const settledSource = new InMemoryMarketSource([market(9, { status: 'settled' })]);
    const settledApp = express();
    settledApp.use(express.json());
    settledApp.use('/api/markets', createMarketsRouter(settledSource));

    await asAdmin(request(settledApp).post('/api/markets/9/cancel'));
    sharedRateLimiter.reset();
    const restored = await asAdmin(request(settledApp).post('/api/markets/9/restore'));
    expect(restored.body.data.status).toBe('settled');
  });

  it('treats a repeated cancellation as idempotent', async () => {
    const first = await asAdmin(
      request(app).post('/api/markets/2/cancel').send({ reason: 'first' })
    );
    sharedRateLimiter.reset();
    const second = await asAdmin(
      request(app).post('/api/markets/2/cancel').send({ reason: 'second' })
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.cancelReason).toBe('first');
    expect(second.body.data.cancelledAt).toBe(first.body.data.cancelledAt);

    const audit = await asAdmin(request(app).get('/api/markets/admin/audit?marketId=2'));
    expect(audit.body.data).toHaveLength(1);
  });

  it('rejects restoring a market that is not cancelled', async () => {
    const res = await asAdmin(request(app).post('/api/markets/4/restore'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_CANCELLED');
  });

  it('returns 404 for unknown markets', async () => {
    const cancel = await asAdmin(request(app).post('/api/markets/99/cancel'));
    expect(cancel.status).toBe(404);
    expect(cancel.body.error.code).toBe('NOT_FOUND');

    const restore = await asAdmin(request(app).post('/api/markets/99/restore'));
    expect(restore.status).toBe(404);
  });

  it('rejects invalid market ids with 400', async () => {
    for (const id of ['abc', '0', '-1', '1.5']) {
      const res = await asAdmin(request(app).post(`/api/markets/${id}/cancel`));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires admin access to cancel, restore, list, or audit cancelled markets', async () => {
    const anonymousCancel = await request(app).post('/api/markets/1/cancel');
    expect(anonymousCancel.status).toBe(403);

    const userCancel = await request(app)
      .post('/api/markets/1/cancel')
      .set('x-api-key', USER_KEY);
    expect(userCancel.status).toBe(403);

    const userRestore = await request(app)
      .post('/api/markets/1/restore')
      .set('x-api-key', USER_KEY);
    expect(userRestore.status).toBe(403);

    const userCancelled = await request(app)
      .get('/api/markets/admin/cancelled')
      .set('x-api-key', USER_KEY);
    expect(userCancelled.status).toBe(403);

    const userAudit = await request(app)
      .get('/api/markets/admin/audit')
      .set('x-api-key', USER_KEY);
    expect(userAudit.status).toBe(403);

    // The unauthenticated market itself was never touched.
    expect((await source.get(1))?.status).toBe('open');
  });

  it('validates the cancellation reason', async () => {
    const tooLong = await asAdmin(
      request(app).post('/api/markets/1/cancel').send({ reason: 'x'.repeat(257) })
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.message).toContain('at most 256 characters');

    const wrongType = await asAdmin(
      request(app).post('/api/markets/1/cancel').send({ reason: 42 })
    );
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.message).toBe('reason must be a string');

    expect((await source.get(1))?.status).toBe('open');
  });

  it('paginates the cancelled listing', async () => {
    const many = new InMemoryMarketSource(makeMarkets(12));
    const manyApp = express();
    manyApp.use(express.json());
    manyApp.use('/api/markets', createMarketsRouter(many));

    for (let id = 1; id <= 9; id += 1) {
      const res = await asAdmin(request(manyApp).post(`/api/markets/${id}/cancel`));
      expect(res.status).toBe(200);
    }
    sharedRateLimiter.reset();

    const page = await asAdmin(
      request(manyApp).get('/api/markets/admin/cancelled?limit=4&offset=4')
    );
    expect(page.status).toBe(200);
    expect(page.body.data.map((m: MarketSummary) => m.id)).toEqual([5, 6, 7, 8]);
    expect(page.body.pagination).toMatchObject({
      total: 9,
      limit: 4,
      offset: 4,
      count: 4,
      hasMore: true,
      nextOffset: 8,
      prevOffset: 0,
    });
  });

  it('still reports cancelled counts in admin metrics', async () => {
    await asAdmin(request(app).post('/api/markets/2/cancel'));
    sharedRateLimiter.reset();

    const res = await asAdmin(request(app).get('/api/markets/admin/metrics'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      totalMarkets: 5,
      openMarkets: 4,
      cancelledMarkets: 1,
    });
  });
});
