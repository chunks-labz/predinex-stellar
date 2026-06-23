'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DashboardStats, UserBet } from './types';
import { calculateDashboardStats, getMockUserBets } from './model';

export function useUserDashboard(isWalletConnected: boolean, sessionConnected: boolean) {
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
    setIsLoading(true);
    try {
      const mockBets = getMockUserBets();
      setBets(mockBets);
      setStats(calculateDashboardStats(mockBets));
    } catch (err) {
      console.error('Failed to fetch user data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
