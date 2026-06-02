import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilterPresets } from '../../app/lib/hooks/useFilterPresets';
import { DEFAULT_MARKET_FILTERS } from '../../app/lib/market-filtering';
import type { MarketFilters } from '../../app/lib/market-types';

const STORAGE_KEY = 'predinex:filter-presets';

const filtersA: MarketFilters = { ...DEFAULT_MARKET_FILTERS, search: 'btc', status: 'open' };
const filtersB: MarketFilters = { ...DEFAULT_MARKET_FILTERS, sortBy: 'volume', status: 'settled' };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFilterPresets', () => {
  it('starts with no presets', () => {
    const { result } = renderHook(() => useFilterPresets());
    expect(result.current.presets).toHaveLength(0);
    expect(result.current.canSave).toBe(true);
  });

  it('saves a preset and reads it back', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => {
      result.current.savePreset('BTC open', filtersA);
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('BTC open');
    expect(result.current.presets[0].filters).toEqual(filtersA);
  });

  it('deletes a preset by id', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => {
      result.current.savePreset('Preset A', filtersA);
      result.current.savePreset('Preset B', filtersB);
    });

    const idToDelete = result.current.presets[0].id;

    act(() => {
      result.current.deletePreset(idToDelete);
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].name).toBe('Preset B');
  });

  it('enforces maximum of 5 presets', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => {
      for (let i = 0; i < 6; i++) {
        result.current.savePreset(`Preset ${i}`, filtersA);
      }
    });

    expect(result.current.presets).toHaveLength(5);
    expect(result.current.canSave).toBe(false);
  });

  it('ignores save when name is empty or whitespace-only', () => {
    const { result } = renderHook(() => useFilterPresets());

    act(() => {
      result.current.savePreset('', filtersA);
      result.current.savePreset('   ', filtersA);
    });

    expect(result.current.presets).toHaveLength(0);
  });

  it('persists presets in localStorage across re-renders', () => {
    const { result: first } = renderHook(() => useFilterPresets());

    act(() => {
      first.current.savePreset('Persistent', filtersB);
    });

    // Unmount and remount — localStorage should hydrate the saved preset.
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const { result: second } = renderHook(() => useFilterPresets());
    expect(second.current.presets).toHaveLength(1);
    expect(second.current.presets[0].name).toBe('Persistent');
    expect(second.current.presets[0].filters).toEqual(filtersB);
  });
});
