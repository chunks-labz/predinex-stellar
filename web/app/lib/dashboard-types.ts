// Dashboard data types for Real-time Market Statistics Dashboard

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