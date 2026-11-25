export interface UserBet {
  poolId: number;
  poolTitle: string;
  outcome: string;
  amount: number;
  status: 'active' | 'won' | 'lost' | 'pending';
  createdAt: number;
  winnings?: number;
  /** Outcome index on-chain (0 = A, 1 = B); needed to cancel the bet. */
  outcomeIndex?: number;
  /** Raw stake in stroops, so a cancel refunds the exact amount. */
  stakeStroops?: number;
  /** True while the pool is open and unexpired, i.e. `cancel_bet` can succeed. */
  cancellable?: boolean;
}

export interface DashboardStats {
  totalBets: number;
  totalWagered: number;
  totalWinnings: number;
  winRate: number;
  activeBets: number;
  settledBets: number;
  lastUpdated: number;
}

export type DashboardTabId = 'overview' | 'bets' | 'history' | 'incentives';
