'use client';

import { useCallback } from 'react';
import { sorobanReadApi } from '../soroban-read-api';
import type { Pool, UserBetData } from '../stacks-api';

export function useSorobanContract() {
  const getPool = useCallback(
    async (poolId: number): Promise<Pool | null> => {
      const result = await sorobanReadApi.getPool(poolId);
      return result.pool;
    },
    []
  );

  const getPoolCount = useCallback((): Promise<number> => sorobanReadApi.getPoolCount(), []);

  const getUserBet = useCallback(
    async (poolId: number, userAddress: string): Promise<UserBetData | null> => {
      const result = await sorobanReadApi.getUserBet(poolId, userAddress);
      return result.bet;
    },
    []
  );

  const getPoolsBatch = useCallback(
    async (startId: number, count: number): Promise<Pool[]> => sorobanReadApi.getPoolsBatch(startId, count),
    []
  );

  return { getPool, getPoolCount, getUserBet, getPoolsBatch };
}
