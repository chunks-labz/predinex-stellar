import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateMarket from '../../app/create/page';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import { renderWithProviders } from '../helpers/renderWithProviders';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    createMarketSoroban: vi.fn(),
  },
}));

vi.mock('../../app/lib/cache-invalidation', () => ({
  invalidateOnCreatePool: vi.fn(),
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'GBUSER123STELLARADDRESS',
  connect: mockConnect,
  disconnect: mockDisconnect,
};

const disconnectedWallet = {
  ...connectedWallet,
  isConnected: false,
  address: null,
};

function setWalletState(
  wallet: typeof connectedWallet | typeof disconnectedWallet = connectedWallet
) {
  vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(wallet as never);
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>, outcomeB = 'No') {
  await user.type(screen.getByLabelText(/question \/ title/i), 'Will BTC hit 100k?');
  await user.type(
    screen.getByLabelText(/description/i),
    'Resolution based on Coinbase price at midnight UTC.'
  );
  await user.type(screen.getByLabelText(/outcome a/i), 'Yes');
  await user.type(screen.getByLabelText(/outcome b/i), outcomeB);
}

async function fillStep2(user: ReturnType<typeof userEvent.setup>, durationSeconds = 1440) {
  const durationInput = screen.getByLabelText(/duration/i);
  await user.clear(durationInput);
  await user.type(durationInput, String(durationSeconds));
}

async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
  await fillStep1(user);
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await fillStep2(user);
  await user.click(screen.getByRole('button', { name: /^next/i }));
}

describe('CreateMarket wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setWalletState();
  });

  it('renders step 1 fields on initial mount', () => {
    renderWithProviders(<CreateMarket />);

    expect(screen.getByLabelText(/question \/ title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/outcome a/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/outcome b/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next/i })).toBeInTheDocument();
  });

  it('blocks step 1 advancement when fields are empty and surfaces errors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    const nextBtn = screen.getByRole('button', { name: /^next/i });
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true');

    await user.click(nextBtn);
    // Still on step 1 — duration label (step 2) is not visible.
    expect(screen.queryByLabelText(/duration/i)).not.toBeInTheDocument();

    await waitFor(() => {
      const alerts = screen.queryAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });
  });

  it('shows a validation error when outcomes match on step 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await fillStep1(user, 'YES');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    await waitFor(() => {
      expect(screen.getByText(/outcomes must be different/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/question \/ title/i)).toBeInTheDocument(); // still on step 1
  });

  it('advances through all three steps and shows the live preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    expect(await screen.findByLabelText(/duration/i)).toBeInTheDocument();

    await fillStep2(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));

    // Review step renders the live preview — title appears in summary row AND in MarketCard.
    const titles = await screen.findAllByText(/Will BTC hit 100k\?/);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /create market/i })).toBeInTheDocument();
  });

  it('submits createMarketSoroban with the wizard draft on step 3', async () => {
    vi.mocked(predinexContract.createMarketSoroban).mockResolvedValue({
      txHash: 'mock-tx-id-123',
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    await waitFor(() => {
      expect(predinexContract.createMarketSoroban).toHaveBeenCalledTimes(1);
    });

    expect(predinexContract.createMarketSoroban).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: connectedWallet,
        title: 'Will BTC hit 100k?',
        description: 'Resolution based on Coinbase price at midnight UTC.',
        outcomeA: 'Yes',
        outcomeB: 'No',
        durationSeconds: 1440,
        onStageChange: expect.any(Function),
      })
    );
  });

  it('shows success feedback after the transaction completes', async () => {
    vi.mocked(predinexContract.createMarketSoroban).mockResolvedValue({
      txHash: 'mock-tx-id-123',
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    // The success banner is the role="status" container that holds the heading.
    const heading = await screen.findByText(/^market created!$/i);
    const status = heading.closest('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(within(status).getByText(/mock-tx-id-123/i)).toBeInTheDocument();
  });

  it('calls connect when wallet is disconnected and step 3 is submitted', async () => {
    setWalletState(disconnectedWallet);
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(predinexContract.createMarketSoroban).not.toHaveBeenCalled();
  });

  it('clears a field error when the user starts typing again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await user.click(screen.getByLabelText(/question \/ title/i));
    await user.tab(); // trigger blur → error
    await waitFor(() => {
      expect(screen.queryByText(/title is required/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/question \/ title/i), 'A solid question');

    await waitFor(() => {
      expect(screen.queryByText(/title is required/i)).not.toBeInTheDocument();
    });
  });

  it('shows an error toast when the contract call fails due to network error', async () => {
    vi.mocked(predinexContract.createMarketSoroban).mockRejectedValue(
      new Error('Network error: connection refused')
    );

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to create market/i)).toBeInTheDocument();
    });
  });

  it('shows and accepts the transaction fee modal before completing the submission', async () => {
    vi.mocked(predinexContract.createMarketSoroban).mockImplementation(async (params) => {
      const approved = await params.onFeeEstimated?.('500');
      if (!approved) throw new Error('Fee rejected');
      return { txHash: 'mock-fee-tx' };
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    // Fee modal should appear with the estimated fee
    expect(await screen.findByText(/confirm transaction/i)).toBeInTheDocument();

    // Confirm the fee
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    // Transaction should complete successfully
    await waitFor(() => {
      expect(screen.getByText(/market created!/i)).toBeInTheDocument();
    });
  });

  it('shows a failure toast when fee is rejected in the transaction fee modal', async () => {
    vi.mocked(predinexContract.createMarketSoroban).mockImplementation(async (params) => {
      const approved = await params.onFeeEstimated?.('500');
      if (!approved) throw new Error('User rejected fee estimation');
      return { txHash: 'mock-tx' };
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create market/i }));

    // Fee modal should appear
    expect(await screen.findByText(/confirm transaction/i)).toBeInTheDocument();

    // Cancel the fee
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    // Should show failure toast
    await waitFor(() => {
      expect(screen.getByText(/failed to create market/i)).toBeInTheDocument();
    });
  });

  it('validates duration must be a positive number on step 2', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await fillStep1(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    expect(await screen.findByLabelText(/duration/i)).toBeInTheDocument();

    const durationInput = screen.getByLabelText(/duration/i);
    await user.clear(durationInput);
    await user.type(durationInput, '0');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    });
  });
});
