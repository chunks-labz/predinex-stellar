/**
 * Dashboard utility functions for calculations, data processing, and formatting.
 * These helpers support the portfolio overview, market statistics, and platform metrics.
 */

import { UserBet, BetHistory, UserPortfolio, MarketStatistics, PlatformMetrics } from './dashboard-types';
import { PoolData } from './market-types';
import { getCurrentBlockHeight } from './market-utils';

/**
 * Calculates a consolidated user portfolio from a list of user bets.
 * Aggregates total wagered, total winnings, claimable amounts, and win rate.
 * 
 * @param bets - Array of user bets to analyze
 * @returns An object containing aggregated portfolio metrics
 */
export function calculatePortfolio(bets: UserBet[]): UserPortfolio {
  const activeBets = bets.filter(bet => bet.status === 'active');
  const settledBets = bets.filter(bet => bet.status !== 'active');

  const totalWagered = bets.reduce((sum, bet) => sum + bet.amountBet, 0);
  const totalWinnings = settledBets
    .filter(bet => bet.status === 'won')
    .reduce((sum, bet) => sum + (bet.actualWinnings || 0), 0);

  const totalClaimable = bets
    .filter(bet => bet.claimStatus === 'unclaimed')
    .reduce((sum, bet) => sum + (bet.claimableAmount || 0), 0);

  const profitLoss = totalWinnings - totalWagered;
  const winRate = settledBets.length > 0
    ? (settledBets.filter(bet => bet.status === 'won').length / settledBets.length) * 100
    : 0;

  return {
    totalBets: bets.length,
    activeBets: activeBets.length,
    totalWagered,
    totalWinnings,
    totalClaimable,
    profitLoss,
    winRate
  };
}

/**
 * Calculates potential profit for a new bet based on current pool distributions.
 * Uses the Parimutuel betting model: winnings are proportional to your share of the winning pool.
 * 
 * @param betAmount - The amount being wagered in micro-STX
 * @param totalPoolA - Total amount already bet on outcome A
 * @param totalPoolB - Total amount already bet on outcome B
 * @param chosenOutcome - The side the user is betting on ('A' or 'B')
 * @returns The estimated profit (total payout minus bet amount)
 */
export function calculatePotentialWinnings(
  betAmount: bigint,
  totalPoolA: bigint,
  totalPoolB: bigint,
  chosenOutcome: 'A' | 'B'
): number {
  const totalPool = Number(totalPoolA + totalPoolB);
  if (totalPool === 0) return Number(betAmount);

  const winningPool = chosenOutcome === 'A' ? Number(totalPoolA) : Number(totalPoolB);
  const losingPool = chosenOutcome === 'A' ? Number(totalPoolB) : Number(totalPoolA);

  if (winningPool === 0) return totalPool;

  const b = Number(betAmount);
  const userShare = b / (winningPool + b);
  const winnings = b + (losingPool * userShare);

  return Math.max(0, winnings - b);
}

/**
 * Calculates the exact winnings for a specific bet after an outcome has been determined.
 * 
 * @param betAmount - The initial wager amount
 * @param totalPoolA - Final pool size for outcome A
 * @param totalPoolB - Final pool size for outcome B
 * @param chosenOutcome - The outcome the user bet on
 * @param winningOutcome - The final determined outcome
 * @returns Total STX to be returned (principal + profit) or 0 if lost
 */
export function calculateActualWinnings(
  betAmount: bigint,
  totalPoolA: bigint,
  totalPoolB: bigint,
  chosenOutcome: 'A' | 'B',
  winningOutcome: 'A' | 'B'
): number {
  if (chosenOutcome !== winningOutcome) return 0;

  const totalPool = Number(totalPoolA + totalPoolB);
  const winningPool = winningOutcome === 'A' ? Number(totalPoolA) : Number(totalPoolB);

  if (winningPool === 0) return 0;

  const b = Number(betAmount);
  const userShare = b / winningPool;
  const totalWinnings = totalPool * userShare;

  return Math.max(0, totalWinnings);
}

/**
 * Helper to check if a bet is won and hasn't been claimed yet.
 * 
 * @param bet - The bet object to verify
 * @returns True if the user can initiate a claim transaction
 */
export function isClaimEligible(bet: UserBet): boolean {
  return bet.status === 'won' && bet.claimStatus === 'unclaimed' && (bet.claimableAmount || 0) > 0;
}

/**
 * Calculates the net profit or loss for a completed bet.
 * 
 * @param bet - The historical bet data
 * @returns Net change in STX (positive for profit, negative for loss)
 */
