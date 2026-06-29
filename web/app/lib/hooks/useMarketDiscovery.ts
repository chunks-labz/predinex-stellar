'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useMarketDiscovery');

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketFilters, PaginationState, ProcessedMarket } from '../market-types';
import { readBlockHeightWarning, readMarketListCache, warmMarketListCache } from '../market-list-cache';
import {
  DEFAULT_MARKET_FILTERS,
  filterAndSortMarkets,
  getMarketAssetOptions,
  hasActiveMarketFilters,
  marketFiltersToParams,
  normalizeMarketFilters,
} from '../market-filtering';
import {
  classifyConnectivityIssue,
  getConnectivityMessage,
  withTimeout,
} from '../network-errors';
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling';

interface UseMarketDiscoveryState {
  allMarkets: ProcessedMarket[];
  filteredMarkets: ProcessedMarket[];
  paginatedMarkets: ProcessedMarket[];
  isLoading: boolean;
  error: string | null;
  blockHeightWarning: string | null;
  filters: MarketFilters;
  assetOptions: string[];
  hasActiveFilters: boolean;
  pagination: PaginationState;
  setSearch: (search: string) => void;
  setStatusFilter: (status: MarketFilters['status']) => void;
  setAssetFilter: (asset: string) => void;
  setMinVolume: (minVolume: string) => void;
  setMaxVolume: (maxVolume: string) => void;
  setTimeRange: (timeRange: MarketFilters['timeRange']) => void;
  setSortBy: (sortBy: MarketFilters['sortBy']) => void;
  /** Batch-replaces all filter dimensions at once. Used by preset loading to avoid multiple re-renders. */
  setFilters: (filters: MarketFilters) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  retry: () => void;
}

interface UseMarketDiscoveryOptions {
  initialFilters?: MarketFilters;
  externalFilters?: MarketFilters;
  externalFiltersKey?: string;
  onFiltersChange?: (filters: MarketFilters) => void;
}

const ITEMS_PER_PAGE = 12;
const REFRESH_INTERVAL_MS = 60_000;

export function useMarketDiscovery(options: UseMarketDiscoveryOptions = {}): UseMarketDiscoveryState {
  const { initialFilters, externalFilters, externalFiltersKey, onFiltersChange } = options;
  const [cacheSnapshot] = useState(() => readMarketListCache());
  const hasFreshInitialCacheRef = useRef(cacheSnapshot.isFresh);
  const hasAnyMarketsRef = useRef(cacheSnapshot.markets.length > 0);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const didHydrateFiltersRef = useRef(false);
  const filteredCountRef = useRef(0);

  const [blockHeightWarning, setBlockHeightWarning] = useState<string | null>(() =>
    readBlockHeightWarning()
  );
  const [allMarkets, setAllMarkets] = useState<ProcessedMarket[]>(cacheSnapshot.markets);
  const [isLoading, setIsLoading] = useState<boolean>(() => !cacheSnapshot.isFresh);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<MarketFilters>(() =>
    normalizeMarketFilters(initialFilters ?? DEFAULT_MARKET_FILTERS)
  );
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!externalFilters) return;

    setFiltersState((previous) => {
      const previousParams = marketFiltersToParams(previous).toString();
      const nextParams = marketFiltersToParams(externalFilters).toString();
      return previousParams === nextParams ? previous : externalFilters;
    });
    setCurrentPage(1);
  }, [externalFilters, externalFiltersKey]);

  useEffect(() => {
    if (!didHydrateFiltersRef.current) {
      didHydrateFiltersRef.current = true;
      return;
    }

    onFiltersChange?.(filters);
  }, [filters, onFiltersChange]);

  const fetchMarkets = useCallback(async (options?: { forceLoading?: boolean }) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const shouldShowLoading =
      options?.forceLoading || !hasFreshInitialCacheRef.current;
    const isCurrentRequest = () => mountedRef.current && requestIdRef.current === requestId;

    try {
      if (shouldShowLoading && mountedRef.current) setIsLoading(true);
      if (mountedRef.current) setError(null);

      const processedMarkets = await withTimeout(
        warmMarketListCache(),
        12000,
        'Market loading timeout',
      );

      if (!isCurrentRequest()) return;

      setAllMarkets(processedMarkets);
      hasAnyMarketsRef.current = processedMarkets.length > 0;
      setBlockHeightWarning(readBlockHeightWarning());
    } catch (err) {
      if (!isCurrentRequest()) return;

      log.error('Failed to fetch markets:', err);
      const issue = classifyConnectivityIssue(err);
      const message = getConnectivityMessage(issue, 'Loading markets');

      if (hasAnyMarketsRef.current) {
        setError(null);
        setBlockHeightWarning(message);
      } else {
        setError(message);
      }
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
        hasFreshInitialCacheRef.current = true;
      }
    }
  }, []);

  useVisibilityAwarePolling(fetchMarkets, REFRESH_INTERVAL_MS);

  const filteredMarkets = useMemo(
    () => filterAndSortMarkets(allMarkets, filters),
    [allMarkets, filters],
  );

  filteredCountRef.current = filteredMarkets.length;

  const assetOptions = useMemo(() => getMarketAssetOptions(allMarkets), [allMarkets]);
  const hasActiveFilters = useMemo(() => hasActiveMarketFilters(filters), [filters]);

  const pagination = useMemo((): PaginationState => {
    const totalItems = filteredMarkets.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    return {
      currentPage,
      itemsPerPage: ITEMS_PER_PAGE,
      totalItems,
      totalPages,
    };
  }, [filteredMarkets.length, currentPage]);

  const paginatedMarkets = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    return filteredMarkets.slice(startIndex, endIndex);
  }, [filteredMarkets, currentPage]);

  const updateFilters = useCallback((patch: Partial<MarketFilters>) => {
    setFiltersState((previous) => normalizeMarketFilters({ ...previous, ...patch }));
    setCurrentPage(1);
  }, []);

  const setSearch = useCallback((value: string) => {
    updateFilters({ search: value });
  }, [updateFilters]);

  const setStatusFilter = useCallback((value: MarketFilters['status']) => {
    updateFilters({ status: value });
  }, [updateFilters]);

  const setAssetFilter = useCallback((value: string) => {
    updateFilters({ asset: value });
  }, [updateFilters]);

  const setMinVolume = useCallback((value: string) => {
    updateFilters({ minVolume: value });
  }, [updateFilters]);

  const setMaxVolume = useCallback((value: string) => {
    updateFilters({ maxVolume: value });
  }, [updateFilters]);

  const setTimeRange = useCallback((value: MarketFilters['timeRange']) => {
    updateFilters({ timeRange: value });
  }, [updateFilters]);

  const setSortBy = useCallback((value: MarketFilters['sortBy']) => {
    updateFilters({ sortBy: value });
  }, [updateFilters]);

  const setFilters = useCallback((next: MarketFilters) => {
    setFiltersState(normalizeMarketFilters(next));
    setCurrentPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({ ...DEFAULT_MARKET_FILTERS });
    setCurrentPage(1);
  }, []);

  const setPage = useCallback((page: number) => {
    const totalPages = Math.ceil(filteredCountRef.current / ITEMS_PER_PAGE);
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }, []);

  const retry = useCallback(() => {
    fetchMarkets({ forceLoading: true });
  }, [fetchMarkets]);

  return {
    allMarkets,
    filteredMarkets,
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
  };
}
