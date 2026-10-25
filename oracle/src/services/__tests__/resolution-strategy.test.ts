import { describe, it, expect, vi } from 'vitest';
import {
  MarketResolver,
  OracleReport,
  ResolutionEvent,
  ResolutionSource,
} from '../resolution-strategy';

const NOW = 1_700_000_000;
const MARKET = 7;

function source(name: string, impl: (marketId: number) => Promise<OracleReport | null>): ResolutionSource {
  return { name, fetchOutcome: vi.fn(impl) };
}

function fresh(outcome: number, ageSecs = 10, marketId = MARKET): OracleReport {
  return { marketId, outcome, observedAt: NOW - ageSecs };
}

function setup(
  primary?: ResolutionSource,
  secondary?: ResolutionSource,
  admins: string[] = ['admin-1']
) {
  const events: ResolutionEvent[] = [];
  const resolver = new MarketResolver({
    primary,
    secondary,
    authorizedAdmins: admins,
    policy: { maxReportAgeSecs: 600, maxFutureSkewSecs: 30, sourceTimeoutMs: 50 },
    onEvent: (e) => events.push(e),
  });
  return { resolver, events };
}

describe('MarketResolver primary path', () => {
  it('uses a fresh primary report and does not query the secondary', async () => {
    const secondary = source('backup', async () => fresh(0));
    const { resolver, events } = setup(source('chainlink', async () => fresh(1)), secondary);

    const result = await resolver.resolve(MARKET, NOW);

    expect(result).toMatchObject({ resolved: true, outcome: 1, path: 'primary' });
    expect(secondary.fetchOutcome).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'market_resolved',
      marketId: MARKET,
      path: 'primary',
      outcome: 1,
      resolvedBy: 'chainlink',
      observedAt: NOW - 10,
      resolvedAt: NOW,
      rejections: [],
    });
  });

  it('accepts a report within the allowed future clock skew', async () => {
    const { resolver } = setup(source('p', async () => fresh(0, -20)));
    await expect(resolver.resolve(MARKET, NOW)).resolves.toMatchObject({ resolved: true, path: 'primary' });
  });
});

describe('MarketResolver fallback to secondary', () => {
  it.each([
    ['unavailable', async () => { throw new Error('connection refused'); }],
    ['stale', async () => fresh(1, 601)],
    ['no_report', async () => null],
    ['invalid_outcome', async () => fresh(2)],
    ['invalid_outcome', async () => fresh(-1)],
    ['invalid_outcome', async () => ({ marketId: MARKET, outcome: 0.5, observedAt: NOW })],
    ['future_timestamp', async () => fresh(1, -31)],
    ['market_mismatch', async () => fresh(1, 10, MARKET + 1)],
    ['stale', async () => ({ marketId: MARKET, outcome: 1, observedAt: Number.NaN })],
  ] as const)('falls back when the primary is %s', async (reason, impl) => {
    const { resolver, events } = setup(source('p', impl), source('s', async () => fresh(0)));

    const result = await resolver.resolve(MARKET, NOW);

    expect(result).toMatchObject({ resolved: true, outcome: 0, path: 'secondary' });
    expect(events[0].rejections).toEqual([
      expect.objectContaining({ path: 'primary', source: 'p', reason }),
    ]);
  });

  it('treats a source that throws synchronously as unavailable', async () => {
    const primary: ResolutionSource = {
      name: 'sync-throw',
      fetchOutcome: () => {
        throw new Error('boom');
      },
    };
    const { resolver } = setup(primary, source('s', async () => fresh(1)));

    const result = await resolver.resolve(MARKET, NOW);

    expect(result).toMatchObject({ resolved: true, path: 'secondary' });
    expect(result.event.rejections[0]).toMatchObject({ reason: 'unavailable', detail: 'boom' });
  });

  it('treats a primary that times out as unavailable', async () => {
    const hanging = source('slow', () => new Promise<OracleReport | null>(() => undefined));
    const { resolver } = setup(hanging, source('s', async () => fresh(1)));

    const result = await resolver.resolve(MARKET, NOW);

    expect(result).toMatchObject({ resolved: true, path: 'secondary' });
    expect(result.event.rejections[0]).toMatchObject({ reason: 'unavailable' });
  });

  it('falls back when no primary is configured', async () => {
    const { resolver } = setup(undefined, source('s', async () => fresh(1)));

    const result = await resolver.resolve(MARKET, NOW);

    expect(result).toMatchObject({ resolved: true, path: 'secondary' });
    expect(result.event.rejections[0]).toMatchObject({ reason: 'not_configured' });
  });
});

