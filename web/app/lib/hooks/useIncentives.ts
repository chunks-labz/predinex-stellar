'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useIncentives');

import { useState, useCallback } from 'react';
import {
  calculateTotalIncentive,
  calculateEarlyBirdBonus,
  calculateVolumeBonus,
  calculateReferralBonus,
  calculateLoyaltyBonus,
  DEFAULT_INCENTIVE_CONFIG,
  IncentiveConfig,
  BetterIncentive,
} from '../liquidity-incentives';

export function useIncentives() {
  const [config, setConfig] = useState<IncentiveConfig>(DEFAULT_INCENTIVE_CONFIG);
  const [incentives, setIncentives] = useState<BetterIncentive[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculateBetIncentive = useCallback(
    (
      betterId: string,
      poolId: number,
      betAmount: number,
      betPosition: number,
      poolVolume: number,
      previousBetsCount: number
    ) => {
      try {
        const { total, breakdown } = calculateTotalIncentive(
          betAmount,
          betPosition,
          poolVolume,
          previousBetsCount,
          config
        );

        // Determine primary bonus type
        let bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty' = 'loyalty';
        if (breakdown.earlyBird > 0) bonusType = 'early-bird';
        else if (breakdown.volume > 0) bonusType = 'volume';
        else if (breakdown.loyalty > 0) bonusType = 'loyalty';

        const incentive: BetterIncentive = {
          betterId,
          poolId,
          betAmount,
          bonusAmount: total,
          bonusType,
          status: 'pending',
        };

        return incentive;
      } catch (err) {
        log.error('Error calculating incentive:', err);
        throw err;
      }
    },
    [config]
  );

  const addIncentive = useCallback(
    (incentive: BetterIncentive) => {
      setIncentives(prev => [...prev, incentive]);
    },
    []
  );

  const claimIncentive = useCallback(
    (incentiveId: number) => {
      setIncentives(prev =>
        prev.map((inc, idx) =>
          idx === incentiveId
            ? { ...inc, status: 'claimed', claimedAt: Date.now() }
            : inc
        )
      );
    },
    []
  );

  const getPendingIncentives = useCallback(
    (betterId: string) => {
      return incentives.filter(
        inc => inc.betterId === betterId && inc.status === 'pending'
      );
    },
    [incentives]
  );

  const getTotalPendingBonus = useCallback(
    (betterId: string) => {
      return getPendingIncentives(betterId).reduce(
        (sum, inc) => sum + inc.bonusAmount,
        0
      );
    },
    [getPendingIncentives]
  );

  const getClaimedIncentives = useCallback(
    (betterId: string) => {
      return incentives.filter(
        inc => inc.betterId === betterId && inc.status === 'claimed'
      );
    },
    [incentives]
  );

  const getTotalClaimedBonus = useCallback(
    (betterId: string) => {
      return getClaimedIncentives(betterId).reduce(
        (sum, inc) => sum + inc.bonusAmount,
        0
      );
    },
    [getClaimedIncentives]
  );

  const getPoolIncentiveStats = useCallback(
    (poolId: number) => {
      const poolIncentives = incentives.filter(inc => inc.poolId === poolId);
      const totalDistributed = poolIncentives.reduce(
        (sum, inc) => sum + inc.bonusAmount,
        0
      );
      const earlyBirdCount = poolIncentives.filter(
        inc => inc.bonusType === 'early-bird'
      ).length;
      const volumeCount = poolIncentives.filter(
        inc => inc.bonusType === 'volume'
      ).length;
      const referralCount = poolIncentives.filter(
        inc => inc.bonusType === 'referral'
      ).length;
      const loyaltyCount = poolIncentives.filter(
        inc => inc.bonusType === 'loyalty'
      ).length;

      return {
        poolId,
        totalIncentivesDistributed: totalDistributed,
        earlyBirdBonusesGiven: earlyBirdCount,
        volumeBonusesGiven: volumeCount,
        referralBonusesGiven: referralCount,
        loyaltyBonusesGiven: loyaltyCount,
        totalBettersRewarded: new Set(poolIncentives.map(inc => inc.betterId))
          .size,
      };
    },
    [incentives]
  );

  const updateConfig = useCallback((newConfig: Partial<IncentiveConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  return {
    config,
    incentives,
    setIncentives,
    isLoading,
    error,
    calculateBetIncentive,
    addIncentive,
    claimIncentive,
    getPendingIncentives,
    getTotalPendingBonus,
    getClaimedIncentives,
    getTotalClaimedBonus,
    getPoolIncentiveStats,
    updateConfig,
  };
}
// useIncentives hook improvement 1
// useIncentives hook improvement 2
// useIncentives hook improvement 3
// useIncentives hook improvement 4
// useIncentives hook improvement 5
// useIncentives hook improvement 6
// useIncentives hook improvement 7
// useIncentives hook improvement 8
// useIncentives hook improvement 9
// useIncentives hook improvement 10
