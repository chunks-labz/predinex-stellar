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
      counts[market.status]++;
      if (market.disputed) counts.disputed++;
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatsCard title="Total Markets" value={filterCounts.all} />
          <StatsCard title="Open" value={filterCounts.active} />
          <StatsCard title="Settled" value={filterCounts.settled} />
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

export default function MarketsPage() {
  return (
    <RouteErrorBoundary routeName="Markets">
      <Suspense fallback={<main className="min-h-screen bg-background text-foreground" />}>
        <MarketsContent />
      </Suspense>
    </RouteErrorBoundary>
  );
}