export function calculateBetProfitLoss(bet: BetHistory): number {
  if (bet.status === 'active') return 0;
  if (bet.status === 'won') return (bet.actualWinnings || 0) - bet.amountBet;
  return -bet.amountBet; // Lost or expired
}

/**
 * Transforms raw smart contract pool data into enriched market statistics for the UI.
 * Handles block height logic to determine if a market is active, expired, or settled.
 * 
 * @param pools - Raw pool data from the API
 * @returns Enriched market statistics including odds and computed status
 */
export function processMarketStatistics(pools: PoolData[]): MarketStatistics[] {
  const currentBlockHeight = getCurrentBlockHeight();

  return pools.map(pool => {
    const totalVolume = Number(pool.totalA + pool.totalB);
    const oddsA = totalVolume > 0 ? Math.round((Number(pool.totalA) / totalVolume) * 100) : 50;
    const oddsB = totalVolume > 0 ? Math.round((Number(pool.totalB) / totalVolume) * 100) : 50;

    let status: 'active' | 'settled' | 'expired' = 'active';
    if (pool.settled) {
      status = 'settled';
    } else if (currentBlockHeight > pool.expiry) {
      status = 'expired';
    }

    return {
      poolId: pool.poolId,
      title: pool.title,
      description: pool.description,
      totalVolume,
      participantCount: 0,
      currentOdds: { A: oddsA, B: oddsB },
      volumeTrend: [],
      createdAt: pool.createdAt,
      settledAt: pool.settledAt,
      expiresAt: pool.expiry,
      status,
      outcomeAName: pool.outcomeAName,
      outcomeBName: pool.outcomeBName,
      creator: pool.creator
    };
  });
}

/**
 * Aggregates statistics across the entire platform.
 * 
 * @param pools - All markets on the platform
 * @param allBets - List of all user bets (accessible to current user or global if admin)
 * @returns Holistic platform metrics including total volume and user counts
 */
export function calculatePlatformMetrics(
  pools: PoolData[],
  allBets: UserBet[]
): PlatformMetrics {
  const currentBlockHeight = getCurrentBlockHeight();

  const activePools = pools.filter(pool => !pool.settled && currentBlockHeight <= pool.expiry).length;
  const settledPools = pools.filter(pool => pool.settled).length;
  const expiredPools = pools.filter(pool => !pool.settled && currentBlockHeight > pool.expiry).length;

  const totalVolume = pools.reduce((sum, pool) => sum + Number(pool.totalA + pool.totalB), 0);
  const averageMarketSize = pools.length > 0 ? totalVolume / pools.length : 0;

  // Calculate time-based volumes (mock implementation - would need historical data)
  const dailyVolume = totalVolume * 0.1; // Mock: 10% of total
  const weeklyVolume = totalVolume * 0.3; // Mock: 30% of total
  const monthlyVolume = totalVolume * 0.7; // Mock: 70% of total

  const totalBets = allBets.length;
  const totalWinnings = allBets
    .filter(bet => bet.status === 'won')
    .reduce((sum, bet) => sum + (bet.actualWinnings || 0), 0);

  // Estimate unique users (would need actual user tracking)
  const totalUsers = Math.ceil(totalBets / 3); // Mock: average 3 bets per user

  return {
    totalPools: pools.length,
    activePools,
    settledPools,
    expiredPools,
    totalVolume,
    totalUsers,
    averageMarketSize,
    dailyVolume,
    weeklyVolume,
    monthlyVolume,
    totalBets,
    totalWinnings
  };
}

/**
 * Formats STX amounts into human-readable strings with K/M suffixes.
 * 
 * @param amount - The raw amount
 * @param currency - The currency symbol to append (default: 'STX')
 * @returns Formatted string (e.g., "1.25M STX")
 */
export function formatCurrency(amount: number, currency: string = 'STX'): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M ${currency}`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K ${currency}`;
  } else {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

/**
 * Formats a number as a percentage string.
 * 
 * @param value - The numerical value (0-100)
 * @param decimals - Number of decimal places to include (default: 1)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Formats a numerical profit/loss value with colored styling support.
 * Returns an object with the formatted string and boolean flags for state.
 * 
 * @param amount - The net change amount
 * @returns Object with formatted string and metadata for UI styling
 */
export function formatProfitLoss(amount: number): {
  formatted: string;
  isProfit: boolean;
  isBreakeven: boolean;
} {
  const isProfit = amount > 0;
  const isBreakeven = amount === 0;
  const formatted = isBreakeven ? '±0 STX' : `${isProfit ? '+' : ''}${formatCurrency(Math.abs(amount))}`;

  return { formatted, isProfit, isBreakeven };
}