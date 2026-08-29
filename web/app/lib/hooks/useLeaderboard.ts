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

// Mock data — replace with on-chain event queries when indexer is available.
const MOCK_BETTORS: Omit<BettorEntry, 'rank'>[] = [
  { address: 'GBETTOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 12_500_000, wins: 32, totalPredictions: 47, winPercentage: 68.1 },
  { address: 'GBETTOR2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 9_800_000, wins: 23, totalPredictions: 32, winPercentage: 71.9 },
  { address: 'GBETTOR3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 7_200_000, wins: 18, totalPredictions: 28, winPercentage: 64.3 },
  { address: 'GBETTOR4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 6_500_000, wins: 32, totalPredictions: 55, winPercentage: 58.2 },
  { address: 'GBETTOR5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 6_100_000, wins: 15, totalPredictions: 19, winPercentage: 78.9 },
  { address: 'GBETTOR6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 5_800_000, wins: 25, totalPredictions: 41, winPercentage: 61.0 },
  { address: 'GBETTOR7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 4_500_000, wins: 16, totalPredictions: 23, winPercentage: 69.6 },
  { address: 'GBETTOR8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 3_200_000, wins: 20, totalPredictions: 36, winPercentage: 55.6 },
  { address: 'GBETTOR9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 2_800_000, wins: 11, totalPredictions: 15, winPercentage: 73.3 },
  { address: 'GBETTOR10AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalVolume: 1_500_000, wins: 15, totalPredictions: 29, winPercentage: 51.7 },
];

const MOCK_CREATORS: Omit<CreatorEntry, 'rank'>[] = [
  { address: 'GCREATOR1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 24, totalVolume: 45_000_000 },
  { address: 'GCREATOR2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 18, totalVolume: 32_000_000 },
  { address: 'GCREATOR3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 15, totalVolume: 28_000_000 },
  { address: 'GCREATOR4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 12, totalVolume: 21_000_000 },
  { address: 'GCREATOR5AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 10, totalVolume: 18_500_000 },
  { address: 'GCREATOR6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 9, totalVolume: 15_000_000 },
  { address: 'GCREATOR7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 7, totalVolume: 11_000_000 },
  { address: 'GCREATOR8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 6, totalVolume: 8_500_000 },
  { address: 'GCREATOR9AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 4, totalVolume: 5_200_000 },
  { address: 'GCREATOR10AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', totalPools: 3, totalVolume: 2_800_000 },
];

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
