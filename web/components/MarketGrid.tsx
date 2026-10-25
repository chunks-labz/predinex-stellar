'use client';

import { RefreshCw, AlertCircle, Search, Sparkles } from 'lucide-react';
import MarketCard from '@/components/MarketCard';
import MarketCardSkeleton from '@/components/MarketCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { ProcessedMarket } from '@/app/lib/market-types';

interface MarketGridProps {
  markets: ProcessedMarket[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onResetFilters?: () => void;
  searchQuery?: string;
  hasFilters?: boolean;
}

export default function MarketGrid({
  markets,
  isLoading,
  error,
  onRetry,
  onResetFilters,
  searchQuery = '',
  hasFilters = false
}: MarketGridProps) {
  // Loading state - skeleton grid matching the real market card layout
  if (isLoading) {
    return (
      <div className="space-y-6 animate-fade-in" role="status" aria-busy="true">
        <span className="sr-only">Loading markets…</span>
        <div className="h-5 w-32 bg-muted/40 rounded animate-pulse" aria-hidden="true" />
        <ul
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 list-none p-0 m-0"
          aria-hidden="true"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <MarketCardSkeleton />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Error state - visually distinct from empty state (danger/red tone, retry CTA)
  if (error) {
    return (
      <div className="space-y-6" role="alert">
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-8 rounded-2xl border border-red-500/20 bg-red-500/5 backdrop-blur-sm">
            <div className="p-4 rounded-full bg-red-500/10 text-red-500 ring-1 ring-red-500/20">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-red-500">Failed to Load Markets</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium
                       rounded-xl transition-all duration-200 shadow-sm hover:shadow cursor-pointer mt-2"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state - no markets at all in the protocol
  if (markets.length === 0 && !searchQuery && !hasFilters) {
    return (
      <div className="space-y-6 py-6">
        <EmptyState
          title="No Markets Found"
          description="There are no prediction markets available yet. Be the first to create one and earn creator fees!"
          icon={Sparkles}
          actionLabel="Create Market"
          actionHref="/create"
        />
      </div>
    );
  }

  // Empty state - no results for search/filters
  if (markets.length === 0 && (searchQuery || hasFilters)) {
    return (
      <div className="space-y-6 py-6">
        <EmptyState
          title="No Matching Markets"
          description={
            searchQuery
              ? `No markets match "${searchQuery}". Try adjusting your search query or relaxing your filter criteria.`
              : 'No markets match your current filter settings. Try adjusting your status, asset, or volume filters.'
          }
          icon={Search}
          secondaryActionLabel="Clear Filters"
          onSecondaryAction={onResetFilters}
          actionLabel="Create Market"
          actionHref="/create"
        />
      </div>
    );
  }

  // Markets grid
  return (
    <div className="space-y-6">
      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite" aria-atomic="true">
          {markets.length} market{markets.length !== 1 ? 's' : ''} found
          {searchQuery && ` for "${searchQuery}"`}
        </p>
      </div>

      {/* #455 mobile: single column on mobile, 2 on md, 3 on lg, 4 on xl */}
      <ul
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 list-none p-0 m-0"
        aria-label="Prediction markets"
      >
        {markets.map((market) => (
          <li key={market.poolId}>
            <MarketCard market={market} />
          </li>
        ))}
      </ul>
    </div>
  );
}
