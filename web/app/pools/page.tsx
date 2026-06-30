'use client';
/**
 * Pools list page — a dedicated `/pools` view that lists prediction pools with
 * a status filter (Active, Resolved, Cancelled, Expired) and a title/description
 * keyword search. Filter state is mirrored into the URL query string so a
 * filtered view can be shared via link.
 *
 * Pools are sourced from the same cached on-chain market data as `/markets`;
 * filtering is applied client-side.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '@/components/RouteErrorBoundary';
import type { ProcessedMarket } from '@/app/lib/market-types';
import { readMarketListCache, warmMarketListCache } from '@/app/lib/market-list-cache';
import {
  POOL_STATUS_OPTIONS,
  POOL_CATEGORIES,
  countPoolsByStatus,
  countPoolsByCategory,
  getAllUniqueTags,
  derivePoolStatus,
  filterPools,
  hasActivePoolFilters,
  parsePoolFiltersFromParams,
  poolFiltersToParams,
  type PoolLike,
  type PoolListStatus,
  type PoolStatusFilter,
  type PoolCategory,
} from '@/app/lib/pool-list-filtering';

const STATUS_BADGE: Record<PoolListStatus, string> = {
  active: 'bg-green-500/15 text-green-300 border-green-500/30',
  resolved: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
  expired: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
};

function PoolCard({ pool }: { pool: PoolLike }) {
  const status = derivePoolStatus(pool);
  return (
    <Link
      href={`/markets/${pool.poolId}`}
      aria-label={`View pool: ${pool.title}`}
      className="block rounded-xl border border-border/40 bg-card p-5 transition-colors hover:border-primary/50"
      data-testid="pool-card"
      data-status={status}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug line-clamp-2">{pool.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[status]}`}
        >
          {status}
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{pool.description}</p>
    </Link>
  );
}

function PoolsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();

  const filters = useMemo(() => parsePoolFiltersFromParams(searchParams), [searchParams]);

  const [cached] = useState(() => readMarketListCache().markets);
  const [markets, setMarkets] = useState<ProcessedMarket[]>(cached);
  const [isLoading, setIsLoading] = useState<boolean>(cached.length === 0);
  const [error, setError] = useState<string | null>(null);
  // Local mirror of the search box so typing feels instant without waiting for
  // the URL round-trip; committed to the URL on change.
  const [searchInput, setSearchInput] = useState(filters.search);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Keep the search box in sync when the URL changes (e.g. back/forward).
  useEffect(() => {
    setSearchInput(filters.search);
  }, [filters.search]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const fresh = await warmMarketListCache();
      if (mountedRef.current) setMarkets(fresh);
    } catch {
      if (mountedRef.current) setError('Failed to load pools. Please try again.');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncFiltersToUrl = useCallback(
    (next: Partial<{ search: string; status: PoolStatusFilter; categories: PoolCategory[]; tags: string[]; crossChainOnly: boolean }>) => {
      const fullFilters = { ...filters, ...next };
      const nextQuery = poolFiltersToParams(fullFilters).toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      const currentUrl = queryKey ? `${pathname}?${queryKey}` : pathname;
      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, queryKey, router, filters],
  );

  const setStatus = useCallback(
    (status: PoolStatusFilter) => syncFiltersToUrl({ status }),
    [syncFiltersToUrl],
  );

  const commitSearch = useCallback(
    (search: string) => syncFiltersToUrl({ search }),
    [syncFiltersToUrl],
  );

  const counts = useMemo(() => countPoolsByStatus(markets), [markets]);
  const categoryCounts = useMemo(() => countPoolsByCategory(markets), [markets]);
  const uniqueTags = useMemo(() => getAllUniqueTags(markets), [markets]);
  const visiblePools = useMemo(() => filterPools(markets, filters), [markets, filters]);
  const filtersActive = hasActivePoolFilters(filters);

  const clearFilters = useCallback(() => {
    setSearchInput('');
    if (filtersActive) router.replace(pathname, { scroll: false });
  }, [filtersActive, pathname, router]);

  const setCategories = useCallback(
    (categories: PoolCategory[]) => syncFiltersToUrl({ categories }),
    [syncFiltersToUrl],
  );

  const setTags = useCallback(
    (tags: string[]) => syncFiltersToUrl({ tags }),
    [syncFiltersToUrl],
  );

  const setCrossChainOnly = useCallback(
    (crossChainOnly: boolean) => syncFiltersToUrl({ crossChainOnly }),
    [syncFiltersToUrl],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="container mx-auto max-w-6xl px-4 pt-28 pb-20">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Pools</h1>
            <p className="mt-2 text-muted-foreground">
              Browse prediction pools. Filter by status or search by keyword.
            </p>
          </div>
          <Link
            href="/pools/new"
            className="rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground transition-all hover:brightness-110"
          >
            Create pool
          </Link>
        </header>

        {/* Filter bar */}
        <div
          className="mb-8 flex flex-col gap-4"
          data-testid="pool-filter-bar"
        >
          {/* Search and status row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label htmlFor="pool-search" className="sr-only">
                Search pools by title or description
              </label>
              <input
                id="pool-search"
                type="search"
                value={searchInput}
                placeholder="Search by title or description…"
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  commitSearch(e.target.value);
                }}
                className="w-full rounded-lg border border-border/50 bg-card px-4 py-2 text-sm outline-none focus:border-primary"
                data-testid="pool-search-input"
              />
            </div>
            <div>
              <label htmlFor="pool-status" className="sr-only">
                Filter pools by status
              </label>
              <select
                id="pool-status"
                value={filters.status}
                onChange={(e) => setStatus(e.target.value as PoolStatusFilter)}
                className="w-full rounded-lg border border-border/50 bg-card px-4 py-2 text-sm outline-none focus:border-primary sm:w-48"
                data-testid="pool-status-select"
              >
                {POOL_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                    {opt.value !== 'all' ? ` (${counts[opt.value]})` : ''}
                  </option>
                ))}
              </select>
            </div>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-border/50 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                data-testid="pool-clear-filters"
              >
                Clear
              </button>
            )}
          </div>

          {/* Category chips */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Categories</label>
            <div className="flex flex-wrap gap-2">
              {POOL_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => {
                    if (filters.categories.includes(cat.value)) {
                      setCategories(filters.categories.filter(c => c !== cat.value));
                    } else {
                      setCategories([...filters.categories, cat.value]);
                    }
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                    filters.categories.includes(cat.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/50 text-muted-foreground border-border/50 hover:border-border'
                  } border`}
                  data-testid={`category-filter-${cat.value}`}
                >
                  {cat.label} ({categoryCounts[cat.value]})
                </button>
              ))}
            </div>
          </div>

          {/* Tags filter and cross-chain toggle */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <label htmlFor="pool-tags" className="text-xs font-semibold text-muted-foreground block mb-2">
                Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {Array.from(uniqueTags)
                  .slice(0, 10)
                  .map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        if (filters.tags.includes(tag)) {
                          setTags(filters.tags.filter(t => t !== tag));
                        } else {
                          setTags([...filters.tags, tag]);
                        }
                      }}
                      className={`rounded-full px-2.5 py-1 text-xs transition-all ${
                        filters.tags.includes(tag)
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted/30 text-muted-foreground border border-border/30 hover:border-border'
                      }`}
                      data-testid={`tag-filter-${tag}`}
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={filters.crossChainOnly}
                  onChange={(e) => setCrossChainOnly(e.target.checked)}
                  className="rounded border-border"
                  data-testid="crosschain-toggle"
                />
                <span>Cross-chain only</span>
              </label>
            </div>
          </div>
        </div>

        {/* Results */}
        {error ? (
          <div
            className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-6 text-center text-sm text-red-200"
            role="alert"
          >
            <p className="mb-3">{error}</p>
            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                void load();
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground" role="status" data-testid="pools-loading">
            Loading pools…
          </p>
        ) : visiblePools.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="pools-empty">
            {filtersActive
              ? 'No pools match your filters.'
              : 'No pools yet. Create one to get started.'}
          </p>
        ) : (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="pools-grid"
          >
            {visiblePools.map((pool) => (
              <PoolCard key={pool.poolId} pool={pool} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export default function PoolsIndexPage() {
  return (
    <RouteErrorBoundary routeName="PoolsIndex">
      <Suspense fallback={<main className="min-h-screen bg-background text-foreground" />}>
        <PoolsContent />
      </Suspense>
    </RouteErrorBoundary>
  );
}
