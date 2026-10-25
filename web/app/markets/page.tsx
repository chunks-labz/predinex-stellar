'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { StatsCard } from '@/components/ui/StatsCard';
import MarketFilterBar from "../components/MarketFilterBar";
import MarketGrid from '@/components/MarketGrid';
import Pagination from '@/components/Pagination';
import { marketFiltersToParams, parseMarketFiltersFromParams } from "../lib/market-filtering";
import type { MarketFilters } from "../lib/market-types";
import { useMarketDiscovery } from "../lib/hooks/useMarketDiscovery";
import { useFilterPresets } from "../lib/hooks/useFilterPresets";
import RouteErrorBoundary from "../../components/RouteErrorBoundary";
import CompareBadge from '@/components/CompareBadge';

function MarketsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const urlFilters = useMemo(() => parseMarketFiltersFromParams(searchParams), [searchParams]);
  const syncFiltersToUrl = useCallback(
    (nextFilters: MarketFilters) => {
      const nextQuery = marketFiltersToParams(nextFilters).toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
      const currentUrl = queryKey ? `${pathname}?${queryKey}` : pathname;
      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, queryKey, router],
  );

  const {
    paginatedMarkets,
    isLoading,
    error,
    blockHeightWarning,
    filters,
    assetOptions,
    hasActiveFilters,
    pagination,
    setSearch,
    setStatusFilter,
    setAssetFilter,
    setMinVolume,
    setMaxVolume,
    setTimeRange,
    setSortBy,
    setFilters,
    resetFilters,
    setPage,
    retry,
    filteredMarkets
  } = useMarketDiscovery({
    initialFilters: urlFilters,
    externalFilters: urlFilters,
    externalFiltersKey: queryKey,
    onFiltersChange: syncFiltersToUrl,
  });

  const { presets, savePreset, deletePreset, canSave, maxPresets } = useFilterPresets();

  // Calculate filter counts for display
  const filterCounts = useMemo(() => {
    const counts = {
      all: filteredMarkets.length,
      active: 0,
      settled: 0,
      expired: 0,
      disputed: 0,
    };

    filteredMarkets.forEach(market => {
      // #1537 — index by the count keys that exist: 'frozen' has no card and
      // previously produced NaN, and disputed markets were counted twice
      // (once by status, once by the disputed flag).
      if (market.status === 'active') counts.active++;
      else if (market.status === 'settled') counts.settled++;
      else if (market.status === 'expired') counts.expired++;
      else if (market.status === 'disputed' || market.disputed) counts.disputed++;
    });

    return counts;
  }, [filteredMarkets]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="pt-32 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Prediction Markets</h1>
          <p className="text-muted-foreground">
            Discover and participate in decentralized prediction markets on Stellar
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <StatsCard title="Total Markets" value={filterCounts.all} />
          <StatsCard title="Active" value={filterCounts.active} />
          <StatsCard title="Settled" value={filterCounts.settled} />
          <StatsCard title="Expired" value={filterCounts.expired} />
          <StatsCard title="Disputed" value={filterCounts.disputed} />
        </div>

        {/* Controls */}
        <div className="mb-8 sticky top-16 z-30 py-4 bg-background/90 backdrop-blur-md border-b border-transparent md:border-border/10">
          <MarketFilterBar
            filters={filters}
            assetOptions={assetOptions}
            onSearchChange={setSearch}
            onStatusChange={setStatusFilter}
            onAssetChange={setAssetFilter}
            onMinVolumeChange={setMinVolume}
            onMaxVolumeChange={setMaxVolume}
            onTimeRangeChange={setTimeRange}
            onSortChange={setSortBy}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
            presets={presets}
            canSavePreset={canSave}
            maxPresets={maxPresets}
            onApplyPreset={setFilters}
            onSavePreset={savePreset}
            onDeletePreset={deletePreset}
          />
        </div>

        {/* Non-blocking freshness warning */}
        {blockHeightWarning && (
          <div
            className="mb-6 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200"
            role="status"
            aria-live="polite"
          >
            {blockHeightWarning}
          </div>
        )}

        {/* Markets Grid */}
        <MarketGrid
          markets={paginatedMarkets}
          isLoading={isLoading}
          error={error}
          onRetry={retry}
          onResetFilters={resetFilters}
          searchQuery={filters.search}
          hasFilters={hasActiveFilters}
        />

        {/* Pagination */}
        {!isLoading && !error && paginatedMarkets.length > 0 && (
          <Pagination
            pagination={pagination}
            onPageChange={setPage}
          />
        )}
      </div>

      <CompareBadge />
    </main>
  );
}

function MarketsPageSkeleton() {
  return (
    <main className="min-h-screen bg-background text-foreground animate-fade-in" role="status" aria-busy="true">
      <Navbar />
      <div className="pt-32 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header Skeleton */}
        <div className="mb-8 space-y-2">
          <div className="h-9 w-64 bg-muted/60 rounded-lg animate-pulse" />
          <div className="h-5 w-96 max-w-full bg-muted/30 rounded-md animate-pulse" />
        </div>

        {/* Stats Overview Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl border border-border/40 bg-card/30 p-6 animate-pulse">
              <div className="h-4 w-20 bg-muted/50 rounded mb-3" />
              <div className="h-7 w-12 bg-muted/70 rounded" />
            </div>
          ))}
        </div>

        {/* Filter Bar Skeleton */}
        <div className="mb-8 py-4 space-y-3">
          <div className="h-12 w-full rounded-2xl bg-card/40 border border-border/40 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-8 w-16 rounded-xl bg-muted/40 animate-pulse" />
            <div className="h-8 w-20 rounded-xl bg-muted/30 animate-pulse" />
            <div className="h-8 w-20 rounded-xl bg-muted/30 animate-pulse" />
            <div className="h-8 w-24 rounded-xl bg-muted/30 animate-pulse" />
          </div>
        </div>

        {/* Markets Grid Skeleton */}
        <div className="space-y-6">
          <div className="h-5 w-32 bg-muted/40 rounded animate-pulse" />
          <ul
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 list-none p-0 m-0"
            aria-hidden="true"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i}>
                <div className="p-8 rounded-3xl border border-border bg-card/40 h-full flex flex-col glass animate-pulse">
                  <div className="flex justify-between items-center mb-6">
                    <div className="h-6 w-16 bg-muted rounded-full" />
                    <div className="h-4 w-20 bg-muted/30 rounded" />
                  </div>
                  <div className="h-7 bg-muted rounded w-3/4 mb-3" />
                  <div className="h-7 bg-muted rounded w-1/2 mb-3" />
                  <div className="h-4 bg-muted/50 rounded w-full mb-2" />
                  <div className="h-4 bg-muted/50 rounded w-5/6 mb-8" />
                  <div className="mt-auto flex items-center justify-between pt-6 border-t border-border/50">
                    <div className="flex items-center gap-4">
                      <div className="h-6 w-20 bg-muted rounded" />
                      <div className="h-6 w-20 bg-muted rounded" />
                    </div>
                    <div className="h-8 w-8 bg-muted rounded-xl" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

export default function MarketsPage() {
  return (
    <RouteErrorBoundary routeName="Markets">
      <Suspense fallback={<MarketsPageSkeleton />}>
        <MarketsContent />
      </Suspense>
    </RouteErrorBoundary>
  );
}
