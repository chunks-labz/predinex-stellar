import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import TransactionsPage from '../../app/transactions/page';
import { renderWithProviders } from '../helpers/renderWithProviders';

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('../../components/RouteErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('TransactionsPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows an empty state with a CTA and no skeleton rows when there are no transactions', () => {
    renderWithProviders(<TransactionsPage />);

    expect(screen.getByText('No Transactions Found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore Markets' })).toHaveAttribute('href', '/markets');
    expect(document.querySelector('.animate-pulse')).not.toBeInTheDocument();
  });

  it('offers to clear filters when stored transactions do not match', () => {
    window.localStorage.setItem(
      'predinex-tx-history',
      JSON.stringify([
        {
          id: 'tx-1',
          type: 'settlement',
          description: 'Market settled',
          amount: 10,
          date: new Date().toISOString(),
          status: 'confirmed',
        },
      ])
    );

    renderWithProviders(<TransactionsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Bet Placed' }));

    expect(screen.getByText('No Transactions Found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Explore Markets' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Market settled')).toBeInTheDocument();
  });
});
