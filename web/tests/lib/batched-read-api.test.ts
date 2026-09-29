/**
 * Tests for the batched read API layer.
 * 
 * Verifies that batching reduces RPC calls, caching works correctly,
 * and cache invalidation behaves as expected.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  batchedReadApi,
  fetchPoolsBatched,
  fetchUserBetsBatched,
  fetchUserPortfolioBatched,
  clearBatchCache,
  invalidatePoolCache,
  invalidateUserCache,
} from '@/app/lib/adapters/batched-read-api';

// Mock the predinexReadApi
vi.mock('@/app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getPool: vi.fn(),
    getUserBet: vi.fn(),
  },
}));

// Import the mocked module
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';

describe('batched-read-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBatchCache();
  });

  describe('fetchPoolsBatched', () => {
    it('should fetch multiple pools concurrently', async () => {
      const mockPools = [
        { poolId: 1, title: 'Pool 1' },
        { poolId: 2, title: 'Pool 2' },
        { poolId: 3, title: 'Pool 3' },
      ];

      vi.mocked(predinexReadApi.getPool)
        .mockResolvedValueOnce(mockPools[0] as any)
        .mockResolvedValueOnce(mockPools[1] as any)
        .mockResolvedValueOnce(mockPools[2] as any);

      const results = await fetchPoolsBatched([1, 2, 3]);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ poolId: 1, pool: mockPools[0] });
      expect(results[1]).toEqual({ poolId: 2, pool: mockPools[1] });
      expect(results[2]).toEqual({ poolId: 3, pool: mockPools[2] });
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(3);
    });

    it('should serve cached pools on second call', async () => {
      const mockPool = { poolId: 1, title: 'Pool 1' };
      vi.mocked(predinexReadApi.getPool).mockResolvedValue(mockPool as any);

      // First call - should fetch from RPC
      await fetchPoolsBatched([1]);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(1);

      // Second call - should serve from cache
      const results = await fetchPoolsBatched([1]);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(1); // No additional calls
      expect(results[0].pool).toEqual(mockPool);
    });

    it('should handle partial cache hits', async () => {
      const mockPool1 = { poolId: 1, title: 'Pool 1' };
      const mockPool3 = { poolId: 3, title: 'Pool 3' };

      vi.mocked(predinexReadApi.getPool)
        .mockResolvedValueOnce(mockPool1 as any)
        .mockResolvedValueOnce(mockPool3 as any);

      // Fetch pool 1 first (will be cached)
      await fetchPoolsBatched([1]);

      // Fetch pools 1 and 3 (1 from cache, 3 from RPC)
      const results = await fetchPoolsBatched([1, 3]);

      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(2); // 1 initial + 1 for pool 3
      expect(results).toHaveLength(2);
      expect(results[0].pool).toEqual(mockPool1);
      expect(results[1].pool).toEqual(mockPool3);
    });

    it('should handle fetch errors gracefully', async () => {
      vi.mocked(predinexReadApi.getPool)
        .mockResolvedValueOnce({ poolId: 1, title: 'Pool 1' } as any)
        .mockRejectedValueOnce(new Error('RPC error'))
        .mockResolvedValueOnce({ poolId: 3, title: 'Pool 3' } as any);

      const results = await fetchPoolsBatched([1, 2, 3]);

      expect(results).toHaveLength(3);
      expect(results[0].pool).toBeTruthy();
      expect(results[1].pool).toBeNull();
      expect(results[1].error).toBe('RPC error');
      expect(results[2].pool).toBeTruthy();
    });
  });

  describe('fetchUserBetsBatched', () => {
    const userAddress = 'GABC123';

    it('should fetch multiple user bets concurrently', async () => {
      const mockBets = [
        { poolId: 1, amountA: 100, amountB: 0 },
        { poolId: 2, amountA: 0, amountB: 200 },
        { poolId: 3, amountA: 150, amountB: 0 },
      ];

      vi.mocked(predinexReadApi.getUserBet)
        .mockResolvedValueOnce(mockBets[0] as any)
        .mockResolvedValueOnce(mockBets[1] as any)
        .mockResolvedValueOnce(mockBets[2] as any);

      const results = await fetchUserBetsBatched([1, 2, 3], userAddress);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ poolId: 1, userAddress, bet: mockBets[0] });
      expect(results[1]).toEqual({ poolId: 2, userAddress, bet: mockBets[1] });
      expect(results[2]).toEqual({ poolId: 3, userAddress, bet: mockBets[2] });
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(3);
    });

    it('should serve cached user bets on second call', async () => {
      const mockBet = { poolId: 1, amountA: 100, amountB: 0 };
      vi.mocked(predinexReadApi.getUserBet).mockResolvedValue(mockBet as any);

      // First call
      await fetchUserBetsBatched([1], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(1);

      // Second call - should serve from cache
      const results = await fetchUserBetsBatched([1], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(1); // No additional calls
      expect(results[0].bet).toEqual(mockBet);
    });

    it('should cache separately per user', async () => {
      const user1 = 'GABC123';
      const user2 = 'GXYZ789';
      const mockBet1 = { poolId: 1, amountA: 100, amountB: 0 };
      const mockBet2 = { poolId: 1, amountA: 200, amountB: 0 };

      vi.mocked(predinexReadApi.getUserBet)
        .mockResolvedValueOnce(mockBet1 as any)
        .mockResolvedValueOnce(mockBet2 as any);

      // Fetch for user1
      await fetchUserBetsBatched([1], user1);

      // Fetch for user2 - should not use user1's cache
      await fetchUserBetsBatched([1], user2);

      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchUserPortfolioBatched', () => {
    const userAddress = 'GABC123';

    it('should fetch pools and user bets concurrently', async () => {
      const mockPool = { poolId: 1, title: 'Pool 1' };
      const mockBet = { poolId: 1, amountA: 100, amountB: 0 };

      vi.mocked(predinexReadApi.getPool).mockResolvedValue(mockPool as any);
      vi.mocked(predinexReadApi.getUserBet).mockResolvedValue(mockBet as any);

      const { pools, userBets } = await fetchUserPortfolioBatched([1], userAddress);

      expect(pools).toHaveLength(1);
      expect(userBets).toHaveLength(1);
      expect(pools[0].pool).toEqual(mockPool);
      expect(userBets[0].bet).toEqual(mockBet);

      // Should be called concurrently (both mocks called)
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(1);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(1);
    });

    it('should batch multiple pools efficiently', async () => {
      const mockPools = [
        { poolId: 1, title: 'Pool 1' },
        { poolId: 2, title: 'Pool 2' },
      ];
      const mockBets = [
        { poolId: 1, amountA: 100, amountB: 0 },
        { poolId: 2, amountA: 0, amountB: 200 },
      ];

      vi.mocked(predinexReadApi.getPool)
        .mockResolvedValueOnce(mockPools[0] as any)
        .mockResolvedValueOnce(mockPools[1] as any);

      vi.mocked(predinexReadApi.getUserBet)
        .mockResolvedValueOnce(mockBets[0] as any)
        .mockResolvedValueOnce(mockBets[1] as any);

      const { pools, userBets } = await fetchUserPortfolioBatched([1, 2], userAddress);

      expect(pools).toHaveLength(2);
      expect(userBets).toHaveLength(2);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(2);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(2);
    });
  });

  describe('cache invalidation', () => {
    const userAddress = 'GABC123';

    it('should invalidate pool cache and force refresh', async () => {
      const mockPool = { poolId: 1, title: 'Pool 1' };
      vi.mocked(predinexReadApi.getPool).mockResolvedValue(mockPool as any);

      // First fetch
      await fetchPoolsBatched([1]);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(1);

      // Second fetch - should use cache
      await fetchPoolsBatched([1]);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidatePoolCache(1);

      // Third fetch - should fetch again
      await fetchPoolsBatched([1]);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all user bets for a pool', async () => {
      const mockBet = { poolId: 1, amountA: 100, amountB: 0 };
      vi.mocked(predinexReadApi.getUserBet).mockResolvedValue(mockBet as any);

      // Fetch user bet
      await fetchUserBetsBatched([1], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(1);

      // Invalidate pool cache (should also invalidate user bets)
      invalidatePoolCache(1);

      // Fetch again - should refresh
      await fetchUserBetsBatched([1], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(2);
    });

    it('should invalidate all user cache entries', async () => {
      const mockBet = { poolId: 1, amountA: 100, amountB: 0 };
      vi.mocked(predinexReadApi.getUserBet).mockResolvedValue(mockBet as any);

      // Fetch user bets for multiple pools
      await fetchUserBetsBatched([1, 2, 3], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(3);

      // Invalidate all user cache
      invalidateUserCache(userAddress);

      // Fetch again - should refresh all
      await fetchUserBetsBatched([1, 2, 3], userAddress);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(6);
    });

    it('should clear entire cache', async () => {
      const mockPool = { poolId: 1, title: 'Pool 1' };
      const mockBet = { poolId: 1, amountA: 100, amountB: 0 };

      vi.mocked(predinexReadApi.getPool).mockResolvedValue(mockPool as any);
      vi.mocked(predinexReadApi.getUserBet).mockResolvedValue(mockBet as any);

      // Fetch both
      await fetchPoolsBatched([1]);
      await fetchUserBetsBatched([1], userAddress);

      // Clear entire cache
      clearBatchCache();

      // Fetch again - should refresh both
      await fetchPoolsBatched([1]);
      await fetchUserBetsBatched([1], userAddress);

      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(2);
      expect(predinexReadApi.getUserBet).toHaveBeenCalledTimes(2);
    });
  });

  describe('performance characteristics', () => {
    it('should demonstrate RPC call reduction', async () => {
      const poolCount = 10;
      const poolIds = Array.from({ length: poolCount }, (_, i) => i + 1);

      vi.mocked(predinexReadApi.getPool).mockImplementation(
        async (poolId) => ({ poolId, title: `Pool ${poolId}` }) as any
      );

      // Batched fetch
      await fetchPoolsBatched(poolIds);

      // Should make exactly poolCount calls (all concurrent)
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(poolCount);

      // Second batch fetch should make 0 additional calls (all cached)
      vi.clearAllMocks();
      await fetchPoolsBatched(poolIds);
      expect(predinexReadApi.getPool).toHaveBeenCalledTimes(0);
    });
  });
});
