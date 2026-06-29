import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  usePoolComparison,
  POOL_COMPARISON_STORAGE_KEY,
  POOL_COMPARISON_MAX,
} from '../../app/lib/hooks/usePoolComparison';

describe('usePoolComparison hook (#428)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('starts empty and not at capacity', () => {
    const { result } = renderHook(() => usePoolComparison());
    expect(result.current.selected).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.atCapacity).toBe(false);
    expect(result.current.isSelected(1)).toBe(false);
  });

  it('toggle adds and removes a pool id', () => {
    const { result } = renderHook(() => usePoolComparison());
    act(() => result.current.toggle(7));
    expect(result.current.selected).toEqual([7]);
    expect(result.current.isSelected(7)).toBe(true);
    act(() => result.current.toggle(7));
    expect(result.current.selected).toEqual([]);
  });

  it('cap at 4 prevents a fifth pool from being added', () => {
    const { result } = renderHook(() => usePoolComparison());
    expect(POOL_COMPARISON_MAX).toBe(4);
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(3));
    act(() => result.current.toggle(4));
    expect(result.current.count).toBe(4);
    expect(result.current.atCapacity).toBe(true);
    act(() => result.current.toggle(5));
    expect(result.current.selected).toEqual([1, 2, 3, 4]);
    expect(result.current.isSelected(5)).toBe(false);
  });

  it('remove deletes a specific pool id', () => {
    const { result } = renderHook(() => usePoolComparison());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(3));
    act(() => result.current.remove(2));
    expect(result.current.selected).toEqual([1, 3]);
  });

  it('clear empties the comparison set', () => {
    const { result } = renderHook(() => usePoolComparison());
    act(() => result.current.toggle(11));
    act(() => result.current.toggle(12));
    act(() => result.current.clear());
    expect(result.current.selected).toEqual([]);
    expect(localStorage.getItem(POOL_COMPARISON_STORAGE_KEY)).toBeNull();
  });

  it('persists selections across remounts via localStorage', () => {
    const first = renderHook(() => usePoolComparison());
    act(() => first.result.current.toggle(42));
    act(() => first.result.current.toggle(43));
    first.unmount();

    const second = renderHook(() => usePoolComparison());
    expect(second.result.current.selected).toEqual([42, 43]);
  });

  it('ignores invalid pool ids', () => {
    const { result } = renderHook(() => usePoolComparison());
    act(() => result.current.toggle(NaN));
    act(() => result.current.toggle(-1));
    expect(result.current.selected).toEqual([]);
  });
});
