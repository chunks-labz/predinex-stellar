/**
 * #1437 — Status filtering for the markets query.
 *
 * `GET /api/markets` accepts one or more `status` values (comma-separated or
 * repeated), a `sort` field and an `order`, all of which combine with the
 * existing limit/offset pagination. Cancelled markets stay admin-only.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createMarketsRouter,
  InMemoryMarketSource,
  MarketStatus,
  MarketSummary,
} from '../src/routes/markets.js';
import { sharedRateLimiter } from '../src/middleware/rate-limit.js';
import { sharedAuthValidator } from '../src/middleware/auth.js';
import { parseMarketListQuery } from '../src/services/market-query.js';

const ADMIN_KEY = 'test-admin-key-status-filter';
const USER_KEY = 'test-user-key-status-filter';

function market(
  id: number,
  status: MarketStatus,
  overrides: Partial<MarketSummary> = {}
): MarketSummary {
  return {
    id,
    title: `Market ${String(id).padStart(2, '0')}`,
    outcomes: ['Yes', 'No'],
    status,
    expiry: 1_700_000_000 + id * 100,
    totalVolume: String(id * 1_000),
    ...overrides,
  };
}

/** 4 open, 3 settled, 2 voided, 3 cancelled — inserted out of order. */
function mixedMarkets(): MarketSummary[] {
  return [
    market(1, 'open', { title: 'Zebra' }),
    market(2, 'settled'),
    market(3, 'cancelled'),
    market(4, 'voided'),
    market(5, 'open', { title: 'Alpha', expiry: 1_700_999_999 }),
    market(6, 'settled'),
    market(7, 'cancelled'),
    market(8, 'open', { title: 'Beta' }),
    market(9, 'voided'),
    market(10, 'settled'),
    market(11, 'cancelled'),
    market(12, 'open', { title: 'Gamma' }),
  ];
}

