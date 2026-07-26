import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateMarket from '../../app/create/page';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import { predinexReadApi } from '../../app/lib/adapters/predinex-read-api';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import { renderWithProviders } from '../helpers/renderWithProviders';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    createMultiOutcomePoolSoroban: vi.fn(),
    createPoolFromTemplateSoroban: vi.fn(),
  },
}));

vi.mock('../../app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getPublicTemplates: vi.fn().mockResolvedValue([]),
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

async function advancePastTemplate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^next/i }));
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/pool title/i), 'Will BTC hit 100k?');
  await user.type(
    screen.getByLabelText(/^description$/i),
    'Resolution based on Coinbase price at midnight UTC.'
  );
}

async function fillOutcomes(user: ReturnType<typeof userEvent.setup>, outcomeB = 'No') {
  await user.type(screen.getByLabelText(/outcome 1/i), 'Yes');
  await user.type(screen.getByLabelText(/outcome 2/i), outcomeB);
}

async function fillParameters(user: ReturnType<typeof userEvent.setup>, durationSeconds = 1440) {
  const durationInput = screen.getByLabelText(/pool expiry/i);
  await user.clear(durationInput);
  await user.type(durationInput, String(durationSeconds));
  const depositInput = screen.getByLabelText(/deposit deadline/i);
  await user.clear(depositInput);
  await user.type(depositInput, String(durationSeconds - 60));
}

async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
  await advancePastTemplate(user);
  await fillBasics(user);
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await fillOutcomes(user);
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await fillParameters(user);
  await user.click(screen.getByRole('button', { name: /^next/i }));
}

describe('CreateMarket wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setWalletState();
    vi.mocked(predinexReadApi.getPublicTemplates).mockResolvedValue([]);
  });

  it('renders template step on initial mount', () => {
    renderWithProviders(<CreateMarket />);
    expect(screen.getByText(/blank pool/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next/i })).toBeInTheDocument();
  });

  it('blocks step 2 advancement when basics are empty and surfaces errors', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advancePastTemplate(user);
    const nextBtn = screen.getByRole('button', { name: /^next/i });
    expect(nextBtn).toHaveAttribute('aria-disabled', 'true');

    await user.click(nextBtn);
    expect(screen.queryByLabelText(/outcome 1/i)).not.toBeInTheDocument();
  });

  it('shows a validation error when outcomes match on step 3', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advancePastTemplate(user);
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await fillOutcomes(user, 'YES');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    await waitFor(() => {
      expect(screen.getByText(/unique/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/outcome 1/i)).toBeInTheDocument();
  });

  it('advances through all five steps and shows the live preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);

    const titles = await screen.findAllByText(/Will BTC hit 100k\?/);
    expect(titles.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: /create pool on-chain/i })).toBeInTheDocument();
  });

  it('submits createMultiOutcomePoolSoroban with the wizard draft on step 5', async () => {
    vi.mocked(predinexContract.createMultiOutcomePoolSoroban).mockResolvedValue({
      txHash: 'mock-tx-id-123',
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create pool on-chain/i }));

    await waitFor(() => {
      expect(predinexContract.createMultiOutcomePoolSoroban).toHaveBeenCalledTimes(1);
    });

    expect(predinexContract.createMultiOutcomePoolSoroban).toHaveBeenCalledWith(
      expect.objectContaining({
        wallet: connectedWallet,
        title: 'Will BTC hit 100k?',
        description: 'Resolution based on Coinbase price at midnight UTC.',
        outcomes: ['Yes', 'No'],
        durationSeconds: 1440,
        metadataUri: expect.stringContaining('predinex://pool-meta/'),
        onStageChange: expect.any(Function),
      })
    );
  });

  it('shows success feedback after the transaction completes', async () => {
    vi.mocked(predinexContract.createMultiOutcomePoolSoroban).mockResolvedValue({
      txHash: 'mock-tx-id-123',
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create pool on-chain/i }));

    const heading = await screen.findByText(/^pool created!$/i);
    const status = heading.closest('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(within(status).getByText(/mock-tx-id-123/i)).toBeInTheDocument();
  });

  it('calls connect when wallet is disconnected and step 5 is submitted', async () => {
    setWalletState(disconnectedWallet);
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create pool on-chain/i }));

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(predinexContract.createMultiOutcomePoolSoroban).not.toHaveBeenCalled();
  });

  it('clears a field error when the user starts typing again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advancePastTemplate(user);
    await user.click(screen.getByLabelText(/pool title/i));
    await user.tab();
    await waitFor(() => {
      expect(screen.queryByText(/title is required/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/pool title/i), 'A solid question');

    await waitFor(() => {
      expect(screen.queryByText(/title is required/i)).not.toBeInTheDocument();
    });
  });

  it('shows an error toast when the contract call fails due to network error', async () => {
    vi.mocked(predinexContract.createMultiOutcomePoolSoroban).mockRejectedValue(
      new Error('Network error: connection refused')
    );

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create pool on-chain/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to create pool/i)).toBeInTheDocument();
    });
  });

  it('shows and accepts the transaction fee modal before completing the submission', async () => {
    vi.mocked(predinexContract.createMultiOutcomePoolSoroban).mockImplementation(async (params) => {
      const approved = await params.onFeeEstimated?.('500');
      if (!approved) throw new Error('Fee rejected');
      return { txHash: 'mock-fee-tx' };
    });

    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advanceToReview(user);
    await user.click(screen.getByRole('button', { name: /create pool on-chain/i }));

    expect(await screen.findByText(/confirm transaction/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByText(/pool created!/i)).toBeInTheDocument();
    });
  });

  it('validates duration must be a positive number on step 4', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateMarket />);

    await advancePastTemplate(user);
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));
    await fillOutcomes(user);
    await user.click(screen.getByRole('button', { name: /^next/i }));

    const durationInput = screen.getByLabelText(/pool expiry/i);
    await user.clear(durationInput);
    await user.type(durationInput, '0');
    await user.click(screen.getByRole('button', { name: /^next/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/pool expiry/i)).toBeInTheDocument();
    });
  });
});
