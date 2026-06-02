import { TOKEN_SYMBOL, unitsToStroops } from './formatting';
import type {
  MarketFilters,
  MarketStatusFilter,
  ProcessedMarket,
  SortOption,
  TimeRangeFilter,
} from './market-types';

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  search: '',
  status: 'all',
  asset: 'all',
  minVolume: '',
  maxVolume: '',
  timeRange: 'all',
  sortBy: 'newest',
};

const STATUS_VALUES = new Set<MarketStatusFilter>(['all', 'open', 'settled', 'disputed']);
const SORT_VALUES = new Set<SortOption>(['newest', 'ending-soon', 'volume', 'participants']);
const TIME_RANGE_VALUES = new Set<TimeRangeFilter>([
  'all',
  'ending-24h',
  'ending-7d',
  'created-7d',
  'created-30d',
]);

const BLOCKS_PER_DAY = 144;
const SECONDS_PER_DAY = 86_400;

export function normalizeAssetType(asset?: string): string {
  const normalized = asset?.trim();
  return normalized ? normalized.toUpperCase() : TOKEN_SYMBOL.toUpperCase();
}

function normalizeNumberInput(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeStatus(value: string | null): MarketStatusFilter {
  return STATUS_VALUES.has(value as MarketStatusFilter) ? (value as MarketStatusFilter) : DEFAULT_MARKET_FILTERS.status;
}

function normalizeSort(value: string | null): SortOption {
  return SORT_VALUES.has(value as SortOption) ? (value as SortOption) : DEFAULT_MARKET_FILTERS.sortBy;
}

function normalizeTimeRange(value: string | null): TimeRangeFilter {
  return TIME_RANGE_VALUES.has(value as TimeRangeFilter)
    ? (value as TimeRangeFilter)
    : DEFAULT_MARKET_FILTERS.timeRange;
}

export function normalizeMarketFilters(filters: Partial<MarketFilters>): MarketFilters {
  return {
    search: filters.search?.trim() ?? DEFAULT_MARKET_FILTERS.search,
    status: normalizeStatus(filters.status ?? null),
    asset: filters.asset?.trim() || DEFAULT_MARKET_FILTERS.asset,
    minVolume: filters.minVolume?.trim() ?? DEFAULT_MARKET_FILTERS.minVolume,
    maxVolume: filters.maxVolume?.trim() ?? DEFAULT_MARKET_FILTERS.maxVolume,
    timeRange: normalizeTimeRange(filters.timeRange ?? null),
    sortBy: normalizeSort(filters.sortBy ?? null),
  };
}

export function parseMarketFiltersFromParams(params: URLSearchParams): MarketFilters {
  return {
    search: params.get('q') ?? '',
    status: normalizeStatus(params.get('status')),
    asset: params.get('asset') ?? DEFAULT_MARKET_FILTERS.asset,
    minVolume: params.get('minVolume') ?? '',
    maxVolume: params.get('maxVolume') ?? '',
    timeRange: normalizeTimeRange(params.get('timeRange')),
    sortBy: normalizeSort(params.get('sort')),
  };
}

export function marketFiltersToParams(filters: MarketFilters): URLSearchParams {
  const normalized = normalizeMarketFilters(filters);
  const params = new URLSearchParams();

  if (normalized.search) params.set('q', normalized.search);
  if (normalized.status !== DEFAULT_MARKET_FILTERS.status) params.set('status', normalized.status);
  if (normalized.asset !== DEFAULT_MARKET_FILTERS.asset) params.set('asset', normalized.asset);
  if (normalized.minVolume) params.set('minVolume', normalized.minVolume);
  if (normalized.maxVolume) params.set('maxVolume', normalized.maxVolume);
  if (normalized.timeRange !== DEFAULT_MARKET_FILTERS.timeRange) params.set('timeRange', normalized.timeRange);
  if (normalized.sortBy !== DEFAULT_MARKET_FILTERS.sortBy) params.set('sort', normalized.sortBy);

  return params;
}

export function hasActiveMarketFilters(filters: MarketFilters): boolean {
  return marketFiltersToParams(filters).toString().length > 0;
}

export function getMarketAssetOptions(markets: ProcessedMarket[]): string[] {
  const assets = new Set<string>();
  markets.forEach((market) => assets.add(normalizeAssetType(market.assetType)));
  return [...assets].sort();
}

function matchesStatus(market: ProcessedMarket, status: MarketStatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'open') return market.status === 'active';
  if (status === 'settled') return market.status === 'settled';
  return market.disputed === true;
}

