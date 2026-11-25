import { describe, it, expect } from 'vitest';
import { calculateDashboardStats, realizedPnl } from '../../app/lib/user-dashboard/model';
import type { UserBet } from '../../app/lib/user-dashboard/types';

describe('calculateDashboardStats', () => {
  it('aggregates bet list into dashboard stats', () => {
    const bets: UserBet[] = [
      { poolId: 1, poolTitle: 'A', outcome: 'Y', amount: 10, status: 'active', createdAt: 0 },
      { poolId: 2, poolTitle: 'B', outcome: 'N', amount: 20, status: 'won', createdAt: 0, winnings: 30 },
    ];
    const stats = calculateDashboardStats(bets);
    expect(stats.totalBets).toBe(2);
    expect(stats.totalWagered).toBe(30);
    expect(stats.activeBets).toBe(1);
    expect(stats.settledBets).toBe(1);
    expect(stats.totalWinnings).toBe(30);
    expect(stats.winRate).toBe(50);
  });
});

describe('realizedPnl (#1701)', () => {
  const base: UserBet = { poolId: 1, poolTitle: 'A', outcome: 'Y', amount: 20, status: 'won', createdAt: 0 };

  it('returns payout minus stake for a win', () => {
    expect(realizedPnl({ ...base, winnings: 45 })).toBe(25);
  });

  it('returns the negative stake for a loss', () => {
    expect(realizedPnl({ ...base, status: 'lost' })).toBe(-20);
  });

  it('returns null (not zero) when the bet is unsettled or the payout is unknown', () => {
    expect(realizedPnl({ ...base, status: 'active' })).toBeNull();
    expect(realizedPnl({ ...base, status: 'pending' })).toBeNull();
    expect(realizedPnl({ ...base, winnings: undefined })).toBeNull();
    expect(realizedPnl({ ...base, winnings: NaN })).toBeNull();
  });
});
