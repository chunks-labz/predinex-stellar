import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BettingSection from '@/components/BettingSection';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import * as StacksProvider from '@/components/StacksProvider';
import * as NetworkMismatch from '../../lib/hooks/useNetworkMismatch';
import * as TxStatusHook from '../../app/lib/hooks/useTxStatus';
import { useToast } from '../../providers/ToastProvider';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import { renderWithProviders } from '../helpers/renderWithProviders';
import * as NetworkMismatch from '../../lib/hooks/useNetworkMismatch';
import { toastMessages } from '../../lib/toast-messages';

// Mock WalletAdapterProvider hook
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/StacksProvider', () => ({
  useStacks: vi.fn(),
  StacksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    placeBetSoroban: vi.fn(),
  },
}));

vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(),
}));

vi.mock('../../app/lib/hooks/useTxStatus', () => ({
  useTxStatus: vi.fn(),
}));

vi.mock('../../providers/ToastProvider', () => ({
  useToast: vi.fn(),
  // ToastProvider is used by renderWithProviders; pass children through so the
  // wrapper renders without throwing "No ToastProvider export" errors.
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock useNetworkMismatch hook
vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(),
}));


const mockPool = {
  id: 0,
  title: 'Test Pool',
  description: 'Test Description',
  creator: 'ST123',
  outcomeA: 'Outcome A',
  outcomeB: 'Outcome B',
  totalA: 1000000,
  totalB: 2000000,
  // Pool-configured bet limits in raw token units (stroops).
  // 1_000_000 stroops = 0.1 XLM
  minBet: 1_000_000,
  // 50_000_000 stroops = 5 XLM
  maxBet: 50_000_000,
  settled: false,
  winningOutcome: undefined,
  expiry: 1000,
  status: 'active' as const,
};

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const disconnectedWallet = {
  chain: 'stacks' as const,
  isConnected: false,
  isLoading: false,
  address: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

describe('BettingSection', () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({
      showToast,
    });
    vi.mocked(NetworkMismatch.useNetworkMismatch).mockReturnValue({
      isMismatch: false,
      expectedNetworkType: 'testnet',
      expectedNetworkName: 'Stellar Testnet',
      currentNetworkName: 'Stellar Testnet',
      switchNetwork: vi.fn(),
    });
  });

  it('renders betting section with pool information', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    expect(screen.getByText(/Bet on Outcome A/i)).toBeInTheDocument();
    expect(screen.getByText(/Bet on Outcome B/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Enter bet amount/i)).toBeInTheDocument();
  });

  it('prompts authentication when user is not logged in', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);

    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    expect(screen.getByText('Connect Wallet to Bet')).toBeInTheDocument();
    expect(screen.getByText('Connect Wallet')).toBeInTheDocument();
  });

  it('shows error toast for empty bet amount', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    // Try to bet with empty amount
    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    expect(showToast).toHaveBeenCalledWith('Please enter a valid amount', 'error');
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('shows error toast for bet below minimum amount', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '0.05'); // Less than 0.1 XLM minimum

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    expect(showToast).toHaveBeenCalledWith('Minimum bet is 0.1 XLM', 'error');
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('shows error toast for bet above maximum amount', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '6'); // Greater than max (5 XLM)

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    expect(showToast).toHaveBeenCalledWith('Maximum bet is 5 XLM', 'error');
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('calls predinexContract.placeBet with correct parameters when placing bet', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    vi.mocked(predinexContract.placeBetSoroban).mockResolvedValue({ txHash: '0xbet-1' });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '1.5');

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    await waitFor(() => {
      expect(predinexContract.placeBetSoroban).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet: connectedWallet,
          poolId: 0,
          outcome: 0,
          amountStroops: 15_000_000,
        })
      );
    });
  });

  it('disables buttons while betting is in progress', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    vi.mocked(predinexContract.placeBetSoroban).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '1.0');

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    // Check if loading state is shown (button should be disabled)
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      const disabledButtons = buttons.filter((btn: HTMLElement) => btn.hasAttribute('disabled'));
      expect(disabledButtons.length).toBeGreaterThan(0);
    });
  });

  it('renders without provider errors when wrapped in ToastProvider', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);

    // Should not throw a "useToast must be used within a ToastProvider" error
    expect(() => renderWithProviders(<BettingSection pool={mockPool} poolId={0} />)).not.toThrow();
  });
});
