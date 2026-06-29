/**
 * Custom hook for fetching data with caching and error handling
 */

import { useState, useEffect, useCallback } from 'react';
import { cache } from '../cache';
import { parseContractError } from '../error-handler';

interface UseFetchOptions<T> {
  cacheKey?: string;
  cacheTTL?: number;
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

interface UseFetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook for fetching data with caching
 */
export function useFetch<T>(
  url: string,
  options: UseFetchOptions<T> = {}
) {
  const {
    cacheKey = url,
    cacheTTL = 5 * 60 * 1000,
    immediate = true,
    onSuccess,
    onError,
  } = options;

  const [state, setState] = useState<UseFetchState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const fetch = useCallback(async () => {
    // Check cache first
    const cached = cache.get<T>(cacheKey);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      onSuccess?.(cached);
      return cached;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await global.fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      cache.set(cacheKey, data, cacheTTL);
      setState({ data, loading: false, error: null });
      onSuccess?.(data);
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState({ data: null, loading: false, error: err });
      onError?.(err);
      throw err;
    }
  }, [url, cacheKey, cacheTTL, onSuccess, onError]);

  useEffect(() => {
    if (immediate) {
      fetch();
    }
  }, [fetch, immediate]);

  const refetch = useCallback(() => {
    cache.delete(cacheKey);
    return fetch();
  }, [fetch, cacheKey]);

  return { ...state, fetch, refetch };
}
