import { describe, expect, it } from 'vitest';
import {
  countPoolsByStatus,
  derivePoolStatus,
  filterPools,
  hasActivePoolFilters,
  parsePoolFiltersFromParams,
  poolFiltersToParams,
  type PoolLike,
} from '../../app/lib/pool-list-filtering';
import type { ProcessedMarket } from '../../app/lib/market-types';

function pool(overrides: Partial<PoolLike>): PoolLike {
  return {
    poolId: 1,
    title: 'Will BTC close above 100k?',
    description: 'Crypto price prediction',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalVolume: 1_000_000,
    oddsA: 50,
    oddsB: 50,
    status: 'active' as ProcessedMarket['status'],
    timeRemaining: 20,
    createdAt: 1_800_000_000,
    settledAt: null,
    creator: 'GABC',
    participantCount: 2,
    assetType: 'XLM',
    disputed: false,
    ...overrides,
  };
}

describe('derivePoolStatus', () => {
  it('maps settled to resolved and past-expiry to expired', () => {
    expect(derivePoolStatus(pool({ status: 'settled' }))).toBe('resolved');
    expect(derivePoolStatus(pool({ status: 'expired' }))).toBe('expired');
    expect(derivePoolStatus(pool({ status: 'active' }))).toBe('active');
  });

  it('treats the cancelled flag as highest precedence', () => {
    expect(derivePoolStatus(pool({ status: 'expired', cancelled: true }))).toBe('cancelled');
  });
});

describe('filterPools', () => {
  const pools = [
    pool({ poolId: 1, title: 'BTC election pool', status: 'active', createdAt: 30 }),
    pool({ poolId: 2, title: 'ETH staking pool', description: 'btc hedge', status: 'settled', createdAt: 20 }),
    pool({ poolId: 3, title: 'Cancelled BTC pool', cancelled: true, createdAt: 10 }),
    pool({ poolId: 4, title: 'Old BTC pool', status: 'expired', createdAt: 40 }),
  ];

  it('filters by status', () => {
    expect(filterPools(pools, { search: '', status: 'resolved' }).map((p) => p.poolId)).toEqual([2]);
    expect(filterPools(pools, { search: '', status: 'cancelled' }).map((p) => p.poolId)).toEqual([3]);
    expect(filterPools(pools, { search: '', status: 'active' }).map((p) => p.poolId)).toEqual([1]);
  });

  it('searches across title and description, case-insensitively', () => {
    // pool 2 matches on description ("btc hedge"), others on title.
    const ids = filterPools(pools, { search: 'BTC', status: 'all' }).map((p) => p.poolId);
    expect(ids).toEqual([4, 1, 2, 3]); // newest-first by createdAt (40, 30, 20, 10)
  });

  it('combines status and search', () => {
    expect(
      filterPools(pools, { search: 'btc', status: 'expired' }).map((p) => p.poolId),
    ).toEqual([4]);
  });

  it('returns newest pools first', () => {
    expect(filterPools(pools, { search: '', status: 'all' }).map((p) => p.poolId)).toEqual([
      4, 1, 2, 3,
    ]);
  });
});

describe('countPoolsByStatus', () => {
  it('tallies each status and the total', () => {
    const counts = countPoolsByStatus([
      pool({ status: 'active' }),
      pool({ status: 'settled' }),
      pool({ status: 'expired' }),
      pool({ cancelled: true }),
    ]);
    expect(counts).toEqual({ all: 4, active: 1, resolved: 1, expired: 1, cancelled: 1 });
  });
});

describe('URL query param round-trip', () => {
  it('parses status and q params', () => {
    const filters = parsePoolFiltersFromParams(new URLSearchParams('status=resolved&q=btc'));
    expect(filters).toEqual({ search: 'btc', status: 'resolved' });
  });

  it('ignores unknown status values', () => {
    const filters = parsePoolFiltersFromParams(new URLSearchParams('status=bogus'));
    expect(filters.status).toBe('all');
  });

  it('serialises non-default filters and omits defaults', () => {
    expect(poolFiltersToParams({ search: 'btc', status: 'active' }).toString()).toBe(
      'q=btc&status=active',
    );
    expect(poolFiltersToParams({ search: '', status: 'all' }).toString()).toBe('');
  });

  it('reports whether any filter is active', () => {
    expect(hasActivePoolFilters({ search: '', status: 'all' })).toBe(false);
    expect(hasActivePoolFilters({ search: 'x', status: 'all' })).toBe(true);
    expect(hasActivePoolFilters({ search: '', status: 'expired' })).toBe(true);
  });
});
