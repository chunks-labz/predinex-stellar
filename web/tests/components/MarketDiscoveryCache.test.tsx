import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useMarketDiscovery } from '../../app/lib/hooks/useMarketDiscovery';
import {
  writeMarketListCache,
  MARKET_LIST_CACHE_TTL_MS
} from '../../app/lib/market-list-cache';
import type { ProcessedMarket, PoolData } from '../../app/lib/market-types';

// Mock runtime-config so read paths don't throw on a missing env var
vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'testnet',
    contract: {
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      name: 'predinex-pool',
      id: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
    },
    api: {
      coreApiUrl: 'https://api.testnet.hiro.so',
      explorerUrl: 'https://explorer.hiro.so?chain=testnet',
      rpcUrl: 'https://api.testnet.hiro.so',
    },
  })),
  __resetRuntimeConfigForTests: vi.fn(),
}));

vi.mock('../../app/lib/enhanced-stacks-api', () => ({
  fetchAllPools: vi.fn()
}));

import { fetchAllPools } from '../../app/lib/enhanced-stacks-api';

function MarketsDiscoveryHarness() {
  const { isLoading, allMarkets, blockHeightWarning } = useMarketDiscovery();
  const status = allMarkets[0]?.status ?? 'none';
  return (
    <div>
      {isLoading ? 'loading' : 'loaded'}-{allMarkets.length}-{status}
      {blockHeightWarning ? `-warn` : ''}
    </div>
  );
}

async function flushMarketDiscoveryRefresh() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Market discovery cache', () => {
  const baseNow = new Date('2026-01-01T00:00:00.000Z').getTime();

  const cachedMarket: ProcessedMarket = {
    poolId: 1,
    title: 'Cached Market',
    description: 'Cached data for first-render test.',
    outcomeA: 'A',
    outcomeB: 'B',
    totalVolume: 123,
    oddsA: 60,
    oddsB: 40,
    status: 'active',
    timeRemaining: 10,
    createdAt: 1700000000,
    settledAt: null,
    creator: 'ST123'
  };

  const poolMock: PoolData = {
    poolId: 1,
    creator: 'ST123',
    title: 'Pool title',
    description: 'Pool description',
    outcomeAName: 'A',
    outcomeBName: 'B',
    totalA: 1n,
    totalB: 1n,
    settled: false,
    winningOutcome: null,
    createdAt: 1700000000,
    settledAt: null,
    expiry: 100
  };

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseNow));

    vi.mocked(fetchAllPools).mockResolvedValue([poolMock]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses fresh cached data on first render (no loading state)', () => {
    writeMarketListCache([cachedMarket], baseNow);

    render(<MarketsDiscoveryHarness />);

    expect(screen.getByText(/loaded-1-active$/)).toBeInTheDocument();
  });

  it('treats stale cached data as invalid and refreshes (expiry is a timestamp)', async () => {
    writeMarketListCache([cachedMarket], baseNow);

    // Move time beyond TTL before render so the cache reads as stale.
    vi.setSystemTime(new Date(baseNow + MARKET_LIST_CACHE_TTL_MS + 10_000));

    render(<MarketsDiscoveryHarness />);
    expect(screen.getByText(/loading-0-none/)).toBeInTheDocument();

    // #1284 — expiry is compared against wall-clock time, so pool.expiry=100
    // (Unix seconds) is long past and the refreshed market reads as expired.
    await flushMarketDiscoveryRefresh();
    expect(screen.getByText(/loaded-1-expired/)).toBeInTheDocument();
  });

  it('surfaces a warning when a later refresh fails but markets are already on screen', async () => {
    // Phase 1: a fresh cache seeds the market list and skips the network.
    writeMarketListCache([cachedMarket], baseNow);
    vi.mocked(fetchAllPools).mockClear();

    render(<MarketsDiscoveryHarness />);
    expect(screen.getByText(/loaded-1-active$/)).toBeInTheDocument();
    expect(fetchAllPools).not.toHaveBeenCalled();

    // Phase 2: let the cache go stale and the 60s poll fire into a failure.
    vi.setSystemTime(new Date(baseNow + MARKET_LIST_CACHE_TTL_MS + 10_000));
    vi.mocked(fetchAllPools).mockRejectedValue(new Error('Network request failed'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // The cached market stays on screen and a warning banner is raised in place
    // of a hard error.
    expect(screen.getByText(/loaded-1-active-warn/)).toBeInTheDocument();
  });
});

