/**
 * Liquidity Incentives System
 * Rewards early bettors to bootstrap pools
 */

export interface IncentiveConfig {
  earlyBirdBonus: number; // Percentage bonus for first bettors
  volumeThreshold: number; // Volume needed to unlock bonuses
  timeWindow: number; // Time window in blocks for early bird bonus
  maxBonusPerBet: number; // Maximum bonus per bet in STX
  referralBonus: number; // Bonus for referrals
}

export interface BetterIncentive {
  betterId: string;
  poolId: number;
  betAmount: number;
  bonusAmount: number;
  bonusType: 'early-bird' | 'volume' | 'referral' | 'loyalty';
  claimedAt?: number;
  status: 'pending' | 'claimed' | 'expired';
}

export interface PoolIncentiveStats {
  poolId: number;
  totalIncentivesDistributed: number;
  earlyBirdBonusesGiven: number;
  volumeBonusesGiven: number;
  referralBonusesGiven: number;
  loyaltyBonusesGiven: number;
  totalBettersRewarded: number;
}

// Default incentive configuration
export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = {
  earlyBirdBonus: 5, // 5% bonus for first 10 bettors
  volumeThreshold: 1000, // 1000 STX volume threshold
  timeWindow: 144, // 24 hours in blocks
  maxBonusPerBet: 100, // Max 100 STX bonus
  referralBonus: 2, // 2% referral bonus
};

/**
 * Calculate early bird bonus
 * Rewards first bettors in a pool
 */
export function calculateEarlyBirdBonus(
  betAmount: number,
  betPosition: number,
  config: IncentiveConfig
): number {
  // Only first 10 bettors get early bird bonus
  if (betPosition > 10) return 0;

  const bonus = (betAmount * config.earlyBirdBonus) / 100;
  return Math.min(bonus, config.maxBonusPerBet);
}

/**
 * Calculate volume bonus
 * Rewards bettors when pool reaches volume threshold
 */
export function calculateVolumeBonus(
  betAmount: number,
  poolVolume: number,
  config: IncentiveConfig
): number {
  if (poolVolume < config.volumeThreshold) return 0;

  // 2% bonus when volume threshold is reached
  const bonus = (betAmount * 2) / 100;
  return Math.min(bonus, config.maxBonusPerBet);
}

/**
 * Calculate referral bonus
 * Rewards bettors who refer others
 */
export function calculateReferralBonus(
  referredBetAmount: number,
  config: IncentiveConfig
): number {
  const bonus = (referredBetAmount * config.referralBonus) / 100;
  return Math.min(bonus, config.maxBonusPerBet);
}

/**
 * Calculate loyalty bonus
 * Rewards repeat bettors
 */
export function calculateLoyaltyBonus(
  betAmount: number,
  previousBetsCount: number,
  config: IncentiveConfig
): number {
  // 0.5% bonus per previous bet, max 5%
  const bonusPercentage = Math.min(previousBetsCount * 0.5, 5);
  const bonus = (betAmount * bonusPercentage) / 100;
  return Math.min(bonus, config.maxBonusPerBet);
}

/**
 * Calculate total incentive for a bet
 */
export function calculateTotalIncentive(
  betAmount: number,
  betPosition: number,
  poolVolume: number,
  previousBetsCount: number,
  config: IncentiveConfig
): { total: number; breakdown: Record<string, number> } {
  const earlyBird = calculateEarlyBirdBonus(betAmount, betPosition, config);
  const volume = calculateVolumeBonus(betAmount, poolVolume, config);
  const loyalty = calculateLoyaltyBonus(betAmount, previousBetsCount, config);

  return {
    total: earlyBird + volume + loyalty,
    breakdown: {
      earlyBird,
      volume,
      loyalty,
    },
  };
}

/**
 * Check if bet qualifies for early bird bonus
 */
export function isEarlyBirdEligible(betPosition: number): boolean {
  return betPosition <= 10;
}

/**
 * Check if pool qualifies for volume bonus
 */
export function isVolumeBonusEligible(
  poolVolume: number,
  config: IncentiveConfig
): boolean {
  return poolVolume >= config.volumeThreshold;
}

/**
 * Format incentive amount
 */
export function formatIncentive(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Get incentive description
 */
export function getIncentiveDescription(bonusType: string): string {
  switch (bonusType) {
    case 'early-bird':
      return 'Early Bird Bonus - Reward for being among first bettors';
    case 'volume':
      return 'Volume Bonus - Reward when pool reaches volume threshold';
    case 'referral':
      return 'Referral Bonus - Reward for referring other bettors';
    case 'loyalty':
      return 'Loyalty Bonus - Reward for repeat betting';
    default:
      return 'Incentive Bonus';
  }
}
