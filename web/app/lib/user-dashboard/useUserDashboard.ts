'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useUserDashboard');

import { useState, useEffect, useCallback } from 'react';
import type { DashboardStats, UserBet } from './types';
import { calculateDashboardStats } from './model';
import { sorobanReadApi } from '../soroban-read-api';

async function fetchUserBetsFromContract(userAddress: string): Promise<UserBet[]> {
  const poolCount = await sorobanReadApi.getPoolCount();
  if (poolCount <= 0) return [];

  const bets: UserBet[] = [];

  for (let poolId = 1; poolId < poolCount; poolId++) {
    try {
      const [poolResult, betResult] = await Promise.all([
        sorobanReadApi.getPool(poolId),
        sorobanReadApi.getUserBet(poolId, userAddress),
      ]);

      const pool = poolResult.pool;
      const bet = betResult.bet;

      if (!pool || !bet || bet.totalBet === 0) continue;

      const isSettled = pool.settled;
      const winningOutcome = pool.winningOutcome;

      if (bet.amountA > 0) {
        const won = isSettled && winningOutcome === 0;
        const lost = isSettled && winningOutcome !== 0;
        bets.push({
          poolId,
          poolTitle: pool.title,
          outcome: pool.outcomeA,
          amount: bet.amountA / 1_000_000,
          status: !isSettled ? 'active' : won ? 'won' : lost ? 'lost' : 'pending',
          createdAt: Date.now(),
          winnings: won ? (bet.amountA / pool.totalA) * (pool.totalA + pool.totalB) / 1_000_000 : undefined,
        });
      }

      if (bet.amountB > 0) {
        const won = isSettled && winningOutcome === 1;
        const lost = isSettled && winningOutcome !== 1;
        bets.push({
          poolId,
          poolTitle: pool.title,
          outcome: pool.outcomeB,
          amount: bet.amountB / 1_000_000,
          status: !isSettled ? 'active' : won ? 'won' : lost ? 'lost' : 'pending',
          createdAt: Date.now(),
          winnings: won ? (bet.amountB / pool.totalB) * (pool.totalA + pool.totalB) / 1_000_000 : undefined,
        });
      }
    } catch (err) {
      log.error(`Failed to fetch bet for pool ${poolId}`, err);
    }
  }

  return bets;
}

export function useUserDashboard(isWalletConnected: boolean, sessionConnected: boolean, address?: string | null) {
  const [stats, setStats] = useState<DashboardStats>({
    totalBets: 0,
    totalWagered: 0,
    totalWinnings: 0,
    winRate: 0,
    activeBets: 0,
    settledBets: 0,
    lastUpdated: 0,
  });
  const [bets, setBets] = useState<UserBet[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchUserData = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    try {
      const userBets = await fetchUserBetsFromContract(address);
      setBets(userBets);
      setStats(calculateDashboardStats(userBets));
    } catch (err) {
      log.error('Failed to fetch user data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (sessionConnected || isWalletConnected) {
      void fetchUserData();
    }
  }, [sessionConnected, isWalletConnected, fetchUserData]);

  return {
    stats,
    bets,
    isLoading,
    fetchUserData,
  };
}
