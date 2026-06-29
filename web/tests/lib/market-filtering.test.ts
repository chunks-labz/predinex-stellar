import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKET_FILTERS,
  filterAndSortMarkets,
  hasActiveMarketFilters,
  marketFiltersToParams,
  parseMarketFiltersFromParams,
} from '../../app/lib/market-filtering';
import type { MarketFilters, ProcessedMarket } from '../../app/lib/market-types';

function market(overrides: Partial<ProcessedMarket>): ProcessedMarket {
  return {
    poolId: 1,
    title: 'Will BTC close above 100k?',
    description: 'Crypto price prediction',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalVolume: 1_000_000,
    oddsA: 50,
    oddsB: 50,
    status: 'active',
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

const baseFilters: MarketFilters = { ...DEFAULT_MARKET_FILTERS };

describe('market filtering', () => {
  it('combines search, status, asset, volume, and time range filters', () => {
    const markets = [
      market({ poolId: 1, title: 'BTC election pool', totalVolume: 3_000_000, timeRemaining: 50 }),
      market({ poolId: 2, title: 'ETH election pool', totalVolume: 500_000, timeRemaining: 50 }),
      market({ poolId: 3, title: 'BTC settled pool', status: 'settled', totalVolume: 5_000_000 }),
      market({ poolId: 4, title: 'BTC USD pool', assetType: 'USD', totalVolume: 5_000_000 }),
    ];

    const result = filterAndSortMarkets(markets, {
      ...baseFilters,
      search: 'btc',
      status: 'open',
      asset: 'XLM',
      minVolume: '2',
      maxVolume: '4',
      timeRange: 'ending-24h',
    });

    expect(result.map((item) => item.poolId)).toEqual([1]);
  });

  it('shows no results for unmatched search terms', () => {
    const result = filterAndSortMarkets([market({ title: 'Solar weather pool' })], {
      ...baseFilters,
      search: 'not-present',
    });

    expect(result).toEqual([]);
  });

  it('sorts by newest, ending soon, highest volume, and most participants', () => {
    const markets = [
      market({ poolId: 1, createdAt: 10, timeRemaining: 30, totalVolume: 2_000_000, participantCount: 2 }),
      market({ poolId: 2, createdAt: 30, timeRemaining: 10, totalVolume: 1_000_000, participantCount: 5 }),
      market({ poolId: 3, createdAt: 20, timeRemaining: 20, totalVolume: 4_000_000, participantCount: 1 }),
    ];

    expect(filterAndSortMarkets(markets, { ...baseFilters, sortBy: 'newest' }).map((item) => item.poolId)).toEqual([
      2,
      3,
      1,
    ]);
    expect(
      filterAndSortMarkets(markets, { ...baseFilters, sortBy: 'ending-soon' }).map((item) => item.poolId),
    ).toEqual([2, 3, 1]);
    expect(filterAndSortMarkets(markets, { ...baseFilters, sortBy: 'volume' }).map((item) => item.poolId)).toEqual([
      3,
      1,
      2,
    ]);
    expect(
      filterAndSortMarkets(markets, { ...baseFilters, sortBy: 'participants' }).map((item) => item.poolId),
    ).toEqual([2, 1, 3]);
  });

  it('restores filters from URL params and omits defaults when serializing', () => {
    const params = new URLSearchParams(
      'q=btc&status=open&asset=XLM&minVolume=10&maxVolume=100&timeRange=ending-7d&sort=volume',
    );

    const parsed = parseMarketFiltersFromParams(params);
    expect(parsed).toEqual({
      search: 'btc',
      status: 'open',
      asset: 'XLM',
      minVolume: '10',
      maxVolume: '100',
      timeRange: 'ending-7d',
      sortBy: 'volume',
    });
    expect(marketFiltersToParams(parsed).toString()).toBe(
      'q=btc&status=open&asset=XLM&minVolume=10&maxVolume=100&timeRange=ending-7d&sort=volume',
    );
  });

  it('reset/default filters produce clean URLs', () => {
    expect(hasActiveMarketFilters(DEFAULT_MARKET_FILTERS)).toBe(false);
    expect(marketFiltersToParams(DEFAULT_MARKET_FILTERS).toString()).toBe('');
  });
});
