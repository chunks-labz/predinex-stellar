import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../helpers/renderWithProviders';
import SettledPoolSummary from '../../app/components/SettledPoolSummary';
import type { Pool } from '../../app/lib/market-types';

// Wallet mock — component doesn't use it, but providers need it
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(() => ({
    chain: 'stacks', isConnected: false, isLoading: false,
    address: null, connect: vi.fn(), disconnect: vi.fn(),
  })),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../providers/ToastProvider', () => ({
  useToast: vi.fn(() => ({ showToast: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    id: 1,
    title: 'BTC > 100k?',
    description: 'Will BTC exceed 100k by end of year?',
    creator: 'ST123',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 50_000_000, // 5 XLM (1 XLM = 10_000_000 stroops)
    totalB: 30_000_000, // 3 XLM
    settled: true,
    winningOutcome: 0,
    expiry: 1000,
    status: 'settled' as const,
    ...overrides,
  };
}

describe('SettledPoolSummary', () => {
  it('renders nothing for unsettled pools', () => {
    const pool = makePool({ settled: false });
    const { container } = renderWithProviders(<SettledPoolSummary pool={pool} />);
    expect(container.firstChild).toBeNull();
  });

  it('displays winning outcome prominently', () => {
    const pool = makePool({ winningOutcome: 0 });
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('Winning Outcome')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No did not win this market.')).toBeInTheDocument();
  });

  it('displays winning outcome B when winningOutcome is 1', () => {
    const pool = makePool({ winningOutcome: 1 });
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Yes did not win this market.')).toBeInTheDocument();
  });

  it('shows correct total pool size', () => {
    const pool = makePool(); // 5 + 3 = 8 XLM total
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('Total Pool')).toBeInTheDocument();
    expect(screen.getByText('8 XLM')).toBeInTheDocument();
  });

  it('shows winning and losing side totals', () => {
    const pool = makePool({ winningOutcome: 0 }); // A wins: 5 XLM, B loses: 3 XLM
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('Winning Side')).toBeInTheDocument();
    expect(screen.getByText('5 XLM')).toBeInTheDocument();

    expect(screen.getByText('Losing Side')).toBeInTheDocument();
    expect(screen.getByText('3 XLM')).toBeInTheDocument();
  });

  it('shows protocol fee and net payout', () => {
    // Total: 8 XLM = 80_000_000 stroops. Fee: 2% = 1_600_000 stroops = 0.16 XLM
    const pool = makePool();
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('Protocol fee (2%)')).toBeInTheDocument();
    expect(screen.getByText('0.16 XLM')).toBeInTheDocument();

    expect(screen.getByText('Net payout pool')).toBeInTheDocument();
    expect(screen.getByText('7.84 XLM')).toBeInTheDocument();
  });

  it('shows correct payout multiplier', () => {
    // Net payout: 7_840_000 micro. Winning side: 5_000_000 micro. Multiplier: 1.57x
    const pool = makePool({ winningOutcome: 0 });
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('Payout Multiple')).toBeInTheDocument();
    expect(screen.getByText('1.57x')).toBeInTheDocument();
  });

  it('handles zero winning side without crashing', () => {
    const pool = makePool({ totalA: 0, totalB: 50_000_000, winningOutcome: 0 });
    renderWithProviders(<SettledPoolSummary pool={pool} />);

    expect(screen.getByText('0.00x')).toBeInTheDocument();
  });
});
