import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
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

function Harness({
  filters = defaultFilters,
  onFiltersChange = vi.fn(),
}: {
  filters?: DashboardFilters;
  onFiltersChange?: (filters: Partial<DashboardFilters>) => void;
}) {
  const [current, setCurrent] = useState(filters);

  return (
    <BetHistoryTable
      history={[bet({ poolId: 1 })]}
      filters={current}
      onFiltersChange={(change) => {
        onFiltersChange(change);
        setCurrent((previous) => ({ ...previous, ...change }));
      }}
    />
  );
}

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

  it('names each sortable header button with its current direction', () => {
    renderWithProviders(<Harness />);

    expect(screen.getByRole('button', { name: 'Sort by Date, descending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort by Amount, not sorted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort by Profit/Loss, not sorted' })).toBeInTheDocument();
  });

  it('marks the active column with aria-sort and leaves other columns unsorted', () => {
    renderWithProviders(<Harness />);

    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Profit/Loss' })).toHaveAttribute('aria-sort', 'none');

    for (const name of ['Market', 'Outcome', 'Status']) {
      const header = screen.getByRole('columnheader', { name });
      expect(header).not.toHaveAttribute('aria-sort');
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  it('sorts by Amount descending when Enter is pressed on its header button', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderWithProviders(<Harness onFiltersChange={onFiltersChange} />);

    screen.getByRole('button', { name: 'Sort by Amount, not sorted' }).focus();
    await user.keyboard('{Enter}');

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({ sortBy: 'amount', sortOrder: 'desc' });
  });

  it('toggles Date direction with Space and flips aria-sort across rerenders', async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderWithProviders(<Harness onFiltersChange={onFiltersChange} />);

    const dateHeader = () => screen.getByRole('columnheader', { name: 'Date' });
    screen.getByRole('button', { name: 'Sort by Date, descending' }).focus();

    await user.keyboard(' ');
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenLastCalledWith({ sortBy: 'date', sortOrder: 'asc' });
    expect(dateHeader()).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('button', { name: 'Sort by Date, ascending' })).toBeInTheDocument();

    await user.keyboard(' ');
    expect(onFiltersChange).toHaveBeenCalledTimes(2);
    expect(onFiltersChange).toHaveBeenLastCalledWith({ sortBy: 'date', sortOrder: 'desc' });
    expect(dateHeader()).toHaveAttribute('aria-sort', 'descending');
  });

  it('has no axe accessibility violations', async () => {
    renderWithProviders(<Harness />);

    const results = await axe.run(screen.getByRole('table'));
    expect(results.violations).toHaveLength(0);
  });
});
