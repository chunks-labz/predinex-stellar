'use client';

import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';

export const POOL_COMPARISON_STORAGE_KEY = 'predinex:compare:v1';
export const POOL_COMPARISON_MAX = 4;

function normalizeIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  const normalized = ids
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .map((n) => Math.trunc(n))
    .filter((n) => n >= 0);
  return Array.from(new Set(normalized));
}

export interface UsePoolComparison {
  selected: number[];
  count: number;
  atCapacity: boolean;
  isSelected: (poolId: number) => boolean;
  toggle: (poolId: number) => void;
  remove: (poolId: number) => void;
  clear: () => void;
}

export function usePoolComparison(): UsePoolComparison {
  const [stored, setStored, clearStored] = useLocalStorage<number[]>(
    POOL_COMPARISON_STORAGE_KEY,
    []
  );

  const selected = useMemo(() => normalizeIds(stored), [stored]);
  const count = selected.length;
  const atCapacity = count >= POOL_COMPARISON_MAX;

  const isSelected = useCallback(
    (poolId: number) => selected.includes(poolId),
    [selected]
  );

  const toggle = useCallback(
    (poolId: number) => {
      const id = Number.isFinite(poolId) ? Math.trunc(poolId) : NaN;
      if (!Number.isFinite(id) || id < 0) return;
      setStored((prev) => {
        const prevList = normalizeIds(prev);
        if (prevList.includes(id)) {
          return prevList.filter((existing) => existing !== id);
        }
        if (prevList.length >= POOL_COMPARISON_MAX) {
          return prevList;
        }
        return [...prevList, id];
      });
    },
    [setStored]
  );

  const remove = useCallback(
    (poolId: number) => {
      setStored((prev) => normalizeIds(prev).filter((id) => id !== poolId));
    },
    [setStored]
  );

  const clear = useCallback(() => {
    clearStored();
  }, [clearStored]);

  return { selected, count, atCapacity, isSelected, toggle, remove, clear };
}
