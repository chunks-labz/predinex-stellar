import type { DashboardStats, UserBet } from './types';

export function calculateDashboardStats(userBets: UserBet[]): DashboardStats {
  const totalBets = userBets.length;
  const totalWagered = userBets.reduce((sum, bet) => sum + bet.amount, 0);
  const wonBets = userBets.filter((bet) => bet.status === 'won');
  const totalWinnings = wonBets.reduce((sum, bet) => sum + (bet.winnings || 0), 0);
  const winRate = totalBets > 0 ? (wonBets.length / totalBets) * 100 : 0;
  const activeBets = userBets.filter((bet) => bet.status === 'active').length;
  const settledBets = userBets.filter((bet) => bet.status !== 'active').length;

  return {
    totalBets,
    totalWagered,
    totalWinnings,
    winRate: Math.round(winRate),
    activeBets,
    settledBets,
    lastUpdated: Date.now(),
  };
}

export function getMockUserBets(): UserBet[] {
  return [
    {
      poolId: 0,
      poolTitle: 'Bitcoin Price > $100k?',
      outcome: 'Yes',
      amount: 50,
      status: 'active',
      createdAt: Date.now() - 86400000,
    },
    {
      poolId: 1,
      poolTitle: 'ETH Reaches $5k?',
      outcome: 'No',
      amount: 25,
      status: 'won',
      createdAt: Date.now() - 172800000,
      winnings: 45,
    },
    {
      poolId: 2,
      poolTitle: 'Stacks TVL > $100M?',
      outcome: 'Yes',
      amount: 100,
      status: 'lost',
      createdAt: Date.now() - 259200000,
      winnings: 0,
    },
  ];
}

export function formatStxAmount(amount: number): string {
  return amount.toFixed(2);
}

export function getBetStatusClasses(status: string): string {
  switch (status) {
    case 'won':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'lost':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'active':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'pending':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}
