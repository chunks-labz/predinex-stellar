'use client';

import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
import type { MarketFilters } from '../market-types';

export interface FilterPreset {
  id: string;
  name: string;
  filters: MarketFilters;
}

const STORAGE_KEY = 'predinex:filter-presets';
const MAX_PRESETS = 5;

export function useFilterPresets() {
  const [presets, setPresets] = useLocalStorage<FilterPreset[]>(STORAGE_KEY, []);

  const canSave = useMemo(() => presets.length < MAX_PRESETS, [presets.length]);

  const savePreset = useCallback(
    (name: string, filters: MarketFilters) => {
      const trimmed = name.trim();
      if (!trimmed || presets.length >= MAX_PRESETS) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setPresets((prev) => [...prev, { id, name: trimmed, filters }]);
    },
    [presets.length, setPresets],
  );

  const deletePreset = useCallback(
    (id: string) => {
      setPresets((prev) => prev.filter((p) => p.id !== id));
    },
    [setPresets],
  );

  return { presets, savePreset, deletePreset, canSave, maxPresets: MAX_PRESETS };
}
