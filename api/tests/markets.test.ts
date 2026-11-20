import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createMarketsRouter,
  InMemoryMarketSource,
  MarketSummary,
} from '../src/routes/markets.js';
import { sharedRateLimiter } from '../src/middleware/rate-limit.js';
import {
  buildPageMeta,
  MAX_PAGE_LIMIT,
  parsePagination,
} from '../src/services/pagination.js';

function market(id: number): MarketSummary {
  return {
    id,
    title: `Market ${id}`,
    outcomes: ['Yes', 'No'],
    status: 'open',
    expiry: 1_700_000_000 + id,
    totalVolume: String(id * 1_000),
  };
}

function makeMarkets(n: number): MarketSummary[] {
  return Array.from({ length: n }, (_, i) => market(i + 1));
}

describe('Markets list pagination (Issue #1420)', () => {
  let app: express.Express;

  beforeEach(() => {
    sharedRateLimiter.reset();
    // Insert out of order to prove the response ordering is stable by id.
    const markets = makeMarkets(45).reverse();
    app = express();
    app.use('/api/markets', createMarketsRouter(new InMemoryMarketSource(markets)));
  });

  it('returns the first page with default limit and metadata', async () => {
    const res = await request(app).get('/api/markets');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0].id).toBe(1);
    expect(res.body.data[19].id).toBe(20);
    expect(res.body.pagination).toEqual({
      total: 45,
      limit: 20,
      offset: 0,
      count: 20,
      hasMore: true,
      nextOffset: 20,
      prevOffset: null,
    });
  });

  it('returns a middle page in stable id order', async () => {
    const res = await request(app).get('/api/markets?limit=10&offset=20');

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);
    expect(res.body.pagination).toMatchObject({
      total: 45,
      offset: 20,
      count: 10,
      hasMore: true,
      nextOffset: 30,
      prevOffset: 10,
    });
  });

  it('returns a partial last page with no next page', async () => {
    const res = await request(app).get('/api/markets?limit=20&offset=40');

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: MarketSummary) => m.id)).toEqual([41, 42, 43, 44, 45]);
    expect(res.body.pagination).toMatchObject({
      count: 5,
      hasMore: false,
      nextOffset: null,
      prevOffset: 20,
    });
  });

  it('returns an empty page for an out-of-range offset', async () => {
    const res = await request(app).get('/api/markets?limit=10&offset=500');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({
      total: 45,
      offset: 500,
      count: 0,
      hasMore: false,
      nextOffset: null,
      prevOffset: 35,
    });
  });

  it('caps limit at the maximum page size', async () => {
    const big = express();
    big.use('/api/markets', createMarketsRouter(new InMemoryMarketSource(makeMarkets(250))));

    const res = await request(big).get('/api/markets?limit=100000');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(MAX_PAGE_LIMIT);
    expect(res.body.pagination.limit).toBe(MAX_PAGE_LIMIT);
    expect(res.body.pagination.nextOffset).toBe(MAX_PAGE_LIMIT);
  });

  it.each([
    ['limit=0'],
    ['limit=-5'],
    ['limit=abc'],
    ['limit=1.5'],
    ['offset=-1'],
    ['offset=xyz'],
    ['limit=10&limit=20'],
  ])('rejects invalid pagination parameters (%s) with 400', async (qs) => {
    const res = await request(app).get(`/api/markets?${qs}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles an empty market list', async () => {
    const empty = express();
    empty.use('/api/markets', createMarketsRouter(new InMemoryMarketSource()));

    const res = await request(empty).get('/api/markets');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ total: 0, hasMore: false, nextOffset: null });
  });
});

describe('pagination helpers (Issue #1420)', () => {
  it('applies defaults when parameters are omitted', () => {
    expect(parsePagination({})).toEqual({ ok: true, params: { limit: 20, offset: 0 } });
  });

  it('reports every invalid parameter', () => {
    const result = parsePagination({ limit: '0', offset: '-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('builds metadata for an exact final page', () => {
    expect(buildPageMeta(30, { limit: 10, offset: 20 }, 10)).toMatchObject({
      hasMore: false,
      nextOffset: null,
      prevOffset: 10,
    });
  });
});
