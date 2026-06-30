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

export interface PoolListFilters {
  /** Free-text query matched against pool title and description. */
  search: string;
  status: PoolStatusFilter;
}

export const DEFAULT_POOL_FILTERS: PoolListFilters = {
  search: '',
  status: 'all',
};

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

export function normalizePoolFilters(filters: Partial<PoolListFilters>): PoolListFilters {
  return {
    search: filters.search?.trim() ?? DEFAULT_POOL_FILTERS.search,
    status: normalizeStatus(filters.status ?? null),
  };
}

/** Read filter state out of URL query params (`?status=&q=`). */
export function parsePoolFiltersFromParams(params: URLSearchParams): PoolListFilters {
  return {
    search: params.get('q') ?? '',
    status: normalizeStatus(params.get('status')),
  };
}

/** Serialise filter state to URL query params, omitting defaults. */
export function poolFiltersToParams(filters: PoolListFilters): URLSearchParams {
  const normalized = normalizePoolFilters(filters);
  const params = new URLSearchParams();
  if (normalized.search) params.set('q', normalized.search);
  if (normalized.status !== DEFAULT_POOL_FILTERS.status) params.set('status', normalized.status);
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
    return true;
  });

  return filtered.sort((a, b) => b.createdAt - a.createdAt || b.poolId - a.poolId);
}
