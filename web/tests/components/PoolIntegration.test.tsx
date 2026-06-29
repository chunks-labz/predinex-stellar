import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PoolIntegration from '../../app/components/PoolIntegration';
import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';
import * as StacksApi from '../../app/lib/stacks-api';
import * as NetworkMismatch from '../../lib/hooks/useNetworkMismatch';
import { renderWithProviders } from '../helpers/renderWithProviders';

// Mock WalletAdapterProvider hook
vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock stacks-api
vi.mock('../../app/lib/stacks-api', () => ({
  getMarkets: vi.fn(),
  getPoolCount: vi.fn(),
}));

// Mock useNetworkMismatch hook
vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(),
}));

const mockPool: StacksApi.Pool = {
  id: 0,
  title: 'Test Pool',
  description: 'Test Description',
  creator: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  outcomeA: 'Yes',
  outcomeB: 'No',
  totalA: 50000000, // 5 XLM at 10_000_000 stroops per unit
  totalB: 30000000, // 3 XLM at 10_000_000 stroops per unit
  settled: false,
  winningOutcome: undefined,
  expiry: 1000,
  status: 'active',
};

const settledPool: StacksApi.Pool = {
  ...mockPool,
  id: 1,
  title: 'Settled Pool',
  settled: true,
  winningOutcome: 0,
  status: 'settled',
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

const mockNetworkMatch = {
  isMismatch: false,
  expectedNetworkType: 'testnet' as const,
  expectedNetworkName: 'Stellar Testnet',
  currentNetworkName: 'Stellar Testnet',
  switchNetwork: vi.fn(),
};

const mockNetworkMismatch = {
  isMismatch: true,
  expectedNetworkType: 'testnet' as const,
  expectedNetworkName: 'Stellar Testnet',
  currentNetworkName: 'Stellar Mainnet',
  switchNetwork: vi.fn(),
};

describe('PoolIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);
    vi.mocked(NetworkMismatch.useNetworkMismatch).mockReturnValue(mockNetworkMatch);
  });

  it('renders loading state initially', () => {
    vi.mocked(StacksApi.getMarkets).mockImplementation(() => new Promise(() => {})); // Never resolves

    renderWithProviders(<PoolIntegration />);

    expect(screen.getByText('Loading pools from blockchain...')).toBeInTheDocument();
  });

  it('renders empty state when no pools are available', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('No pools available yet. Be the first to create one!')).toBeInTheDocument();
    });
  });

  it('does not contain stale chain references (STX is no longer acceptable)', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('No pools available yet. Be the first to create one!')).toBeInTheDocument();
    });

    // XLM is the correct unit for Stellar blockchain
    // The component should not have any Stacks-specific references (STX)
    expect(screen.queryByText(/STX/i)).not.toBeInTheDocument();
  });

  it('renders pool cards when pools are available', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    expect(screen.getByText('Test Description')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('5.00 XLM')).toBeInTheDocument();
    expect(screen.getByText('3.00 XLM')).toBeInTheDocument();
  });

  it('displays correct pool statistics', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool, settledPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // Total pools: 2
    const totalPoolsElements = screen.getAllByText('2');
    expect(totalPoolsElements.length).toBeGreaterThan(0);

    // Total volume: 5 + 3 + 5 + 3 = 16 XLM
    expect(screen.getByText('16.00 XLM')).toBeInTheDocument();

    // Active pools: 1
    const activeElements = screen.getAllByText('1');
    expect(activeElements.length).toBeGreaterThan(0);
  });

  it('still renders the connected wallet action from the current component path', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    vi.mocked(NetworkMismatch.useNetworkMismatch).mockReturnValue(mockNetworkMismatch);
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // When the wallet is connected but on the wrong network, the action remains
    // present but is disabled and shows the mismatch guidance.
    const actionButton = screen.getByRole('button', { name: /wrong network/i });
    expect(actionButton).toBeDisabled();
    expect(screen.getByText(/Please switch to Stellar Testnet to interact/i)).toBeInTheDocument();
  });

  it('enables Place Bet button when wallet is connected and network matches', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    vi.mocked(NetworkMismatch.useNetworkMismatch).mockReturnValue(mockNetworkMatch);
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    const placeBetButton = screen.getByRole('button', { name: /Place Bet/i });
    expect(placeBetButton).not.toBeDisabled();
  });

  it('shows View Pool Details button when wallet is not connected', async () => {
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(disconnectedWallet);
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /View Pool Details/i })).toBeInTheDocument();
  });

  it('displays settled pool with winner indicator', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([settledPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Settled Pool')).toBeInTheDocument();
    });

    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.getByText('✓ Winner')).toBeInTheDocument();
    expect(screen.getByText(/Pool settled • Outcome: Yes/i)).toBeInTheDocument();
  });

  it('calculates and displays correct odds percentages', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // Total: 80 XLM, A: 50 XLM (62.5% ≈ 63%), B: 30 XLM (37.5% ≈ 38%)
    expect(screen.getByText('63% of pool')).toBeInTheDocument();
    expect(screen.getByText('38% of pool')).toBeInTheDocument();
  });

  it('handles API errors gracefully', async () => {
    vi.mocked(StacksApi.getMarkets).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load pools')).toBeInTheDocument();
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('allows refreshing pools', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    const user = userEvent.setup();
    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', { name: /Refresh Pools/i });
    await user.click(refreshButton);

    expect(vi.mocked(StacksApi.getMarkets)).toHaveBeenCalledTimes(2);
  });

  it('displays creator address in shortened format', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // formatDisplayAddress should shorten the address
    expect(screen.getByText(/Creator:/i)).toBeInTheDocument();
    expect(screen.getByText(/ST1PQH...GZGM/i)).toBeInTheDocument();
  });

  it('fetches all pools on mount', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(vi.mocked(StacksApi.getMarkets)).toHaveBeenCalledWith('all');
    });
  });

  it('handles pools with zero volume correctly', async () => {
    const emptyPool: StacksApi.Pool = {
      ...mockPool,
      totalA: 0,
      totalB: 0,
    };

    vi.mocked(StacksApi.getMarkets).mockResolvedValue([emptyPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    // Should show 50/50 odds when no bets placed
    const fiftyPercentElements = screen.getAllByText('50% of pool');
    expect(fiftyPercentElements).toHaveLength(2);
  });
});
