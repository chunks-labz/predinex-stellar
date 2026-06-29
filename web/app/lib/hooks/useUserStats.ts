'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useUserStats');

import { useState, useCallback } from 'react';

export interface UserBet {
  poolId: number;
  poolTitle: string;
  outcome: string;
  amount: number;
  status: 'active' | 'won' | 'lost' | 'pending';
  createdAt: number;
  winnings?: number;
}

export interface UserStats {
  totalBets: number;
  totalWagered: number;
  totalWinnings: number;
  winRate: number;
  activeBets: number;
  settledBets: number;
}

export function useUserStats() {
  const [stats, setStats] = useState<UserStats>({
    totalBets: 0,
    totalWagered: 0,
    totalWinnings: 0,
    winRate: 0,
    activeBets: 0,
    settledBets: 0,
  });
  const [bets, setBets] = useState<UserBet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculateStats = useCallback((userBets: UserBet[]) => {
    const totalBets = userBets.length;
    const totalWagered = userBets.reduce((sum, bet) => sum + bet.amount, 0);
    const wonBets = userBets.filter(bet => bet.status === 'won');
    const totalWinnings = wonBets.reduce((sum, bet) => sum + (bet.winnings || 0), 0);
    const winRate = totalBets > 0 ? (wonBets.length / totalBets) * 100 : 0;
    const activeBets = userBets.filter(bet => bet.status === 'active').length;
    const settledBets = userBets.filter(bet => bet.status !== 'active').length;

    setStats({
      totalBets,
      totalWagered,
      totalWinnings,
      winRate: Math.round(winRate),
      activeBets,
      settledBets,
    });
  }, []);

  const fetchUserBets = useCallback(async (userAddress: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // In production, fetch from API
      // const response = await fetch(`/api/user/${userAddress}/bets`);
      // const data = await response.json();
      // setBets(data);
      // calculateStats(data);

      // Mock data for now
      const mockBets: UserBet[] = [];
      setBets(mockBets);
      calculateStats(mockBets);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch user bets';
      setError(message);
      log.error('Error fetching user bets:', err);
    } finally {
      setIsLoading(false);
    }
  }, [calculateStats]);

  const refreshStats = useCallback(async (userAddress: string) => {
    await fetchUserBets(userAddress);
  }, [fetchUserBets]);

  return {
    stats,
    bets,
    isLoading,
    error,
    fetchUserBets,
    refreshStats,
    calculateStats,
  };
}
