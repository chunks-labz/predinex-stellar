// Enhanced contract integration for dashboard data

import { fetchCallReadOnlyFunction, cvToValue, principalCV, uintCV } from "@stacks/transactions";
import { STACKS_MAINNET, STACKS_TESTNET, type StacksNetwork } from "@stacks/network";
import { UserBet, BetHistory, DashboardData } from "./dashboard-types";
import { PoolData } from "./market-types";
import { fetchAllPools, getEnhancedPool } from "./enhanced-stacks-api";
import { getCurrentBlockHeight } from './market-utils';
import {
  calculatePortfolio, 
  calculatePotentialWinnings, 
  calculateActualWinnings,
  processMarketStatistics,
  calculatePlatformMetrics,
  isClaimEligible,
  calculateBetProfitLoss
} from "./dashboard-utils";
import { getRuntimeConfig } from "./runtime-config";
import { createScopedLogger } from "./logger";

const log = createScopedLogger('dashboard-api');

function getStacksNetwork(): StacksNetwork {
  const cfg = getRuntimeConfig();
  return cfg.network === 'testnet' ? STACKS_TESTNET : STACKS_MAINNET;
}

/**
 * Get all user bets for a specific address
 */
export async function getUserBets(userAddress: string): Promise<UserBet[]> {
  try {
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();
    // Get all pools to check for user bets
    const pools = await fetchAllPools();
    const userBets: UserBet[] = [];
    
    for (const pool of pools) {
      try {
        const result = await fetchCallReadOnlyFunction({
          contractAddress: cfg.contract.address,
          contractName: cfg.contract.name,
          functionName: 'get_user_bet',
          functionArgs: [uintCV(pool.poolId), principalCV(userAddress)],
          senderAddress: cfg.contract.address,
          network,
        });

        const betData = cvToValue(result, true);
        if (betData && (betData['amount-a'] > 0 || betData['amount-b'] > 0)) {
          // User has bets in this pool
          const amountA = BigInt(betData['amount-a'] || 0);
          const amountB = BigInt(betData['amount-b'] || 0);
          
          if (amountA > 0) {
            const bet = await createUserBet(pool, userAddress, 'A', amountA);
            if (bet) userBets.push(bet);
          }
          
          if (amountB > 0) {
            const bet = await createUserBet(pool, userAddress, 'B', amountB);
            if (bet) userBets.push(bet);
          }
        }
      } catch (error) {
        log.error(`Failed to get user bet for pool ${pool.poolId}`, error);
      }
    }
    
    return userBets;
  } catch (error) {
    log.error('Failed to get user bets', error);
    return [];
  }
}

/**
 * Create a UserBet object from pool data and bet information
 */
async function createUserBet(
  pool: PoolData,
  userAddress: string,
  outcome: 'A' | 'B',
  betAmount: bigint
): Promise<UserBet | null> {
  try {
    const currentBlockHeight = getCurrentBlockHeight();
    
    // Determine market status
    let status: 'active' | 'won' | 'lost' | 'expired' = 'active';
    let claimStatus: 'unclaimed' | 'claimed' | 'not_eligible' = 'not_eligible';
    let claimableAmount = 0;
    
    if (pool.settled) {
      const winningOutcome = pool.winningOutcome === 0 ? 'A' : 'B';
      status = outcome === winningOutcome ? 'won' : 'lost';
      
      if (status === 'won') {
        claimableAmount = calculateActualWinnings(
          BigInt(betAmount),
          pool.totalA,
          pool.totalB,
          outcome,
          winningOutcome
        );
        
        // Check if already claimed (mock implementation)
        const alreadyClaimed = await checkIfClaimed(pool.poolId, userAddress);
        claimStatus = alreadyClaimed ? 'claimed' : 'unclaimed';
      }
    } else if (currentBlockHeight > pool.expiry) {
      status = 'expired';
    }
    
    const potentialWinnings = status === 'active' 
      ? calculatePotentialWinnings(
          BigInt(betAmount),
          pool.totalA,
          pool.totalB,
          outcome
        )
      : 0;
    
    const currentOdds = calculateCurrentOdds(
      pool.totalA,
      pool.totalB,
      outcome
    );
    
    return {
      poolId: pool.poolId,
      marketTitle: pool.title,
      outcomeChosen: outcome,
      outcomeName: outcome === 'A' ? pool.outcomeAName : pool.outcomeBName,
      amountBet: Number(betAmount),
      betTimestamp: pool.createdAt, // Mock: use pool creation time
      currentOdds,
      potentialWinnings,
      status,
      claimStatus,
      claimableAmount: claimableAmount > 0 ? claimableAmount : undefined
    };
  } catch (error) {
    log.error('Failed to create user bet', error);
    return null;
  }
}

/**
 * Check if user has already claimed winnings for a pool
 */
async function checkIfClaimed(poolId: number, userAddress: string): Promise<boolean> {
  try {
    const cfg = getRuntimeConfig();
    const network = getStacksNetwork();
    const result = await fetchCallReadOnlyFunction({
      contractAddress: cfg.contract.address,
      contractName: cfg.contract.name,
      functionName: 'get-user-bet', // This would need to be enhanced to track claims
      functionArgs: [uintCV(poolId), principalCV(userAddress)],
      senderAddress: cfg.contract.address,
      network,
    });
    
    // After claiming, the contract removes the bet record; absence means claimed
    const betData = cvToValue(result, true);
    const hasBet = betData && (betData['amount-a'] > 0 || betData['amount-b'] > 0);
    return !hasBet;
  } catch (error) {
    return false;
  }
}

/**
 * Calculate current odds for a specific outcome
 */
function calculateCurrentOdds(totalA: bigint, totalB: bigint, outcome: 'A' | 'B'): number {
  const total = Number(totalA + totalB);
  if (total === 0) return 50;

  const outcomeAmount = outcome === 'A' ? Number(totalA) : Number(totalB);
  return Math.round((outcomeAmount / total) * 100);
}

/**
 * Get complete dashboard data for a user
 */
export async function fetchDashboardData(userAddress: string): Promise<DashboardData> {
  try {
    // Fetch user bets
    const userBets = await getUserBets(userAddress);
    
    // Separate active bets and history
    const activeBets = userBets.filter(bet => bet.status === 'active');
    const betHistory: BetHistory[] = userBets.map(bet => ({
      ...bet,
      marketStatus: bet.status === 'active' ? 'active' : 'settled',
      profitLoss: calculateBetProfitLoss(bet as BetHistory),
      actualWinnings: bet.status === 'won' ? bet.claimableAmount : undefined
    }));
    
    // Calculate portfolio
    const userPortfolio = calculatePortfolio(userBets);
    
    // Get market statistics
    const pools = await fetchAllPools();
    const marketStats = processMarketStatistics(pools);
    
    // Calculate platform metrics
    const platformMetrics = calculatePlatformMetrics(pools, userBets);
    
    return {
      userPortfolio,
      activeBets,
      betHistory,
      marketStats,
      platformMetrics,
      lastUpdated: Date.now()
    };
  } catch (error) {
    log.error('Failed to fetch dashboard data', error);
    throw error;
  }
}

/**
 * Get claimable winnings for a user
 */
export async function getClaimableWinnings(userAddress: string): Promise<UserBet[]> {
  const userBets = await getUserBets(userAddress);
  return userBets.filter(isClaimEligible);
}
