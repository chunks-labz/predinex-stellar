import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { sharedAuthValidator } from '../src/middleware/auth.js';
import {
  createMarketsRouter,
  InMemoryMarketSource,
  type MarketTradeRecord,
  type TradeHistorySource,
  UnconfiguredTradeHistorySource,
  type MarketSummary,
} from '../src/routes/markets.js';

const market: MarketSummary = {
  id: 7,
  title: 'CSV export market',
  outcomes: ['Yes', 'No'],
  status: 'open',
  expiry: 1_800_000_000,
  totalVolume: '0',
};
const owner = `G${'A'.repeat(55)}`;
const otherOwner = `G${'B'.repeat(55)}`;
let keyCounter = 0;

function registerCaller(): string {
  const key = `trade-export-user-${keyCounter++}`;
  sharedAuthValidator.registerUserKey(key, owner);
  return key;
}

function appWithTradeSource(tradeSource: TradeHistorySource) {
  const app = express();
  app.use(
    '/api/markets',
    createMarketsRouter(new InMemoryMarketSource([market]), undefined, tradeSource),
  );
  return app;
}

function makeTrade(
  overrides: Partial<MarketTradeRecord> = {},
): MarketTradeRecord {
  return {
    tradeId: 'trade-1',
    marketId: market.id,
    userAddress: owner,
    side: 'buy',
    outcome: 'Yes',
    amount: '1.50',
    price: '0.70',
    timestamp: Date.parse('2025-01-02T12:00:00.000Z') / 1000,
    transactionHash: 'tx-1',
    ...overrides,
  };
}

describe('GET /markets/:id/trades/export', () => {
  it('returns only the caller’s trades as correctly escaped RFC 4180 CSV', async () => {
    const key = registerCaller();
    const tradeSource: TradeHistorySource = {
      // Deliberately returns extra records to verify the route enforces owner and market scope.
      listTrades: async () => [
        makeTrade({ tradeId: 'trade, "1"', outcome: 'Yes, "Maybe"' }),
        makeTrade({ tradeId: 'other-user', userAddress: otherOwner }),
        makeTrade({ tradeId: 'other-market', marketId: market.id + 1 }),
      ],
    };

    const response = await request(appWithTradeSource(tradeSource))
      .get(`/api/markets/${market.id}/trades/export`)
      .set('x-api-key', key)
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="market-${market.id}-trades.csv"`,
    );
    expect(response.text).toBe(
      [
        'trade_id,market_id,user_address,side,outcome,amount,price,timestamp,tx_hash',
        `"trade, ""1""",7,${owner},buy,"Yes, ""Maybe""",1.50,0.70,2025-01-02T12:00:00.000Z,tx-1`,
        '',
      ].join('\r\n'),
    );
  });

  it('returns a header-only CSV when the caller has no matching trades', async () => {
    const key = registerCaller();
    const response = await request(
      appWithTradeSource({ listTrades: async () => [] }),
    )
      .get(`/api/markets/${market.id}/trades/export`)
      .set('x-api-key', key)
      .expect(200);

    expect(response.text).toBe(
      'trade_id,market_id,user_address,side,outcome,amount,price,timestamp,tx_hash\r\n',
    );
  });

  it('requires an authenticated API key bound to a wallet address', async () => {
    await request(appWithTradeSource({ listTrades: async () => [] }))
      .get(`/api/markets/${market.id}/trades/export`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.error.code).toBe('UNAUTHORIZED');
      });
  });

  it('applies inclusive date, side, and pagination filters', async () => {
    const key = registerCaller();
    const listTrades = vi.fn(async () => [
      makeTrade({ tradeId: 'older', timestamp: Date.parse('2024-12-31T23:59:59Z') / 1000 }),
      makeTrade({
        tradeId: 'matching-latest',
        side: 'sell',
        timestamp: Date.parse('2025-01-02T12:00:00Z') / 1000,
      }),
      makeTrade({
        tradeId: 'matching-earlier',
        side: 'sell',
        timestamp: Date.parse('2025-01-01T12:00:00Z') / 1000,
      }),
      makeTrade({
        tradeId: 'later',
        side: 'sell',
        timestamp: Date.parse('2025-01-03T00:00:00Z') / 1000,
      }),
    ]);
    const response = await request(appWithTradeSource({ listTrades }))
      .get(
        `/api/markets/${market.id}/trades/export?from=2025-01-01&to=2025-01-02&side=sell&limit=1&offset=1`,
      )
      .set('x-api-key', key)
      .expect(200);

    expect(listTrades).toHaveBeenCalledWith(market.id, owner, {
      from: Date.parse('2025-01-01T00:00:00.000Z'),
      to: Date.parse('2025-01-02T23:59:59.999Z'),
      side: 'sell',
    });
    expect(response.text).toContain('matching-earlier');
    expect(response.text).not.toContain('matching-latest');
    expect(response.text).not.toContain('older');
    expect(response.text).not.toContain('later');
  });

  it('reports an explicit unavailable response until a trade source is injected', async () => {
    const key = registerCaller();
    const app = appWithTradeSource(new UnconfiguredTradeHistorySource());

    await request(app)
      .get(`/api/markets/${market.id}/trades/export`)
      .set('x-api-key', key)
      .expect(503)
      .expect(({ body }) => {
        expect(body.error.code).toBe('TRADE_HISTORY_UNAVAILABLE');
      });
  });
});
