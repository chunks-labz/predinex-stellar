// Enhanced types for Market Discovery System

export interface PoolData {
  poolId: number;
  creator: string;
  title: string;
  description: string;
  outcomeAName: string;
  outcomeBName: string;
  totalA: bigint;
  totalB: bigint;
  settled: boolean;
  winningOutcome: number | null;
  createdAt: number;
  settledAt: number | null;
  expiry: number;
  participantCount?: number;
  assetType?: string;
  disputed?: boolean;
  frozen?: boolean;
}

export interface ProcessedMarket {
  poolId: number;
  title: string;
  description: string;
  outcomeA: string;
  outcomeB: string;
  totalVolume: number;
  oddsA: number;
  oddsB: number;
  status: 'active' | 'settled' | 'expired' | 'frozen' | 'disputed';
  timeRemaining: number | null;
  createdAt: number;
  settledAt: number | null;
  creator: string;
  participantCount?: number;
  assetType?: string;
  disputed?: boolean;
  /** #721 — Optional cover image URL stored in extended pool metadata. */
  coverImage?: string;
  /** #745 — Pool category (crypto, sports, weather, etc). */
  category?: string;
  /** #745 — Comma-separated tags for pool discovery. */
  tags?: string;
  /** #748 — Mirrored on chains (e.g. "Polygon, BSC"). */
  mirroredChains?: string[];
}

export interface MarketFilters {
  search: string;
  status: MarketStatusFilter;
  asset: string;
  minVolume: string;
  maxVolume: string;
  timeRange: TimeRangeFilter;
  sortBy: SortOption;
}

export interface PaginationState {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
}

export type MarketStatus = 'active' | 'settled' | 'expired' | 'frozen' | 'disputed';
export type MarketStatusFilter = 'all' | 'open' | 'settled' | 'disputed' | 'frozen';
export type SortOption = 'newest' | 'ending-soon' | 'volume' | 'participants';
export type TimeRangeFilter = 'all' | 'ending-24h' | 'ending-7d' | 'created-7d' | 'created-30d';
export type StatusFilter = MarketStatusFilter;

// =============================================================================
// Dashboard types (consolidated from dashboard-types.ts)
// =============================================================================

export interface UserBet {
  poolId: number;
  marketTitle: string;
  outcomeChosen: 'A' | 'B';
  outcomeName: string;
  amountBet: number;
  betTimestamp: number;
  currentOdds: number;
  potentialWinnings: number;
  status: 'active' | 'won' | 'lost' | 'expired';
  claimStatus: 'unclaimed' | 'claimed' | 'not_eligible';
  claimableAmount?: number;
  actualWinnings?: number;
}

export interface BetHistory extends UserBet {
  marketStatus: 'active' | 'settled' | 'expired';
  finalOdds?: number;
  actualWinnings?: number;
  claimedAt?: number;
  profitLoss: number;
}

export interface UserPortfolio {
  totalBets: number;
  activeBets: number;
  totalWagered: number;
  totalWinnings: number;
  totalClaimable: number;
  profitLoss: number;
  winRate: number;
}

export interface MarketStatistics {
  poolId: number;
  title: string;
  description: string;
  totalVolume: number;
  participantCount: number;
  currentOdds: { A: number; B: number };
  volumeTrend: number[];
  createdAt: number;
  settledAt: number | null;
  expiresAt: number;
  status: 'active' | 'settled' | 'expired';
  outcomeAName: string;
  outcomeBName: string;
  creator: string;
}

export interface PlatformMetrics {
  totalPools: number;
  activePools: number;
  settledPools: number;
  expiredPools: number;
  totalVolume: number;
  totalUsers: number;
  averageMarketSize: number;
  dailyVolume: number;
  weeklyVolume: number;
  monthlyVolume: number;
  totalBets: number;
  totalWinnings: number;
}

export interface DashboardData {
  userPortfolio: UserPortfolio;
  activeBets: UserBet[];
  betHistory: BetHistory[];
  marketStats: MarketStatistics[];
  platformMetrics: PlatformMetrics;
  lastUpdated: number;
}

export interface DashboardFilters {
  historyDateRange: {
    start: Date | null;
    end: Date | null;
  };
  historyOutcome: 'all' | 'won' | 'lost' | 'active';
  historyMarketStatus: 'all' | 'active' | 'settled' | 'expired';
  sortBy: 'date' | 'amount' | 'profit';
  sortOrder: 'asc' | 'desc';
}

export interface ClaimTransaction {
  poolId: number;
  amount: number;
  status: 'pending' | 'success' | 'failed';
  txId?: string;
  error?: string;
}

export interface TransactionReceiptData {
  txId: string;
  network: string;
  ledgerSequence?: number;
  ledgerTimestamp?: number;
  marketId?: number;
  marketTitle?: string;
  type: 'create' | 'bet' | 'claim' | 'settle' | 'cancel' | 'void';
  amount?: number;
  outcome?: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  timestamp: number;
}

// =============================================================================
// Chain read types (consolidated from stacks-api.ts)
// =============================================================================

/**
 * Normalized prediction-market pool data shared across Stacks and Soroban read layers.
 */
export interface Pool {
  id: number;
  title: string;
  description: string;
  creator: string;
  outcomeA: string;
  outcomeB: string;
  totalA: number;
  totalB: number;
  minBet?: number;
  maxBet?: number;
  settled: boolean;
  winningOutcome: number | undefined;
  expiry: number;
  status: 'active' | 'settled' | 'expired' | 'frozen' | 'disputed';
  participant_count?: number;
}

/**
 * A user's stake split across both outcomes for a single pool.
 */
export interface UserBetData {
  amountA: number;
  amountB: number;
  totalBet: number;
}

/**
 * Parsed on-chain contract event payload attached to a user activity item.
 */
export interface ActivityEvent {
  type: 'bet' | 'pool-creation' | 'settlement' | 'claim';
  poolId?: number;
  poolTitle?: string;
  amount?: number;
  outcome?: number;
  winnerAmount?: number;
}

/**
 * A single user-facing activity row built from a Stacks transaction.
 */
export interface ActivityItem {
  txId: string;
  type: 'bet-placed' | 'winnings-claimed' | 'pool-created' | 'contract-call';
  functionName: string;
  timestamp: number;
  status: 'success' | 'pending' | 'failed';
  amount?: number;
  poolId?: number;
  poolTitle?: string;
  explorerUrl: string;
  event?: ActivityEvent;
}

/**
 * Injectable configuration for getUserActivity, enabling test isolation.
 */
export interface ActivityConfig {
  apiBaseUrl: string;
  explorerUrl: string;
  contractAddress: string;
}
