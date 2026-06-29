import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserActivity } from '../../app/hooks/useUserActivity';

const { mockGetUserActivitySoroban } = vi.hoisted(() => ({
  mockGetUserActivitySoroban: vi.fn(),
}));

const { mockUserActivityCacheGet, mockUserActivityCacheClear } = vi.hoisted(() => ({
  mockUserActivityCacheGet: vi.fn(),
  mockUserActivityCacheClear: vi.fn(),
}));

vi.mock('../../app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getUserActivitySoroban: mockGetUserActivitySoroban,
  },
}));

vi.mock('../../app/lib/cache-invalidation', () => ({
  userActivityCache: {
    get: mockUserActivityCacheGet,
    set: vi.fn(),
    clear: mockUserActivityCacheClear,
    delete: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

describe('useUserActivity polling visibility policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetUserActivitySoroban.mockReset();
    mockUserActivityCacheGet.mockReset();
    mockUserActivityCacheClear.mockReset();
    setDocumentHidden(false);
    mockUserActivityCacheGet.mockReturnValue(undefined);
    mockGetUserActivitySoroban.mockResolvedValue([
      {
        type: 'bet-placed',
        txId: '0xactivity-1',
        functionName: 'place-bet',
        timestamp: Date.now(),
        status: 'success',
        amount: 10,
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/0xactivity-1',
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses activity polling while hidden and resumes when visible again', async () => {
    const { result } = renderHook(() => useUserActivity('ST123', 5));

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(1);
    expect(result.current.activities).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(2);

    setDocumentHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(2);

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(4);
  });

  it('ignores stale activity responses after parameters change', async () => {
    const first = deferred<any[]>();
    const second = deferred<any[]>();
    mockGetUserActivitySoroban
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ address }) => useUserActivity(address, 5),
      { initialProps: { address: 'ST123' } }
    );

    rerender({ address: 'ST456' });

    await act(async () => {
      second.resolve([
        {
          type: 'bet-placed',
          txId: 'new',
          functionName: 'place-bet',
          timestamp: Date.now(),
          status: 'success',
          amount: 20,
          explorerUrl: 'https://stellar.expert/explorer/testnet/tx/new',
        },
      ]);
      await Promise.resolve();
    });

    await act(async () => {
      first.resolve([
        {
          type: 'bet-placed',
          txId: 'old',
          functionName: 'place-bet',
          timestamp: Date.now(),
          status: 'success',
          amount: 10,
          explorerUrl: 'https://stellar.expert/explorer/testnet/tx/old',
        },
      ]);
      await Promise.resolve();
    });

    expect(result.current.activities[0]?.txId).toBe('new');
  });
});
