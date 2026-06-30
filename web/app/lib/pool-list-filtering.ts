/**
 * Filtering helpers for the dedicated pools list page (`/pools`).
 *
 * The pools list reuses the same on-chain market data as `/markets` but
 * exposes a pool-oriented status vocabulary (Active, Resolved, Cancelled,
 * Expired) and a simple title/description keyword search. Filter state is
 * serialised to URL query params so a filtered view can be shared via link.
 *
 * These functions are intentionally pure so they can be unit-tested without a
 * DOM or network.
 */
import type { ProcessedMarket } from './market-types';

/** Lifecycle status surfaced in the pools list. */
export type PoolListStatus = 'active' | 'resolved' | 'cancelled' | 'expired';

/** Status options selectable in the filter dropdown (`all` clears the filter). */
export type PoolStatusFilter = 'all' | PoolListStatus;

/** Pool categories. */
export type PoolCategory = 'crypto' | 'sports' | 'weather' | 'economics' | 'politics' | 'other';

export interface PoolListFilters {
  /** Free-text query matched against pool title and description. */
  search: string;
  status: PoolStatusFilter;
  /** Selected categories (empty = all categories). */
  categories: PoolCategory[];
  /** Selected tags (empty = all tags). */
  tags: string[];
  /** Whether to show cross-chain mirrored pools only. */
  crossChainOnly: boolean;
}

export const DEFAULT_POOL_FILTERS: PoolListFilters = {
  search: '',
  status: 'all',
  categories: [],
  tags: [],
  crossChainOnly: false,
};

export const POOL_CATEGORIES: ReadonlyArray<{ value: PoolCategory; label: string }> = [
  { value: 'crypto', label: 'Cryptocurrency' },
  { value: 'sports', label: 'Sports' },
  { value: 'weather', label: 'Weather' },
  { value: 'economics', label: 'Economics' },
  { value: 'politics', label: 'Politics' },
  { value: 'other', label: 'Other' },
];

