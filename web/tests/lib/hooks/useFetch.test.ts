import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFetch } from '@/app/lib/hooks/useFetch';
import { cache } from '@/app/lib/cache';

describe('useFetch', () => {
  beforeEach(() => {
    cache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes an AbortSignal to fetch and aborts it on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise(() => {
        // never resolves — simulates an in-flight request
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useFetch('/api/pools'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not update state after unmount when the fetch resolves late', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(() => {
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() =>
      useFetch('/api/pools', { onSuccess, cacheKey: 'unmount-late' })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    unmount();

    resolveFetch({
      ok: true,
      json: async () => ({ data: 'late' }),
    } as Response);

    await new Promise((r) => setTimeout(r, 0));

    // State snapshot from before unmount should remain untouched.
    expect(result.current.loading).toBe(true);
  });

  it('silently swallows AbortError without setting the error state', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetchMock = vi.fn(() => Promise.reject(abortError));
    vi.stubGlobal('fetch', fetchMock);

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useFetch('/api/pools', { onError, cacheKey: 'abort-swallow', immediate: false })
    );

    await result.current.fetch();

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
