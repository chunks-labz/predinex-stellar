'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useLeaderboard');

import { useState, useEffect, useCallback } from 'react';

export type LeaderboardTab = 'bettors' | 'creators';

export interface BettorEntry {
  address: string;
  rank: number;
  totalVolume: number;
  wins: number;
  totalPredictions: number;
  winPercentage: number;
}

export interface CreatorEntry {
  address: string;
  rank: number;
  totalPools: number;
  totalVolume: number;
}

export interface UseLeaderboardReturn {
  bettors: BettorEntry[];
  creators: CreatorEntry[];
  userBettorRank: number | null;
  userCreatorRank: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// Empty leaderboards until on-chain event queries are available via indexer.
const MOCK_BETTORS: Omit<BettorEntry, 'rank'>[] = [];
const MOCK_CREATORS: Omit<CreatorEntry, 'rank'>[] = [];

export function useLeaderboard(currentUserAddress?: string | null): UseLeaderboardReturn {
  const [bettors, setBettors] = useState<BettorEntry[]>([]);
  const [creators, setCreators] = useState<CreatorEntry[]>([]);
  const [userBettorRank, setUserBettorRank] = useState<number | null>(null);
  const [userCreatorRank, setUserCreatorRank] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));

      // Build bettors list (top 100 by volume)
      const bettorData = [...MOCK_BETTORS];
      if (currentUserAddress && !bettorData.find((e) => e.address === currentUserAddress)) {
        bettorData.push({ address: currentUserAddress, totalVolume: 850_000, wins: 7, totalPredictions: 12, winPercentage: 58.3 });
      }
      const rankedBettors: BettorEntry[] = bettorData
        .sort((a, b) => b.totalVolume - a.totalVolume)
        .slice(0, 100)
        .map((e, i) => ({ ...e, rank: i + 1 }));

      // Build creators list (top 100 by volume)
      const creatorData = [...MOCK_CREATORS];
      if (currentUserAddress && !creatorData.find((e) => e.address === currentUserAddress)) {
        creatorData.push({ address: currentUserAddress, totalPools: 1, totalVolume: 200_000 });
      }
      const rankedCreators: CreatorEntry[] = creatorData
        .sort((a, b) => b.totalVolume - a.totalVolume)
        .slice(0, 100)
        .map((e, i) => ({ ...e, rank: i + 1 }));

      setBettors(rankedBettors);
      setCreators(rankedCreators);

      if (currentUserAddress) {
        setUserBettorRank(rankedBettors.find((e) => e.address === currentUserAddress)?.rank ?? null);
        setUserCreatorRank(rankedCreators.find((e) => e.address === currentUserAddress)?.rank ?? null);
      }
    } catch (e) {
      log.error('useLeaderboard error:', e);
      setError('Failed to load leaderboard. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUserAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bettors, creators, userBettorRank, userCreatorRank, isLoading, error, refresh: load };
}
