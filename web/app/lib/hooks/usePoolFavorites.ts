import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';

const POOL_FAVORITES_KEY = 'predinex_pool_favorites_v1';

function normalizeIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  const normalized = ids
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .map((n) => Math.trunc(n))
    .filter((n) => n >= 0);

  // De-dupe + stable ordering (ascending)
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

export function usePoolFavorites() {
  const [storedIds, setStoredIds, clearStoredIds] = useLocalStorage<number[]>(
    POOL_FAVORITES_KEY,
    []
  );

  const favoritePoolIds = useMemo(() => normalizeIds(storedIds), [storedIds]);

  const isFavorite = useCallback(
    (poolId: number) => favoritePoolIds.includes(poolId),
    [favoritePoolIds]
  );

  const toggleFavorite = useCallback(
    (poolId: number) => {
      const normalizedPoolId = Number.isFinite(poolId) ? Math.trunc(poolId) : NaN;
      if (!Number.isFinite(normalizedPoolId) || normalizedPoolId < 0) return;

      setStoredIds((prev) => {
        const prevNormalized = normalizeIds(prev);
        if (prevNormalized.includes(normalizedPoolId)) {
          return prevNormalized.filter((id) => id !== normalizedPoolId);
        }
        return normalizeIds([...prevNormalized, normalizedPoolId]);
      });
    },
    [setStoredIds]
  );

  const clearFavorites = useCallback(() => {
    clearStoredIds();
  }, [clearStoredIds]);

  return {
    favoritePoolIds,
    isFavorite,
    toggleFavorite,
    clearFavorites,
  };
}

