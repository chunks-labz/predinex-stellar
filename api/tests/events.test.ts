import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createEventsRouter } from '../src/routes/events.js';
import { InMemoryPositionSource } from '../src/routes/positions.js';
import type { PlaceBetEvent } from '../src/types/positions.js';

function makeEvent(eventId: string, ledgerSeq: number, eventIndex = 0): PlaceBetEvent {
  return {
    eventId,
    eventIndex,
    market: 1,
    account: 'GABC1234ABCD5678EFGH9012IJKL3456MNOP7890QRST1234UVWX5678YZAB',
    outcome: 0,
    amount: String(ledgerSeq * 100),
    totalYes: String(ledgerSeq * 100),
    totalNo: '0',
    txHash: `tx-${eventId}`,
    ledgerSeq,
  };
}

describe('GET /api/events', () => {
  let source: InMemoryPositionSource;
  let app: express.Express;

  beforeEach(async () => {
    source = new InMemoryPositionSource();
    await source.upsert(makeEvent('event-a', 10));
    await source.upsert(makeEvent('event-b', 11, 0));
    await source.upsert(makeEvent('event-c', 11, 1));
    app = express();
    app.use('/api/events', createEventsRouter(source));
  });

  it('paginates chronologically with an opaque cursor as new events arrive', async () => {
    const first = await request(app).get('/api/events?limit=2');

    expect(first.status).toBe(200);
    expect(first.body.data.map((event: PlaceBetEvent) => event.eventId))
      .toEqual(['event-a', 'event-b']);
    expect(first.body.pagination.nextCursor).toEqual(expect.any(String));

    await source.upsert(makeEvent('event-d', 11, 2));
    const next = await request(app)
      .get(`/api/events?limit=2&cursor=${encodeURIComponent(first.body.pagination.nextCursor)}`);

    expect(next.status).toBe(200);
    expect(next.body.data.map((event: PlaceBetEvent) => event.eventId))
      .toEqual(['event-c', 'event-d']);
    expect(next.body.pagination.hasMore).toBe(false);
  });

  it('keeps offset pagination available', async () => {
    const response = await request(app).get('/api/events?limit=2&offset=1');

    expect(response.status).toBe(200);
    expect(response.body.data.map((event: PlaceBetEvent) => event.eventId))
      .toEqual(['event-b', 'event-c']);
    expect(response.body.pagination).toMatchObject({ offset: 1, nextOffset: null });
  });

  it('rejects invalid cursors and cursor/offset combinations', async () => {
    const invalidCursor = await request(app).get('/api/events?cursor=not-a-cursor');
    const mixedPagination = await request(app).get('/api/events?cursor=&offset=0');

    expect(invalidCursor.status).toBe(400);
    expect(mixedPagination.status).toBe(400);
  });
});
