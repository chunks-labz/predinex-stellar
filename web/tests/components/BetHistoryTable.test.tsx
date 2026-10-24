import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import BetHistoryTable from '@/app/components/dashboard/BetHistoryTable';
import type { BetHistory, DashboardFilters } from '@/app/lib/market-types';
import { renderWithProviders } from '../helpers/renderWithProviders';

const defaultFilters: DashboardFilters = {
  historyDateRange: { start: null, end: null },
  historyOutcome: 'all',
  historyMarketStatus: 'all',
  sortBy: 'date',
  sortOrder: 'desc',
};

const bet = (overrides: Partial<BetHistory>): BetHistory => ({
  poolId: 1,
  marketTitle: 'Will it rain?',
  outcomeChosen: 'A',
  outcomeName: 'Yes',
  amountBet: 10,
  betTimestamp: 1_780_000_000,
  currentOdds: 50,
  potentialWinnings: 20,
  status: 'active',
  claimStatus: 'not_eligible',
  marketStatus: 'active',
  profitLoss: 0,
  ...overrides,
});

describe('BetHistoryTable', () => {
  it('computes the win rate from settled bets only', () => {
    // One win, one loss, one still open and one expired (refunded). Only the
    // won and the lost bet can be won or lost, so the win rate is 50% and not
    // 25% (wins divided by every row).
    const history: BetHistory[] = [
      bet({ poolId: 1, status: 'won', marketStatus: 'settled', profitLoss: 10 }),
      bet({ poolId: 2, status: 'lost', marketStatus: 'settled', profitLoss: -5 }),
      bet({ poolId: 3, status: 'active', marketStatus: 'active' }),
      bet({ poolId: 4, status: 'expired', marketStatus: 'expired' }),
    ];

    renderWithProviders(
      <BetHistoryTable history={history} filters={defaultFilters} onFiltersChange={vi.fn()} />,
    );

    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 settled bets won')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows a zero win rate when no bet has settled yet', () => {
    const history: BetHistory[] = [bet({ poolId: 1, status: 'active' })];

    renderWithProviders(
      <BetHistoryTable history={history} filters={defaultFilters} onFiltersChange={vi.fn()} />,
    );

    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 settled bets won')).toBeInTheDocument();
  });

  it('renders the bet timestamp with its time of day', () => {
    const history: BetHistory[] = [bet({ poolId: 1, betTimestamp: 1_780_000_000 })];

    renderWithProviders(
      <BetHistoryTable history={history} filters={defaultFilters} onFiltersChange={vi.fn()} />,
    );

    const time = screen.getByText((_, element) => element?.tagName === 'TIME');
    expect(time).toHaveAttribute('dateTime', new Date(1_780_000_000 * 1000).toISOString());
  });
});
