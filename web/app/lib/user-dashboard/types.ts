export interface UserBet {
  poolId: number;
  poolTitle: string;
  outcome: string;
  amount: number;
  status: 'active' | 'won' | 'lost' | 'pending';
  createdAt: number;
  winnings?: number;
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
