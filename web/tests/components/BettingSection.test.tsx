import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from '@axe-core/react';
import BettingSection from '@/components/BettingSection';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import * as NetworkMismatch from '../../lib/hooks/useNetworkMismatch';
import * as WalletAccountHook from '../../lib/hooks/useWalletAccount';
import { useToast } from '../../providers/ToastProvider';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import { renderWithProviders } from '../helpers/renderWithProviders';

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

vi.mock('../../lib/hooks/useWalletAccount', () => ({
  useWalletAccount: vi.fn(),
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
    vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
      address: connectedWallet.address,
      balance: '100.0000000',
      isConnected: true,
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

  it('disables bet buttons for an empty amount', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    // With no amount entered the form is invalid, so submission is disabled.
    const betButton = screen.getByText(/Bet on Outcome A/i);
    expect(betButton).toBeDisabled();
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('shows an inline error and disables submit for a bet below the minimum', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '0.05'); // Less than 0.1 XLM minimum
    await user.tab(); // blur to surface the inline error

    expect(screen.getByRole('alert')).toHaveTextContent('Minimum bet is 0.1 XLM');
    expect(screen.getByText(/Bet on Outcome A/i)).toBeDisabled();
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('shows an inline error and disables submit for a bet above the maximum', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '6'); // Greater than max (5 XLM)
    await user.tab(); // blur to surface the inline error

    expect(screen.getByRole('alert')).toHaveTextContent('Maximum bet is 5 XLM');
    expect(screen.getByText(/Bet on Outcome A/i)).toBeDisabled();
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('uses the Horizon wallet balance when validating sufficient funds', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
      address: connectedWallet.address,
      balance: '1.0000000',
      isConnected: true,
    });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.type(input, '2');

    const betButton = screen.getByText(/Bet on Outcome A/i);
    await user.click(betButton);

    expect(showToast).toHaveBeenCalledWith('Insufficient balance. Available: 1.00 XLM', 'error');
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

  it('supports tab navigation and Enter/Space activation through the order controls', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    vi.mocked(predinexContract.placeBetSoroban).mockResolvedValue({ txHash: '0xkeyboard' });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    const input = screen.getByLabelText(/Enter bet amount/i);
    await user.tab();
    expect(document.activeElement).toBe(input);

    const quickBetGroup = screen.getByRole('group', { name: /quick bet/i });
    const quickBetButtons = within(quickBetGroup).getAllByRole('button');
    for (const button of quickBetButtons) {
      await user.tab();
      expect(document.activeElement).toBe(button);
    }

    await user.type(input, '1');
    for (let index = 0; index < quickBetButtons.length; index += 1) {
      await user.tab();
    }
    const outcomeA = screen.getByRole('button', { name: /Bet on Outcome A/i });
    await user.tab();
    expect(document.activeElement).toBe(outcomeA);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(predinexContract.placeBetSoroban).toHaveBeenCalledOnce());

    vi.mocked(predinexContract.placeBetSoroban).mockClear();
    await user.type(input, '1');
    for (let index = 0; index < quickBetButtons.length + 2; index += 1) {
      await user.tab();
    }
    const outcomeB = screen.getByRole('button', { name: /Bet on Outcome B/i });
    expect(document.activeElement).toBe(outcomeB);
    await user.keyboard('{Space}');
    await waitFor(() => expect(predinexContract.placeBetSoroban).toHaveBeenCalledOnce());
  });

  it('has no axe accessibility violations in the connected trading form', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    const { container } = renderWithProviders(
      <BettingSection pool={mockPool} poolId={0} />,
    );

    expect(await axe(container).run()).toHaveLength(0);
  });

  // #1534 — the quick-select buttons used to fill in a raw percentage of the
  // wallet balance, which could fall outside the pool limits and leave the
  // form permanently invalid.
  describe('quick bet amounts', () => {
    const limitedPool = {
      ...mockPool,
      // 5 XLM minimum, 50 XLM maximum.
      minBet: 50_000_000,
      maxBet: 500_000_000,
    };

    it('clamps a quick amount up to the pool minimum', async () => {
      vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
      vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
        address: connectedWallet.address,
        balance: '20.0000000',
        isConnected: true,
      });

      const user = userEvent.setup();
      renderWithProviders(<BettingSection pool={limitedPool} poolId={0} />);

      const input = screen.getByLabelText(/Enter bet amount/i);
      // 10% of 20 XLM is 2 XLM, which is below the 5 XLM pool minimum.
      await user.click(screen.getByRole('button', { name: /Set bet to 5 XLM \(10%\)/i }));

      expect(input).toHaveValue(5);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(/Bet on Outcome A/i)).not.toBeDisabled();
    });

    it('clamps a quick amount down to the pool maximum', async () => {
      vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
      vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
        address: connectedWallet.address,
        balance: '100.0000000',
        isConnected: true,
      });

      const user = userEvent.setup();
      renderWithProviders(<BettingSection pool={limitedPool} poolId={0} />);

      const input = screen.getByLabelText(/Enter bet amount/i);
      // 100% of 100 XLM is 100 XLM, which is above the 50 XLM pool maximum.
      await user.click(screen.getByRole('button', { name: /Set bet to 50 XLM \(100%\)/i }));

      expect(input).toHaveValue(50);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers the largest allowed amount through the Max button', async () => {
      vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
      vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
        address: connectedWallet.address,
        balance: '20.0000000',
        isConnected: true,
      });

      const user = userEvent.setup();
      renderWithProviders(<BettingSection pool={limitedPool} poolId={0} />);

      const input = screen.getByLabelText(/Enter bet amount/i);
      await user.click(screen.getByRole('button', { name: /Set bet to 20 XLM \(Max\)/i }));

      expect(input).toHaveValue(20);
    });

    it('disables a quick amount that no balance can cover', async () => {
      vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
      vi.mocked(WalletAccountHook.useWalletAccount).mockReturnValue({
        address: connectedWallet.address,
        balance: '2.0000000',
        isConnected: true,
      });

      renderWithProviders(<BettingSection pool={limitedPool} poolId={0} />);

      // The balance is below the 5 XLM pool minimum, so no quick amount exists.
      expect(screen.getByRole('button', { name: /10% is not available/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Max is not available/i })).toBeDisabled();
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

  it('renders the shared network mismatch warning and blocks betting', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    const switchNetwork = vi.fn().mockResolvedValue(undefined);
    vi.mocked(NetworkMismatch.useNetworkMismatch).mockReturnValue({
      isMismatch: true,
      expectedNetworkType: 'mainnet',
      expectedNetworkName: 'Stellar Mainnet',
      currentNetworkName: 'Stellar Testnet',
      switchNetwork,
    });

    const user = userEvent.setup();
    renderWithProviders(<BettingSection pool={mockPool} poolId={0} />);

    // The shared component supplies both the message and the switch action.
    expect(screen.getByText(/Please switch to Stellar Mainnet to place bets\./i)).toBeInTheDocument();
    const switchBtn = screen.getByRole('button', { name: /switch to stellar mainnet/i });
    expect(switchBtn).toBeInTheDocument();

    expect(screen.getByLabelText(/Enter bet amount/i)).toBeDisabled();
    for (const button of screen.getAllByText(/Wrong Network/i)) {
      expect(button).toBeDisabled();
    }

    await user.click(switchBtn);
    expect(switchNetwork).toHaveBeenCalledTimes(1);
    expect(vi.mocked(predinexContract.placeBetSoroban)).not.toHaveBeenCalled();
  });

  it('renders without provider errors when wrapped in ToastProvider', () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);

    // Should not throw a "useToast must be used within a ToastProvider" error
    expect(() => renderWithProviders(<BettingSection pool={mockPool} poolId={0} />)).not.toThrow();
  });
});
