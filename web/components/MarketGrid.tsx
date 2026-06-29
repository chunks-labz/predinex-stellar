'use client';

import { RefreshCw, AlertCircle, Search } from 'lucide-react';
import MarketCard from '@/components/MarketCard';
import { ProcessedMarket } from '@/app/lib/market-types';
import Link from 'next/link';

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
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-muted-foreground">Loading markets...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="p-4 rounded-full bg-red-500/10">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">Failed to Load Markets</h3>
              <p className="text-muted-foreground">{error}</p>
            </div>
            <button
              onClick={onRetry}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground
                       rounded-lg hover:bg-primary/90 transition-colors duration-200"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state - no markets at all
  if (markets.length === 0 && !searchQuery && !hasFilters) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="p-4 rounded-full bg-muted/50">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">No Markets Found</h3>
              <p className="text-muted-foreground">
                There are no prediction markets available yet. Be the first to create one!
              </p>
            </div>
            <Link
              href="/create"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg
                       hover:bg-primary/90 transition-colors duration-200"
            >
              Create Market
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Empty state - no results for search/filters
  if (markets.length === 0 && (searchQuery || hasFilters)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <div className="p-4 rounded-full bg-muted/50">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">No Results Found</h3>
              <p className="text-muted-foreground">
                {searchQuery
                  ? `No markets match "${searchQuery}". Try adjusting your search terms or filters.`
                  : 'No markets match your current filters. Try adjusting your filter criteria.'
                }
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onResetFilters}
                className="px-4 py-2 border border-muted/50 rounded-lg hover:bg-muted/50
                         transition-colors duration-200"
              >
                Clear Filters
              </button>
              <Link
                href="/create"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg
                         hover:bg-primary/90 transition-colors duration-200"
              >
                Create Market
              </Link>
            </div>
          </div>
        </div>
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
