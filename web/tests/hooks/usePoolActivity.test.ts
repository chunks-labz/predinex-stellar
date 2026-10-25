import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePoolActivity, clearPoolActivityCache } from '../../app/hooks/usePoolActivity';

const mockFetch = vi.fn();

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: () => ({
    soroban: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      contractId: 'CCONTRACT1234567890',
    },
  }),
}));

function createRawEvent(index: number, poolId: number = 1): any {
  return {
    id: `evt-${index}`,
    pagingToken: `token-${index}`,
    ledgerClosedAt: new Date(1700000000000 + index * 1000).toISOString(),
    ledger: 100 + index,
    txHash: `0xtx-${index}`,
    topic: ['place_bet', 'v1', poolId, 'GUSER123'],
    value: [0, 1000 + index],
  };
}

describe('usePoolActivity pagination & loadMore', () => {
  beforeEach(() => {
    clearPoolActivityCache();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches initial events and sets hasMore when 100 raw events returned', async () => {
    const rawEvents = Array.from({ length: 100 }, (_, i) => createRawEvent(i + 1, 1));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          events: rawEvents,
          cursor: 'cursor-token-100',
        },
      }),
    });

    const { result } = renderHook(() => usePoolActivity(1));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.events).toHaveLength(100);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('loadMore fetches second page with cursor and appends events up to MAX_EVENTS (200)', async () => {
    const page1Raw = Array.from({ length: 100 }, (_, i) => createRawEvent(i + 1, 1));
    const page2Raw = Array.from({ length: 100 }, (_, i) => createRawEvent(i + 101, 1));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            events: page1Raw,
            cursor: 'cursor-page-1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            events: page2Raw,
            cursor: 'cursor-page-2',
          },
        }),
      });

    const { result } = renderHook(() => usePoolActivity(1));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.events).toHaveLength(100);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondCallBody.params.pagination).toEqual({
      limit: 100,
      cursor: 'cursor-page-1',
    });

    expect(result.current.events).toHaveLength(200);
    // Capped at MAX_EVENTS (200) so hasMore must be false
    expect(result.current.hasMore).toBe(false);
  });

  it('sets hasMore to false when second page returns fewer raw events than limit', async () => {
    const page1Raw = Array.from({ length: 100 }, (_, i) => createRawEvent(i + 1, 1));
    const page2Raw = Array.from({ length: 30 }, (_, i) => createRawEvent(i + 101, 1));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            events: page1Raw,
            cursor: 'cursor-page-1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            events: page2Raw,
            cursor: 'cursor-page-2',
          },
        }),
      });

    const { result } = renderHook(() => usePoolActivity(1));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.events).toHaveLength(130);
    expect(result.current.hasMore).toBe(false);
  });

  it('handles error in loadMore gracefully', async () => {
    const page1Raw = Array.from({ length: 100 }, (_, i) => createRawEvent(i + 1, 1));

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          result: {
            events: page1Raw,
            cursor: 'cursor-page-1',
          },
        }),
      })
      .mockRejectedValueOnce(new Error('Network error on loadMore'));

    const { result } = renderHook(() => usePoolActivity(1));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('Network error on loadMore');
    expect(result.current.events).toHaveLength(100);
    expect(result.current.isLoading).toBe(false);
  });
});