function matchesTimeRange(market: ProcessedMarket, timeRange: TimeRangeFilter, nowSeconds: number): boolean {
  if (timeRange === 'all') return true;

  if (timeRange === 'ending-24h') {
    return market.status === 'active' && market.timeRemaining !== null && market.timeRemaining <= BLOCKS_PER_DAY;
  }

  if (timeRange === 'ending-7d') {
    return market.status === 'active' && market.timeRemaining !== null && market.timeRemaining <= BLOCKS_PER_DAY * 7;
  }

  if (market.createdAt < 1_000_000_000) return true;

  const maxAgeSeconds = timeRange === 'created-7d' ? SECONDS_PER_DAY * 7 : SECONDS_PER_DAY * 30;
  return nowSeconds - market.createdAt <= maxAgeSeconds;
}

export function filterAndSortMarkets(
  markets: ProcessedMarket[],
  filters: MarketFilters,
  nowSeconds = Math.floor(Date.now() / 1000),
): ProcessedMarket[] {
  const normalized = normalizeMarketFilters(filters);
  const query = normalized.search.toLowerCase();
  const minVolume = normalizeNumberInput(normalized.minVolume);
  const maxVolume = normalizeNumberInput(normalized.maxVolume);
  const minVolumeStroops = minVolume === null ? null : unitsToStroops(BigInt(Math.round(minVolume)));
  const maxVolumeStroops = maxVolume === null ? null : unitsToStroops(BigInt(Math.round(maxVolume)));
  const selectedAsset = normalized.asset.toLowerCase();

  const filtered = markets.filter((market) => {
    if (query) {
      const searchableText = [
        market.title,
        market.description,
        market.outcomeA,
        market.outcomeB,
        market.creator,
        String(market.poolId),
        normalizeAssetType(market.assetType),
      ]
        .join(' ')
        .toLowerCase();
      if (!searchableText.includes(query)) return false;
    }

    if (!matchesStatus(market, normalized.status)) return false;

    if (selectedAsset !== 'all' && normalizeAssetType(market.assetType).toLowerCase() !== selectedAsset) {
      return false;
    }

    if (minVolumeStroops !== null && market.totalVolume < minVolumeStroops) return false;
    if (maxVolumeStroops !== null && market.totalVolume > maxVolumeStroops) return false;

    return matchesTimeRange(market, normalized.timeRange, nowSeconds);
  });

  const sorted = [...filtered];
  switch (normalized.sortBy) {
    case 'volume':
      sorted.sort((a, b) => b.totalVolume - a.totalVolume || b.createdAt - a.createdAt);
      break;
    case 'participants':
      sorted.sort(
        (a, b) =>
          (b.participantCount ?? 0) - (a.participantCount ?? 0) ||
          b.totalVolume - a.totalVolume ||
          b.createdAt - a.createdAt,
      );
      break;
    case 'ending-soon':
      sorted.sort((a, b) => {
        const aActive = a.status === 'active' && a.timeRemaining !== null;
        const bActive = b.status === 'active' && b.timeRemaining !== null;
        if (aActive && !bActive) return -1;
        if (bActive && !aActive) return 1;
        if (aActive && bActive) return (a.timeRemaining ?? Infinity) - (b.timeRemaining ?? Infinity);
        return b.createdAt - a.createdAt;
      });
      break;
    case 'newest':
      sorted.sort((a, b) => b.createdAt - a.createdAt || b.poolId - a.poolId);
      break;
  }

  return sorted;
}
