/**
 * #1664 — failed on-chain market creation is recorded with non-sensitive
 * metadata, repeated failures raise one alert, and admins can read the state.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createMarketsRouter, InMemoryMarketSource, MarketCreator } from '../src/routes/markets.js';
import { MarketCreationMonitor } from '../src/services/market-creation-monitor.js';
import { sharedRateLimiter, strictRateLimiter } from '../src/middleware/rate-limit.js';
import { sharedAuthValidator } from '../src/middleware/auth.js';
import { runWithCorrelation } from '../src/lib/correlation.js';

const ADMIN_KEY = 'test-admin-key-creation-monitor';
const USER_KEY = 'test-user-key-creation-monitor';
const SECRET_SEED = 'SDXVZ5ZQ4KCZDUYZFNNB3JGNUZDWXQXIMLHYFNBJ3SCLBXUZCWLQ7UPN';
const NOW_MS = Date.UTC(2026, 10, 23, 12, 0, 0);

const request1 = { title: 'Will it rain in Lagos tomorrow?', outcomes: ['Yes', 'No'], closeTime: NOW_MS / 1000 + 3600 };

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const write = (chunk: unknown) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line));
    }
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(write as never);
  return lines;
}

describe('MarketCreationMonitor', () => {
  let clock: number;
  let monitor: MarketCreationMonitor;
  let logs: Record<string, unknown>[];

  beforeEach(() => {
    clock = NOW_MS;
    monitor = new MarketCreationMonitor({ threshold: 3, windowMs: 60_000, now: () => clock });
    logs = captureLogs();
  });
  afterEach(() => vi.restoreAllMocks());

  it('records only non-sensitive metadata', () => {
    const err = new Error(
      `HostError: Error(Contract, #12) while invoking create_market signed by ${SECRET_SEED} with xdr AAAAAgAAAAD...`
    );
    const failure = runWithCorrelation({ correlationId: 'corr-123', requestId: 'req-1' } as never, () =>
      monitor.recordFailure(request1, err)
    );

    expect(failure).toEqual({
      at: new Date(NOW_MS).toISOString(),
      correlationId: 'corr-123',
      category: 'contract',
      errorName: 'Error',
      contractErrorCode: 12,
      outcomeCount: 2,
      titleBytes: Buffer.byteLength(request1.title),
      secondsToClose: 3600,
    });
    const serialized = JSON.stringify({ failure, logs });
    expect(serialized).not.toContain(SECRET_SEED);
    expect(serialized).not.toContain('AAAAAgAAAAD');
    expect(serialized).not.toContain(request1.title);
    expect(logs.find((l) => l.msg === 'market_creation_failed')).toMatchObject({
      level: 'warn',
      category: 'contract',
      contractErrorCode: 12,
    });
  });

  it.each([
    [Object.assign(new Error('request timed out'), { name: 'TimeoutError' }), 'timeout'],
    [new Error('connect ECONNREFUSED 10.0.0.1:443'), 'network'],
    [new Error('transaction rejected: tx_failed'), 'rejected'],
    [new Error('something odd'), 'unknown'],
    ['a thrown string', 'unknown'],
  ])('classifies %s as %s', (err, category) => {
    expect(monitor.recordFailure(request1, err).category).toBe(category);
  });

  it('alerts once when failures reach the threshold within the window', () => {
    monitor.recordFailure(request1, new Error('x'));
    clock += 10_000;
    monitor.recordFailure(request1, new Error('x'));
    expect(logs.filter((l) => l.msg === 'market_creation_failure_alert')).toHaveLength(0);

    clock += 10_000;
    monitor.recordFailure(request1, new Error('Error(Contract, #3)'));
    clock += 10_000;
    monitor.recordFailure(request1, new Error('x'));

    const alerts = logs.filter((l) => l.msg === 'market_creation_failure_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'error',
      alert: 'market_creation_failures',
      failuresInWindow: 3,
      threshold: 3,
      windowSeconds: 60,
      categories: { unknown: 2, contract: 1 },
      runbook: 'docs/MARKET_CREATION_MONITORING.md',
    });
    expect(monitor.stats()).toMatchObject({ alerting: true, recentFailures: 4, totalFailures: 4 });
  });

  it('does not alert on failures spread out wider than the window', () => {
    for (let i = 0; i < 6; i++) {
      monitor.recordFailure(request1, new Error('x'));
      clock += 31_000;
    }
    expect(logs.filter((l) => l.msg === 'market_creation_failure_alert')).toHaveLength(0);
    expect(monitor.stats().alerting).toBe(false);
  });

  it('re-arms after a full window without failures', () => {
    for (let i = 0; i < 3; i++) monitor.recordFailure(request1, new Error('x'));
    clock += 60_000;
    expect(monitor.stats()).toMatchObject({ alerting: false, recentFailures: 0 });
    for (let i = 0; i < 3; i++) monitor.recordFailure(request1, new Error('x'));
    expect(logs.filter((l) => l.msg === 'market_creation_failure_alert')).toHaveLength(2);
  });

  it('keeps a bounded, newest-first list of recent failures', () => {
    const small = new MarketCreationMonitor({ threshold: 100, windowMs: 60_000, maxRecent: 2, now: () => clock });
    for (const n of [1, 2, 3]) small.recordFailure({ ...request1, outcomes: Array(n + 1).fill('o') }, new Error('x'));
    expect(small.stats().recent.map((f) => f.outcomeCount)).toEqual([4, 3]);
    expect(small.stats().totalFailures).toBe(3);
  });

  it('reads the threshold and window from the environment', () => {
    vi.stubEnv('MARKET_CREATION_FAILURE_ALERT_THRESHOLD', '7');
    vi.stubEnv('MARKET_CREATION_FAILURE_WINDOW_SECONDS', '120');
    try {
      expect(new MarketCreationMonitor().stats()).toMatchObject({ threshold: 7, windowSeconds: 120 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to defaults for invalid environment values', () => {
    vi.stubEnv('MARKET_CREATION_FAILURE_ALERT_THRESHOLD', '-3');
    vi.stubEnv('MARKET_CREATION_FAILURE_WINDOW_SECONDS', 'soon');
    try {
      expect(new MarketCreationMonitor().stats()).toMatchObject({ threshold: 5, windowSeconds: 900 });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('POST /api/markets failure monitoring', () => {
  let monitor: MarketCreationMonitor;
  let app: express.Express;

  beforeAll(() => {
    sharedAuthValidator.registerKey(ADMIN_KEY, 'Admin');
    sharedAuthValidator.registerKey(USER_KEY, 'User');
  });

  function makeApp(creator: MarketCreator) {
    monitor = new MarketCreationMonitor({ threshold: 2, windowMs: 60_000 });
    app = express();
    app.use(express.json());
    app.use('/api/markets', createMarketsRouter(new InMemoryMarketSource([]), creator, { creationMonitor: monitor }));
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(502).json({ success: false });
    });
  }

  beforeEach(() => {
    sharedRateLimiter.reset();
    strictRateLimiter.reset();
    captureLogs();
  });
  afterEach(() => vi.restoreAllMocks());

  const body = () => ({ ...request1, closeTime: Math.floor(Date.now() / 1000) + 3600 });

  it('records a failed submission and still returns the error', async () => {
    makeApp(async () => {
      throw new Error(`Error(Contract, #4) signer ${SECRET_SEED}`);
    });
    const res = await request(app).post('/api/markets').send(body());
    expect(res.status).toBe(502);

    const stats = monitor.stats();
    expect(stats.totalFailures).toBe(1);
    expect(stats.recent[0]).toMatchObject({ category: 'contract', contractErrorCode: 4, outcomeCount: 2 });
  });

  it('does not record validation errors or successful creations', async () => {
    makeApp(async (req) => ({ id: 1, title: req.title, outcomes: req.outcomes, status: 'open', expiry: req.closeTime, totalVolume: '0' }));
    await request(app).post('/api/markets').send({ title: '', outcomes: ['Yes'], closeTime: 1 });
    strictRateLimiter.reset();
    await request(app).post('/api/markets').send(body());
    expect(monitor.stats().totalFailures).toBe(0);
  });

  it('serves the failure stats to admins only, without secrets', async () => {
    makeApp(async () => {
      throw new Error(`boom ${SECRET_SEED}`);
    });
    for (let i = 0; i < 2; i++) {
      strictRateLimiter.reset();
      await request(app).post('/api/markets').send(body());
    }

    const forbidden = await request(app).get('/api/markets/admin/creation-failures').set('x-api-key', USER_KEY);
    expect(forbidden.status).toBe(403);

    sharedRateLimiter.reset();
    const res = await request(app).get('/api/markets/admin/creation-failures').set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ threshold: 2, recentFailures: 2, totalFailures: 2, alerting: true });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_SEED);
  });
});