/** Ordered options for the status dropdown, including the `all` reset entry. */
export const POOL_STATUS_OPTIONS: ReadonlyArray<{ value: PoolStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

const STATUS_VALUES = new Set<PoolStatusFilter>([
  'all',
  'active',
  'resolved',
  'cancelled',
  'expired',
]);

/**
 * A processed market, optionally carrying a `cancelled` flag. The base
 * `ProcessedMarket` only distinguishes active/settled/expired; richer data
 * sources may additionally flag cancelled pools, which this list honours.
 */
export type PoolLike = ProcessedMarket & { cancelled?: boolean };

/**
 * Map a pool's on-chain state onto the pools-list status vocabulary.
 * Cancelled takes precedence (a cancelled pool may also appear "expired" by
 * time), then resolved (settled), then expired, otherwise active.
 */
export function derivePoolStatus(market: PoolLike): PoolListStatus {
  if (market.cancelled) return 'cancelled';
  if (market.status === 'settled') return 'resolved';
  if (market.status === 'expired') return 'expired';
  return 'active';
}

function normalizeStatus(value: string | null): PoolStatusFilter {
  return STATUS_VALUES.has(value as PoolStatusFilter)
    ? (value as PoolStatusFilter)
    : DEFAULT_POOL_FILTERS.status;
}

function normalizeCategories(value: string | null): PoolCategory[] {
  if (!value) return [];
  return value
    .split(',')
    .filter((cat): cat is PoolCategory =>
      POOL_CATEGORIES.map(c => c.value).includes(cat as PoolCategory)
    );
}

function normalizeTags(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').filter(tag => tag.trim().length > 0);
}

export function normalizePoolFilters(filters: Partial<PoolListFilters>): PoolListFilters {
  return {
    search: filters.search?.trim() ?? DEFAULT_POOL_FILTERS.search,
    status: normalizeStatus(filters.status ?? null),
    categories: filters.categories ?? DEFAULT_POOL_FILTERS.categories,
    tags: filters.tags ?? DEFAULT_POOL_FILTERS.tags,
    crossChainOnly: filters.crossChainOnly ?? DEFAULT_POOL_FILTERS.crossChainOnly,
  };
}

/** Read filter state out of URL query params (`?status=&q=&categories=&tags=&crosschain=`). */
export function parsePoolFiltersFromParams(params: URLSearchParams): PoolListFilters {
  return {
    search: params.get('q') ?? '',
    status: normalizeStatus(params.get('status')),
    categories: normalizeCategories(params.get('categories')),
    tags: normalizeTags(params.get('tags')),
    crossChainOnly: params.get('crosschain') === '1',
  };
}

/** Serialise filter state to URL query params, omitting defaults. */
export function poolFiltersToParams(filters: PoolListFilters): URLSearchParams {
  const normalized = normalizePoolFilters(filters);
  const params = new URLSearchParams();
  if (normalized.search) params.set('q', normalized.search);
  if (normalized.status !== DEFAULT_POOL_FILTERS.status) params.set('status', normalized.status);
  if (normalized.categories.length > 0) params.set('categories', normalized.categories.join(','));
  if (normalized.tags.length > 0) params.set('tags', normalized.tags.join(','));
  if (normalized.crossChainOnly) params.set('crosschain', '1');
  return params;
}

export function hasActivePoolFilters(filters: PoolListFilters): boolean {
  return poolFiltersToParams(filters).toString().length > 0;
}

/** Count how many pools fall into each status, plus the total. */
export function countPoolsByStatus(
  markets: PoolLike[],
): Record<PoolListStatus | 'all', number> {
  const counts = { all: markets.length, active: 0, resolved: 0, cancelled: 0, expired: 0 };
  for (const market of markets) {
    counts[derivePoolStatus(market)] += 1;
  }
  return counts;
}

/** Count pools by category. */
export function countPoolsByCategory(markets: PoolLike[]): Record<PoolCategory, number> {
  const counts: Record<PoolCategory, number> = {
    crypto: 0,
    sports: 0,
    weather: 0,
    economics: 0,
    politics: 0,
    other: 0,
  };
  for (const market of markets) {
    const category = (market.category || 'other').toLowerCase() as PoolCategory;
    if (category in counts) counts[category] += 1;
    else counts.other += 1;
  }
  return counts;
}

/** Get all unique tags across pools. */
export function getAllUniqueTags(markets: PoolLike[]): Set<string> {
  const tags = new Set<string>();
  for (const market of markets) {
    if (market.tags) {
      market.tags
        .toLowerCase()
        .split(',')
        .forEach(tag => {
          const trimmed = tag.trim();
          if (trimmed) tags.add(trimmed);
        });
    }
  }
  return tags;
}

/**
 * Apply status + keyword filtering. Newest pools are returned first so the list
 * has a stable, sensible order regardless of the upstream fetch order.
 */
export function filterPools(markets: PoolLike[], filters: PoolListFilters): PoolLike[] {
  const normalized = normalizePoolFilters(filters);
  const query = normalized.search.toLowerCase();

  const filtered = markets.filter((market) => {
    if (normalized.status !== 'all' && derivePoolStatus(market) !== normalized.status) {
      return false;
    }
    if (query) {
      const haystack = `${market.title} ${market.description}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (normalized.categories.length > 0) {
      const poolCategory = (market.category || '').toLowerCase();
      if (!normalized.categories.some(cat => poolCategory === cat)) {
        return false;
      }
    }
    if (normalized.tags.length > 0) {
      const poolTags = (market.tags || '').toLowerCase().split(',').map(t => t.trim());
      if (!normalized.tags.some(tag => poolTags.includes(tag.toLowerCase()))) {
        return false;
      }
    }
    if (normalized.crossChainOnly && (!market.mirroredChains || market.mirroredChains.length === 0)) {
      return false;
    }
    return true;
  });

  return filtered.sort((a, b) => b.createdAt - a.createdAt || b.poolId - a.poolId);
}
