import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMarketDiscovery } from '../../app/lib/hooks/useMarketDiscovery';

const { mockWarmMarketListCache } = vi.hoisted(() => ({
  mockWarmMarketListCache: vi.fn(),
}));

vi.mock('../../app/lib/market-list-cache', () => ({
  readMarketListCache: vi.fn(() => ({ markets: [], isFresh: false })),
  readBlockHeightWarning: vi.fn(() => null),
  warmMarketListCache: mockWarmMarketListCache,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function market(poolId: number, title: string) {
  return {
    poolId,
    title,
    description: 'Market refresh test',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalVolume: 100,
    oddsA: 50,
    oddsB: 50,
    status: 'active',
    timeRemaining: 10,
    createdAt: 1700000000,
    settledAt: null,
    creator: 'ST123',
  };
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });

  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

describe('useMarketDiscovery polling visibility policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWarmMarketListCache.mockReset();
    setDocumentHidden(false);
    mockWarmMarketListCache.mockResolvedValue([market(1, 'Visible market')]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses market polling while hidden and resumes when visible again', async () => {
    const { result } = renderHook(() => useMarketDiscovery());

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockWarmMarketListCache).toHaveBeenCalledTimes(1);
    expect(result.current.allMarkets).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockWarmMarketListCache).toHaveBeenCalledTimes(2);

    setDocumentHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(mockWarmMarketListCache).toHaveBeenCalledTimes(2);

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockWarmMarketListCache).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockWarmMarketListCache).toHaveBeenCalledTimes(4);
  });

  it('ignores stale market responses when a newer refresh finishes first', async () => {
    const first = deferred<any[]>();
    const second = deferred<any[]>();
    mockWarmMarketListCache
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useMarketDiscovery());

    act(() => {
      result.current.retry();
    });

    await act(async () => {
      second.resolve([market(2, 'New market')]);
      await Promise.resolve();
    });

    await act(async () => {
      first.resolve([market(1, 'Old market')]);
      await Promise.resolve();
    });

    expect(result.current.allMarkets).toHaveLength(1);
    expect(result.current.allMarkets[0]?.poolId).toBe(2);
  });
});