describe('MarketResolver admin override', () => {
  const stale = () => source('p', async () => fresh(1, 10_000));
  const down = () => source('s', async () => { throw new Error('503'); });

  it('applies an authorised override when both oracles fail and records it', async () => {
    const { resolver, events } = setup(stale(), down());

    const result = await resolver.resolve(MARKET, NOW, {
      adminId: 'admin-1',
      outcome: 0,
      reason: '  Both feeds down; outcome confirmed from official result  ',
    });

    expect(result).toMatchObject({ resolved: true, outcome: 0, path: 'admin_override' });
    expect(events[0]).toMatchObject({
      type: 'market_resolved',
      path: 'admin_override',
      resolvedBy: 'admin-1',
      override: { adminId: 'admin-1', reason: 'Both feeds down; outcome confirmed from official result' },
    });
    expect(events[0].rejections.map((r) => r.reason)).toEqual(['stale', 'unavailable']);
    expect(resolver.getAuditLog()).toEqual([
      {
        marketId: MARKET,
        adminId: 'admin-1',
        outcome: 0,
        reason: 'Both feeds down; outcome confirmed from official result',
        at: NOW,
        accepted: true,
      },
    ]);
  });

  it('refuses an override from an unauthorised admin and audits the attempt', async () => {
    const { resolver, events } = setup(stale(), down());

    const result = await resolver.resolve(MARKET, NOW, { adminId: 'mallory', outcome: 1, reason: 'trust me' });

    expect(result.resolved).toBe(false);
    expect(events[0]).toMatchObject({ type: 'market_resolution_failed', path: null, outcome: null });
    expect(events[0].rejections.at(-1)).toMatchObject({ path: 'admin_override', reason: 'unauthorized' });
    expect(resolver.getAuditLog()).toEqual([
      expect.objectContaining({ adminId: 'mallory', accepted: false, rejection: 'unauthorized' }),
    ]);
  });

  it('refuses an override without a reason', async () => {
    const { resolver } = setup(stale(), down());

    const result = await resolver.resolve(MARKET, NOW, { adminId: 'admin-1', outcome: 1, reason: '   ' });

    expect(result.resolved).toBe(false);
    expect(resolver.getAuditLog()[0]).toMatchObject({ accepted: false, rejection: 'missing_reason' });
  });

  it('refuses an override with an out-of-range outcome', async () => {
    const { resolver } = setup(stale(), down());

    const result = await resolver.resolve(MARKET, NOW, { adminId: 'admin-1', outcome: 5, reason: 'x' });

    expect(result.resolved).toBe(false);
    expect(resolver.getAuditLog()[0]).toMatchObject({ accepted: false, rejection: 'invalid_outcome' });
  });

  it('disables overrides when no admins are authorised', async () => {
    const { resolver } = setup(stale(), down(), []);

    const result = await resolver.resolve(MARKET, NOW, { adminId: 'admin-1', outcome: 1, reason: 'x' });

    expect(result.resolved).toBe(false);
  });

  it('does not let an override pre-empt a healthy oracle, but still audits it', async () => {
    const { resolver } = setup(source('p', async () => fresh(1)), down());

    const result = await resolver.resolve(MARKET, NOW, { adminId: 'admin-1', outcome: 0, reason: 'early' });

    expect(result).toMatchObject({ resolved: true, outcome: 1, path: 'primary' });
    expect(resolver.getAuditLog()).toEqual([
      expect.objectContaining({ adminId: 'admin-1', accepted: false, superseded: true }),
    ]);
  });

  it('reports failure with every rejection when nothing can resolve the market', async () => {
    const { resolver, events } = setup(stale(), down());

    const result = await resolver.resolve(MARKET, NOW);

    expect(result.resolved).toBe(false);
    expect(events[0].rejections.map((r) => [r.path, r.reason])).toEqual([
      ['primary', 'stale'],
      ['secondary', 'unavailable'],
      ['admin_override', 'not_provided'],
    ]);
  });
});

describe('MarketResolver configuration', () => {
  it('supports multi-outcome markets', async () => {
    const resolver = new MarketResolver({
      primary: source('p', async () => fresh(3)),
      policy: { outcomeCount: 4 },
    });
    await expect(resolver.resolve(MARKET, NOW)).resolves.toMatchObject({ resolved: true, outcome: 3 });
  });

  it('rejects an invalid outcomeCount', () => {
    expect(() => new MarketResolver({ policy: { outcomeCount: 0 } })).toThrow();
  });

  it('is not affected by a throwing event listener', async () => {
    const resolver = new MarketResolver({
      primary: source('p', async () => fresh(1)),
      onEvent: () => {
        throw new Error('listener bug');
      },
    });
    await expect(resolver.resolve(MARKET, NOW)).resolves.toMatchObject({ resolved: true });
  });
});
