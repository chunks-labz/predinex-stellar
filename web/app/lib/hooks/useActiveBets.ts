'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useActiveBets');

import { useState, useCallback } from 'react';
import { UserBet } from '../dashboard-types';
import { getUserBets } from '../dashboard-api';
import { userDashboardCache } from '../cache-invalidation';
import { useVisibilityAwarePolling } from './useVisibilityAwarePolling';

const REFRESH_INTERVAL_MS = 60_000;

interface UseActiveBetsReturn {
  activeBets: UserBet[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches the current user's positions used by the dashboard "Active Bets"
 * card, including settled claimable winners.
 */
export function useActiveBets(userAddress: string | null | undefined): UseActiveBetsReturn {
  const [activeBets, setActiveBets] = useState<UserBet[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBets = useCallback(async () => {
    if (!userAddress) {
      setActiveBets([]);
      return;
    }

    const cached = userDashboardCache.get<UserBet[]>(userAddress);
    if (cached) {
      setActiveBets(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const bets = await getUserBets(userAddress);
      setActiveBets(bets);
      userDashboardCache.set(userAddress, bets, REFRESH_INTERVAL_MS);
    } catch (e) {
      setError('Failed to load active positions. Please try again.');
      log.error('useActiveBets error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  useVisibilityAwarePolling(fetchBets, REFRESH_INTERVAL_MS, {
    enabled: !!userAddress,
  });

  return { activeBets, isLoading, error, refresh: fetchBets };
}