describe('GET /api/markets status filter (#1437)', () => {
  let app: express.Express;

  beforeAll(() => {
    sharedAuthValidator.registerKey(ADMIN_KEY, 'Admin');
    sharedAuthValidator.registerKey(USER_KEY, 'User');
  });

  beforeEach(() => {
    sharedRateLimiter.reset();
    app = express();
    app.use(express.json());
    app.use('/api/markets', createMarketsRouter(new InMemoryMarketSource(mixedMarkets())));
  });

  it('excludes cancelled markets from the default listing', async () => {
    const res = await request(app).get('/api/markets');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(9);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([
      1, 2, 4, 5, 6, 8, 9, 10, 12,
    ]);
    expect(
      res.body.data.every((m: MarketSummary) => m.status !== 'cancelled')
    ).toBe(true);
  });

  it('filters by a single status', async () => {
    const res = await request(app).get('/api/markets?status=open');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(4);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([1, 5, 8, 12]);
    expect(res.body.data.every((m: MarketSummary) => m.status === 'open')).toBe(true);
  });

  it('filters by one or more statuses with a comma-separated list', async () => {
    const res = await request(app).get('/api/markets?status=open,settled');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(7);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([
      1, 2, 5, 6, 8, 10, 12,
    ]);
  });

  it('accepts repeated status parameters', async () => {
    const res = await request(app).get('/api/markets?status=open&status=voided');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(6);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([
      1, 4, 5, 8, 9, 12,
    ]);
  });

  it('de-duplicates repeated statuses', async () => {
    const res = await request(app).get('/api/markets?status=open,open&status=open');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(4);
  });

  it('combines the status filter with pagination', async () => {
    const res = await request(app).get('/api/markets?status=open&limit=2&offset=2');

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([8, 12]);
    expect(res.body.pagination).toMatchObject({
      total: 4,
      limit: 2,
      offset: 2,
      count: 2,
      hasMore: false,
      nextOffset: null,
      prevOffset: 0,
    });
  });

  it('combines status, sorting, and pagination', async () => {
    const res = await request(app).get(
      '/api/markets?status=open,settled&sort=id&order=desc&limit=3&offset=1'
    );

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([10, 8, 6]);
    expect(res.body.pagination).toMatchObject({ total: 7, count: 3, hasMore: true, nextOffset: 4 });
  });

  it('sorts filtered results by expiry descending', async () => {
    const res = await request(app).get('/api/markets?status=open&sort=expiry&order=desc');

    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([5, 12, 8, 1]);
    expect(res.body.data[0].expiry).toBeGreaterThan(res.body.data[1].expiry);
  });

  it('sorts results by volume using numeric ordering, not string ordering', async () => {
    const big = express();
    big.use(
      '/api/markets',
      createMarketsRouter(
        new InMemoryMarketSource([
          market(1, 'open', { totalVolume: '9' }),
          market(2, 'open', { totalVolume: '100' }),
          market(3, 'open', { totalVolume: '20' }),
        ])
      )
    );

    const res = await request(big).get('/api/markets?sort=volume&order=desc');

    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([2, 3, 1]);
  });

  it('sorts results by title', async () => {
    const res = await request(app).get('/api/markets?status=open&sort=title&order=asc');

    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([5, 8, 12, 1]);
  });

  it('accepts archived as a valid status filter', async () => {
    const archivedApp = express();
    archivedApp.use(express.json());
    archivedApp.use(
      '/api/markets',
      createMarketsRouter(
        new InMemoryMarketSource([
          market(13, 'archived', { settledAt: '2025-01-01T00:00:00.000Z' }),
        ])
      )
    );

    const res = await request(archivedApp).get('/api/markets?status=archived');

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([13]);
  });

  it('rejects an unknown status with a validation error', async () => {
    const res = await request(app).get('/api/markets?status=bogus');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.join(' ')).toContain('status must be one of');
  });

  it('rejects an empty status value', async () => {
    const res = await request(app).get('/api/markets?status=');

    expect(res.status).toBe(400);
    expect(res.body.error.details.join(' ')).toContain('status must not contain empty values');
  });

  it('rejects unknown sort and order values', async () => {
    const badSort = await request(app).get('/api/markets?sort=created_at');
    expect(badSort.status).toBe(400);
    expect(badSort.body.error.details.join(' ')).toContain('sort must be one of');

    const badOrder = await request(app).get('/api/markets?order=sideways');
    expect(badOrder.status).toBe(400);
    expect(badOrder.body.error.details.join(' ')).toContain('order must be one of');
  });

  it('reports pagination and filter errors together', async () => {
    const res = await request(app).get('/api/markets?limit=0&status=bogus');

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveLength(2);
  });

  it('requires admin access to filter cancelled markets', async () => {
    const anonymous = await request(app).get('/api/markets?status=cancelled');
    expect(anonymous.status).toBe(403);
    expect(anonymous.body.error.code).toBe('FORBIDDEN');

    const user = await request(app)
      .get('/api/markets?status=cancelled')
      .set('x-api-key', USER_KEY);
    expect(user.status).toBe(403);
  });

  it('lets admins filter cancelled markets with pagination and sorting', async () => {
    const res = await request(app)
      .get('/api/markets?status=cancelled&sort=id&order=desc&limit=2')
      .set('x-api-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([11, 7]);
    expect(res.body.pagination).toMatchObject({ total: 3, count: 2, hasMore: true, nextOffset: 2 });
  });
});

describe('parseMarketListQuery (#1437)', () => {
  it('applies defaults when parameters are omitted', () => {
    expect(parseMarketListQuery({})).toEqual({
      ok: true,
      params: { statuses: undefined, sortBy: 'id', order: 'asc' },
    });
  });

  it('normalizes and de-duplicates statuses', () => {
    const result = parseMarketListQuery({ status: ['Open, settled', 'open'] });
    expect(result).toEqual({
      ok: true,
      params: { statuses: ['open', 'settled'], sortBy: 'id', order: 'asc' },
    });
  });

  it('collects every validation error', () => {
    const result = parseMarketListQuery({ status: 'bogus', sort: 'nope', order: 'up' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(3);
  });
});
