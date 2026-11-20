import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  CreateMarketRequest,
  MAX_CLOSE_DELAY_SECS,
  MAX_OUTCOME_COUNT,
  MAX_OUTCOME_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_CLOSE_DELAY_SECS,
  validateCreateMarket,
} from '../src/services/market-validation.js';
import { createMarketsRouter, InMemoryMarketSource } from '../src/routes/markets.js';
import { sharedRateLimiter } from '../src/middleware/rate-limit.js';

const NOW = 1_700_000_000;

function valid(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Will it rain tomorrow?',
    outcomes: ['Yes', 'No'],
    closeTime: NOW + 3_600,
    ...overrides,
  };
}

function fieldsOf(body: unknown): string[] {
  const result = validateCreateMarket(body, NOW);
  return result.ok ? [] : result.errors.map((e) => e.field);
}

describe('validateCreateMarket (Issue #1434)', () => {
  it('passes a valid payload through unchanged', () => {
    const payload = valid();
    const result = validateCreateMarket(payload, NOW);
    expect(result).toEqual({ ok: true, value: payload });
  });

  it('rejects a missing or non-object body on every field', () => {
    expect(fieldsOf(undefined).sort()).toEqual(['closeTime', 'outcomes', 'title']);
    expect(fieldsOf('nope').sort()).toEqual(['closeTime', 'outcomes', 'title']);
  });

  describe('title', () => {
    it('rejects an empty or whitespace-only title', () => {
      expect(fieldsOf(valid({ title: '' }))).toEqual(['title']);
      expect(fieldsOf(valid({ title: '   ' }))).toEqual(['title']);
    });

    it('rejects a non-string title', () => {
      expect(fieldsOf(valid({ title: 42 }))).toEqual(['title']);
    });

    it('accepts the maximum length and rejects one byte more', () => {
      expect(fieldsOf(valid({ title: 'a'.repeat(MAX_TITLE_LENGTH) }))).toEqual([]);
      expect(fieldsOf(valid({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) }))).toEqual(['title']);
    });

    it('measures length in bytes, matching the contract', () => {
      // 51 two-byte characters = 102 bytes
      expect(fieldsOf(valid({ title: 'é'.repeat(51) }))).toEqual(['title']);
    });
  });

  describe('outcomes', () => {
    it('rejects a non-array', () => {
      expect(fieldsOf(valid({ outcomes: 'Yes,No' }))).toEqual(['outcomes']);
    });

    it('rejects fewer than the minimum outcomes', () => {
      expect(fieldsOf(valid({ outcomes: ['Yes'] }))).toEqual(['outcomes']);
    });

    it('accepts the maximum outcome count and rejects one more', () => {
      const make = (n: number) => Array.from({ length: n }, (_, i) => `O${i}`);
      expect(fieldsOf(valid({ outcomes: make(MAX_OUTCOME_COUNT) }))).toEqual([]);
      expect(fieldsOf(valid({ outcomes: make(MAX_OUTCOME_COUNT + 1) }))).toEqual(['outcomes']);
    });

    it('reports the index of an empty or non-string outcome', () => {
      expect(fieldsOf(valid({ outcomes: ['Yes', ''] }))).toEqual(['outcomes[1]']);
      expect(fieldsOf(valid({ outcomes: [1, 'No'] }))).toEqual(['outcomes[0]']);
    });

    it('reports the index of an over-long outcome', () => {
      const outcomes = ['Yes', 'x'.repeat(MAX_OUTCOME_LENGTH + 1)];
      expect(fieldsOf(valid({ outcomes }))).toEqual(['outcomes[1]']);
    });

    it('reports the index of a duplicate outcome', () => {
      expect(fieldsOf(valid({ outcomes: ['Yes', 'No', 'Yes'] }))).toEqual(['outcomes[2]']);
    });
  });

  describe('closeTime', () => {
    it('rejects a non-integer or non-number closeTime', () => {
      expect(fieldsOf(valid({ closeTime: NOW + 3_600.5 }))).toEqual(['closeTime']);
      expect(fieldsOf(valid({ closeTime: String(NOW + 3_600) }))).toEqual(['closeTime']);
    });

    it('rejects a closeTime in the past', () => {
      expect(fieldsOf(valid({ closeTime: NOW - 1 }))).toEqual(['closeTime']);
    });

    it('enforces the minimum delay boundary', () => {
      expect(fieldsOf(valid({ closeTime: NOW + MIN_CLOSE_DELAY_SECS - 1 }))).toEqual(['closeTime']);
      expect(fieldsOf(valid({ closeTime: NOW + MIN_CLOSE_DELAY_SECS }))).toEqual([]);
    });

    it('enforces the maximum delay boundary', () => {
      expect(fieldsOf(valid({ closeTime: NOW + MAX_CLOSE_DELAY_SECS }))).toEqual([]);
      expect(fieldsOf(valid({ closeTime: NOW + MAX_CLOSE_DELAY_SECS + 1 }))).toEqual(['closeTime']);
    });
  });

  it('reports every violated field at once', () => {
    expect(fieldsOf({ title: '', outcomes: ['Yes'], closeTime: 0 }).sort()).toEqual([
      'closeTime',
      'outcomes',
      'title',
    ]);
  });
});

describe('POST /api/markets (Issue #1434)', () => {
  const created = {
    id: 1,
    title: 'Will it rain tomorrow?',
    outcomes: ['Yes', 'No'],
    status: 'open' as const,
    expiry: 0,
    totalVolume: '0',
  };
  let received: CreateMarketRequest[];
  let app: express.Express;

  function buildApp(withCreator: boolean) {
    const a = express();
    a.use(express.json());
    a.use(
      '/api/markets',
      createMarketsRouter(
        new InMemoryMarketSource(),
        withCreator
          ? async (req) => {
              received.push(req);
              return created;
            }
          : undefined
      )
    );
    return a;
  }

  beforeEach(() => {
    sharedRateLimiter.reset();
    received = [];
    app = buildApp(true);
  });

  it('rejects invalid payloads with a 400 and field-level details', async () => {
    const res = await request(app)
      .post('/api/markets')
      .send({ title: '', outcomes: ['Yes'], closeTime: 1 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual([
      'closeTime',
      'outcomes',
      'title',
    ]);
    expect(received).toHaveLength(0);
  });

  it('passes a valid payload to the creator unchanged', async () => {
    const payload = valid({ closeTime: Math.floor(Date.now() / 1000) + 3_600 });
    const res = await request(app).post('/api/markets').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(created);
    expect(received).toEqual([payload]);
  });

  it('returns 501 for a valid payload when no creator is configured', async () => {
    const res = await request(buildApp(false))
      .post('/api/markets')
      .send(valid({ closeTime: Math.floor(Date.now() / 1000) + 3_600 }));

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
