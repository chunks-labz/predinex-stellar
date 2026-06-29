/**
 * Custom hook for handling async operations
 * Provides loading, error, and data states
 */

import { useState, useEffect, useCallback } from 'react';

interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseAsyncOptions<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  immediate?: boolean;
}

/**
 * Hook for handling async operations
 * @param asyncFunction Async function to execute
 * @param immediate Whether to execute immediately
 * @returns State and execute function
 */
export function useAsync<T>(
  asyncFunction: () => Promise<T>,
  options: UseAsyncOptions<T> = {}
) {
  const { onSuccess, onError, immediate = true } = options;

  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const execute = useCallback(async () => {
    setState({ data: null, loading: true, error: null });

    try {
      const response = await asyncFunction();
      setState({ data: response, loading: false, error: null });
      onSuccess?.(response);
      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState({ data: null, loading: false, error: err });
      onError?.(err);
      throw err;
    }
  }, [asyncFunction, onSuccess, onError]);

  useEffect(() => {
    if (immediate) {
      const timer = setTimeout(() => execute(), 0);
      return () => clearTimeout(timer);
    }
  }, [execute, immediate]);

  return { ...state, execute };
}

/**
 * Hook for handling async operations with retry logic
 * @param asyncFunction Async function to execute
 * @param maxRetries Maximum number of retries
 * @returns State and execute function
 */
export function useAsyncWithRetry<T>(
  asyncFunction: () => Promise<T>,
  maxRetries: number = 3
) {
  const [retryCount, setRetryCount] = useState(0);

  const execute = useCallback(async () => {
    let lastError: Error | null = null;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await asyncFunction();
        setRetryCount(0);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        setRetryCount(i + 1);

        if (i < maxRetries - 1) {
          // Exponential backoff
          await new Promise(resolve =>
            setTimeout(resolve, Math.pow(2, i) * 1000)
          );
        }
      }
    }

    throw lastError;
  }, [asyncFunction, maxRetries]);

  return { execute, retryCount };
}
