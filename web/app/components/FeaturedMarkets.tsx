'use client';

import { useMemo } from 'react';
import MarketGrid from '@/components/MarketGrid';
import { useMarketDiscovery } from '../lib/hooks/useMarketDiscovery';

const FEATURED_MARKET_COUNT = 3;

/**
 * Live "Featured Markets" section for the homepage. Reuses the same
 * Soroban-backed market discovery hook and grid as the /markets page so
 * the homepage always shows real, on-chain pool data instead of mocks.
 */
export default function FeaturedMarkets() {
  const { filteredMarkets, isLoading, error, retry } = useMarketDiscovery();

  const featured = useMemo(
    () =>
      [...filteredMarkets]
        .sort((a, b) => b.totalVolume - a.totalVolume)
        .slice(0, FEATURED_MARKET_COUNT),
    [filteredMarkets]
  );

  return (
    <MarketGrid
      markets={featured}
      isLoading={isLoading}
      error={error}
      onRetry={retry}
    />
  );
}
