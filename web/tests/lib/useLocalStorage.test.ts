import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useLocalStorage } from '../../app/lib/hooks/useLocalStorage';
import { usePoolFavorites, POOL_FAVORITES_MAX } from '../../app/lib/hooks/usePoolFavorites';
import { usePoolComparison } from '../../app/lib/hooks/usePoolComparison';

describe('useLocalStorage', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('keeps every instance of the same key in sync', () => {
    const a = renderHook(() => useLocalStorage<number[]>('k', []));
    const b = renderHook(() => useLocalStorage<number[]>('k', []));

    act(() => a.result.current[1]([1]));
    expect(b.result.current[0]).toEqual([1]);

    act(() => b.result.current[2]());
    expect(a.result.current[0]).toEqual([]);
  });

  it('applies functional updates to the latest persisted value', () => {
    const a = renderHook(() => useLocalStorage<number[]>('k', []));
    const b = renderHook(() => useLocalStorage<number[]>('k', []));

    act(() => a.result.current[1]((prev) => [...prev, 1]));
    act(() => b.result.current[1]((prev) => [...prev, 2]));

    expect(JSON.parse(localStorage.getItem('k')!)).toEqual([1, 2]);
    expect(a.result.current[0]).toEqual([1, 2]);
  });

  it('picks up writes from other tabs', () => {
    const a = renderHook(() => useLocalStorage<number[]>('k', []));

    act(() => {
      localStorage.setItem('k', JSON.stringify([7]));
      window.dispatchEvent(new StorageEvent('storage', { key: 'k' }));
    });

    expect(a.result.current[0]).toEqual([7]);
  });

  it('ignores other keys', () => {
    const a = renderHook(() => useLocalStorage<number[]>('k', [0]));
    const other = renderHook(() => useLocalStorage<number[]>('other', []));

    act(() => other.result.current[1]([9]));
    expect(a.result.current[0]).toEqual([0]);
  });
});

describe('market card selections share one store', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('comparison selections from separate cards accumulate', () => {
    // Each MarketCard (and the CompareBadge) owns its own hook instance.
    const cardA = renderHook(() => usePoolComparison());
    const cardB = renderHook(() => usePoolComparison());
    const badge = renderHook(() => usePoolComparison());

    act(() => cardA.result.current.toggle(1));
    act(() => cardB.result.current.toggle(2));

    expect(badge.result.current.selected).toEqual([1, 2]);
    expect(cardA.result.current.isSelected(1)).toBe(true);
    expect(cardA.result.current.isSelected(2)).toBe(true);
  });

  it('favorites from separate cards accumulate', () => {
    const cardA = renderHook(() => usePoolFavorites());
    const cardB = renderHook(() => usePoolFavorites());

    act(() => cardA.result.current.toggleFavorite(3));
    act(() => cardB.result.current.toggleFavorite(4));

    expect(cardA.result.current.favoritePoolIds).toEqual([3, 4]);
  });

  it('enforces the favorites cap', () => {
    localStorage.setItem(
      'predinex_pool_favorites_v1',
      JSON.stringify(Array.from({ length: POOL_FAVORITES_MAX }, (_, i) => i))
    );
    const { result } = renderHook(() => usePoolFavorites());
    expect(result.current.atCapacity).toBe(true);

    act(() => result.current.toggleFavorite(POOL_FAVORITES_MAX + 1));
    expect(result.current.favoritePoolIds).toHaveLength(POOL_FAVORITES_MAX);
    expect(result.current.isFavorite(POOL_FAVORITES_MAX + 1)).toBe(false);

    // Removing still works at capacity.
    act(() => result.current.toggleFavorite(0));
    expect(result.current.atCapacity).toBe(false);
  });
});

describe('useLocalStorage identity', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('keeps the same value object when a notification carries no new content', () => {
    const a = renderHook(() => useLocalStorage<{ n: number }>('obj', { n: 0 }));
    act(() => a.result.current[1]({ n: 1 }));
    const afterWrite = a.result.current[0];

    // Another instance writing identical content must not churn references.
    const b = renderHook(() => useLocalStorage<{ n: number }>('obj', { n: 0 }));
    act(() => b.result.current[1]({ n: 1 }));

    expect(a.result.current[0]).toBe(afterWrite);
  });
});
