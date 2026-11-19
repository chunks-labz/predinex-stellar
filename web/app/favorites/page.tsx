'use client';

import { useMemo, useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { StatsCard } from '@/components/ui/StatsCard';
import MarketGrid from '@/components/MarketGrid';
import { usePoolFavorites, POOL_FAVORITES_MAX } from "../lib/hooks/usePoolFavorites";
import { useMarketDiscovery } from "../lib/hooks/useMarketDiscovery";
import RouteErrorBoundary from "../../components/RouteErrorBoundary";
import { EmptyState } from '@/components/EmptyState';
import { Star, ChevronRight, SearchX } from 'lucide-react';

function FavoritesContent() {
  const { favoritePoolIds, clearFavorites } = usePoolFavorites();
  // Bookmarks are matched against every market, not the /markets filter state.
  const { allMarkets, isLoading, error, retry } = useMarketDiscovery();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const favoriteMarkets = useMemo(() => {
    if (!isMounted) return [];
    return allMarkets.filter((market) => favoritePoolIds.includes(market.poolId));
  }, [allMarkets, favoritePoolIds, isMounted]);

  const maxFavorites = POOL_FAVORITES_MAX;
  const canAddMore = favoritePoolIds.length < maxFavorites;
  const isFull = favoritePoolIds.length >= maxFavorites;

  const displayMarkets = favoriteMarkets.slice(0, maxFavorites);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="pt-32 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary mb-2">
            <Star className="h-4 w-4 fill-current" />
            Bookmarked Markets
          </div>
          <h1 className="text-4xl font-black tracking-tight mb-2">My Favorites</h1>
          <p className="text-muted-foreground">
            Quick access to your bookmarked prediction markets (max {maxFavorites})
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <StatsCard title="Bookmarked" value={favoritePoolIds.length} />
          <StatsCard
            title="Status"
            value={isFull ? 'Full' : `${maxFavorites - favoritePoolIds.length} slots left`}
          />
          <StatsCard title="Viewable" value={displayMarkets.length} />
        </div>

        {/* Warning if full */}
        {isFull && (
          <div className="mb-6 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5">
            <p className="text-sm text-yellow-600">
              You have reached the maximum of {maxFavorites} bookmarked markets. Remove some to add new ones.
            </p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && favoritePoolIds.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
            <Star className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">No bookmarked markets yet</h2>
            <p className="text-muted-foreground mb-6">
              Bookmark markets to quickly access them later. Use the star icon on any market card.
            </p>
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Browse Markets
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Markets Grid */}
        {!isLoading && isMounted && favoritePoolIds.length > 0 && (
          <>
            {/*
              With bookmarks but nothing to show, MarketGrid's generic empty
              state ("no markets yet — create one") is wrong: either the load
              failed, or the bookmarked pools are no longer in the market list.
            */}
            {displayMarkets.length === 0 ? (
              error ? (
                <MarketGrid markets={[]} isLoading={false} error={error} onRetry={retry} />
              ) : (
                <EmptyState
                  title="Bookmarked markets unavailable"
                  description="None of your bookmarked pools are in the current market list. They may have been removed, or the list hasn't refreshed yet."
                  icon={SearchX}
                  actionLabel="Browse Markets"
                  actionHref="/markets"
                  secondaryActionLabel="Clear bookmarks"
                  onSecondaryAction={clearFavorites}
                />
              )
            ) : (
              <>
                <MarketGrid markets={displayMarkets} isLoading={false} error={null} onRetry={retry} />

                {error && (
                  <div role="alert" className="mt-6 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                    <p className="text-sm text-red-600 mb-3">
                      Couldn&apos;t refresh market data — showing the last loaded values.
                    </p>
                    <button
                      type="button"
                      onClick={retry}
                      className="text-sm font-semibold text-red-600 hover:text-red-500"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {isLoading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-64 rounded-xl border border-border bg-card/40 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Navigation Link */}
        {!isLoading && favoritePoolIds.length > 0 && canAddMore && (
          <div className="mt-8 text-center">
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
            >
              Browse more markets to add
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

export default function FavoritesPage() {
  return (
    <RouteErrorBoundary>
      <FavoritesContent />
    </RouteErrorBoundary>
  );
}
