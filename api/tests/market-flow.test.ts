import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createMarketsRouter,
  InMemoryMarketSource,
  MarketCreator,
  MarketSummary,
} from '../src/routes/markets.js';
import { sharedRateLimiter } from '../src/middleware/rate-limit.js';

/**
 * Hermetic API-level market lifecycle flow (Issue #1435).
 *
 * Everything runs in-process against an in-memory market source, so the test
 * needs no node, database or network and is repeatable. The API exposes
 * market creation (POST) and the indexed market list (GET); the on-chain
 * wager, resolve and claim steps happen in the contract and are covered by
 * `contracts/predinex/src/integration_tests.rs`. Here those steps are
 * represented by updating the source the way an indexer would, so the flow
 * asserts the state the API serves after each stage.
 *
 * Every step runs inside `stage()`, which prefixes failures with the stage
 * name so a failure points to the broken stage.
 */
async function stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error) err.message = `[${name}] ${err.message}`;
    throw err;
  }
}

describe('Market lifecycle flow: create → wager → resolve → list (Issue #1435)', () => {
  let source: InMemoryMarketSource;
  let indexed: MarketSummary[];
  let app: express.Express;

  beforeEach(() => {
    sharedRateLimiter.reset();
    indexed = [];
    source = new InMemoryMarketSource();

    const creator: MarketCreator = async (req) => {
      const market: MarketSummary = {
        id: indexed.length + 1,
        title: req.title,
        outcomes: req.outcomes,
        status: 'open',
        expiry: req.closeTime,
        totalVolume: '0',
      };
      indexed.push(market);
      source.setMarkets(indexed);
      return market;
    };

    app = express();
    app.use(express.json());
    app.use('/api/markets', createMarketsRouter(source, creator));
  });

  async function listMarkets() {
    const res = await request(app).get('/api/markets');
    expect(res.status).toBe(200);
    return res.body.data as MarketSummary[];
  }

  it('serves the correct indexed state after each stage', async () => {
    const closeTime = Math.floor(Date.now() / 1000) + 3_600;

    const created = await stage('create', async () => {
      const res = await request(app)
        .post('/api/markets')
        .send({ title: 'Will it rain tomorrow?', outcomes: ['Yes', 'No'], closeTime });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ id: 1, status: 'open', totalVolume: '0', expiry: closeTime });
      return res.body.data as MarketSummary;
    });

    await stage('index after create', async () => {
      expect(await listMarkets()).toEqual([created]);
    });

    await stage('wager', async () => {
      indexed[0] = { ...indexed[0], totalVolume: '3000' };
      source.setMarkets(indexed);
      expect(await listMarkets()).toEqual([expect.objectContaining({ id: 1, status: 'open', totalVolume: '3000' })]);
    });

    await stage('resolve', async () => {
      indexed[0] = { ...indexed[0], status: 'settled' };
      source.setMarkets(indexed);
      expect(await listMarkets()).toEqual([
        expect.objectContaining({ id: 1, status: 'settled', totalVolume: '3000' }),
      ]);
    });
  });

  it('does not index a market whose creation is rejected', async () => {
    await stage('create (invalid)', async () => {
      const res = await request(app)
        .post('/api/markets')
        .send({ title: '', outcomes: ['Yes'], closeTime: 1 });
      expect(res.status).toBe(400);
    });

    await stage('index after rejected create', async () => {
      expect(await listMarkets()).toEqual([]);
    });
  });

  it('is repeatable: a fresh run starts from empty state', async () => {
    await stage('initial state', async () => {
      expect(await listMarkets()).toEqual([]);
    });
  });
});
