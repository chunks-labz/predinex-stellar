/**
 * Idempotency-Key support for order submission (Issue #1466).
 *
 * POST /api/markets accepts an optional `Idempotency-Key` header. Retried
 * submissions with the same key and payload create exactly one order and
 * replay the first response; conflicting payloads under the same key are
 * rejected with 409; requests without a key behave as before.
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import {
  canonicalizePayload,
  hashPayload,
  IdempotencyStore,
} from '../src/middleware/idempotency.js';
import { createMarketsRouter, InMemoryMarketSource, MarketCreator } from '../src/routes/markets.js';
import { sharedRateLimiter } from '../src/middleware/rate-limit.js';

const NOW = Math.floor(Date.now() / 1000);

const created = {
  id: 1,
  title: 'Will it rain tomorrow?',
  outcomes: ['Yes', 'No'],
  status: 'open' as const,
  expiry: 0,
  totalVolume: '0',
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Will it rain tomorrow?',
    outcomes: ['Yes', 'No'],
    closeTime: NOW + 3600,
    ...overrides,
  };
}

describe('canonicalizePayload / hashPayload', () => {
  it('hashes semantically equal payloads identically regardless of key order', () => {
    expect(hashPayload({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(
      hashPayload({ b: [2, { d: 4, c: 3 }], a: 1 })
    );
  });

  it('distinguishes payloads with different values', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it('round-trips primitives and null', () => {
    expect(canonicalizePayload(null)).toBe('null');
    expect(canonicalizePayload(7)).toBe('7');
    expect(canonicalizePayload('x')).toBe('"x"');
  });
});

describe('POST /api/markets with Idempotency-Key (Issue #1466)', () => {
  let creator: Mock<MarketCreator>;
  let store: IdempotencyStore;
  let app: express.Express;

  function buildApp(withStore = true) {
    const a = express();
    a.use(express.json());
    a.use(
      '/api/markets',
      createMarketsRouter(new InMemoryMarketSource(), creator, {
        idempotencyStore: withStore ? store : undefined,
      })
    );
    return a;
  }

  beforeEach(() => {
    sharedRateLimiter.reset();
    store = new IdempotencyStore();
    creator = vi.fn(async () => created);
    app = buildApp();
  });

  it('creates exactly one order when a request is retried with the same key', async () => {
    const payload = validPayload();

    const first = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-1')
      .send(payload);
    expect(first.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    const replay = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-1')
      .send(payload);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);

    expect(creator).toHaveBeenCalledTimes(1);
  });

  it('treats semantically equal payloads as duplicates regardless of key order', async () => {
    await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-2')
      .send({ title: 'T', outcomes: ['A', 'B'], closeTime: NOW + 3600 });

    const replay = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-2')
      .send({ closeTime: NOW + 3600, outcomes: ['A', 'B'], title: 'T' });

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(creator).toHaveBeenCalledTimes(1);
  });

  it('rejects conflicting reuse of a key with a different payload', async () => {
    const first = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-3')
      .send(validPayload());
    expect(first.status).toBe(201);

    const conflicting = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-3')
      .send(validPayload({ title: 'A different market' }));
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    expect(creator).toHaveBeenCalledTimes(1);
  });

  it('scopes keys per caller', async () => {
    const payload = validPayload();
    await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'shared-key')
      .set('x-api-key', 'caller-a')
      .send(payload);
    const other = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'shared-key')
      .set('x-api-key', 'caller-b')
      .send(payload);

    expect(other.status).toBe(201);
    expect(other.headers['idempotency-replayed']).toBeUndefined();
    expect(creator).toHaveBeenCalledTimes(2);
  });

  it('rejects concurrent duplicates with 409 IDEMPOTENCY_REQUEST_IN_PROGRESS', async () => {
    let release: (value: typeof created) => void = () => undefined;
    creator.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );

    const payload = validPayload();
    // `.end()` starts the request immediately so the duplicate below races it.
    const first = new Promise<request.Response>((resolve, reject) => {
      request(app)
        .post('/api/markets')
        .set('Idempotency-Key', 'inflight')
        .send(payload)
        .end((err, res) => (err ? reject(err) : resolve(res)));
    });

    // Give the first request time to reach the creator before the duplicate.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const duplicate = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'inflight')
      .send(payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');

    release(created);
    const firstRes = await first;
    expect(firstRes.status).toBe(201);
  });

  it('does not burn the key on server errors, so a retry can succeed', async () => {
    creator.mockRejectedValueOnce(new Error('chain unavailable'));
    // Terminal error handler mirroring app.ts.
    app = (() => {
      const a = express();
      a.use(express.json());
      a.use(
        '/api/markets',
        createMarketsRouter(new InMemoryMarketSource(), creator, {
          idempotencyStore: store,
        })
      );
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      a.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
      });
      return a;
    })();

    const payload = validPayload();
    const failed = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-after-500')
      .send(payload);
    expect(failed.status).toBe(500);

    const retried = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'retry-after-500')
      .send(payload);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotency-replayed']).toBeUndefined();
    expect(creator).toHaveBeenCalledTimes(2);
  });

  it('leaves requests without a header unaffected', async () => {
    const payload = validPayload();
    const a = await request(app).post('/api/markets').send(payload);
    const b = await request(app).post('/api/markets').send(payload);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.headers['idempotency-replayed']).toBeUndefined();
    expect(creator).toHaveBeenCalledTimes(2);
  });

  it('rejects an over-long key with 400 IDEMPOTENCY_KEY_INVALID', async () => {
    const res = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'k'.repeat(256))
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(creator).not.toHaveBeenCalled();
  });

  it('replays stored 4xx validation results without re-running the handler', async () => {
    const first = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'invalid-replay')
      .send({ title: '', outcomes: [], closeTime: 0 });
    expect(first.status).toBe(400);

    const replay = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'invalid-replay')
      .send({ title: '', outcomes: [], closeTime: 0 });
    expect(replay.status).toBe(400);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('expires stored results after the TTL window', async () => {
    const shortLived = new IdempotencyStore(50);
    app = (() => {
      const a = express();
      a.use(express.json());
      a.use(
        '/api/markets',
        createMarketsRouter(new InMemoryMarketSource(), creator, {
          idempotencyStore: shortLived,
        })
      );
      return a;
    })();

    const payload = validPayload();
    await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'ttl')
      .send(payload);

    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterExpiry = await request(app)
      .post('/api/markets')
      .set('Idempotency-Key', 'ttl')
      .send(payload);
    expect(afterExpiry.headers['idempotency-replayed']).toBeUndefined();
    expect(creator).toHaveBeenCalledTimes(2);
  });
});

describe('IdempotencyStore unit behaviour', () => {
  it('releases in-flight claims on demand', () => {
    const s = new IdempotencyStore();
    expect(s.begin('c', 'k', 'h')).toBe('started');
    expect(s.begin('c', 'k', 'h')).toBe('in-flight');
    s.release('c', 'k');
    expect(s.begin('c', 'k', 'h')).toBe('started');
  });

  it('completes and replays results within the TTL', () => {
    const s = new IdempotencyStore();
    expect(s.begin('c', 'k', 'h')).toBe('started');
    s.complete('c', 'k', 'h', 201, { ok: true });
    const stored = s.get('c', 'k');
    expect(stored).toMatchObject({ status: 201, body: { ok: true } });
    expect(s.begin('c', 'k', 'other')).toBe('conflict');
  });

  it('reset clears stored and in-flight entries', () => {
    const s = new IdempotencyStore();
    s.begin('c', 'k', 'h');
    s.release('c', 'k');
    s.begin('c', 'k', 'h');
    s.complete('c', 'k', 'h', 201, {});
    s.reset();
    expect(s.get('c', 'k')).toBeUndefined();
  });
});
