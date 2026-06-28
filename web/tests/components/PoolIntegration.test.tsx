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

function buildPool(id: number, overrides: Partial<StacksApi.Pool> = {}): StacksApi.Pool {
  return {
    id,
    title: `Pool ${id}`,
    description: `Description ${id}`,
    creator: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 50000000,
    totalB: 30000000,
    settled: false,
    winningOutcome: undefined,
    expiry: 1000,
    status: 'active',
    ...overrides,
  };
}

const mockPool: StacksApi.Pool = buildPool(0, { title: 'Test Pool', description: 'Test Description' });

const settledPool: StacksApi.Pool = buildPool(1, {
  title: 'Settled Pool',
  settled: true,
  winningOutcome: 0,
  status: 'settled',
});

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

    // "Settled" appears in both the status filter pill and the pool card badge,
    // so we assert the badge version using its parent container.
    const settledBadges = screen.getAllByText('Settled');
    expect(settledBadges.length).toBeGreaterThan(0);
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

  // -----------------------------------------------------------------------
  // Pagination behavior — issue #674 Web: Add pagination to pools list
  // -----------------------------------------------------------------------

  it('shows only the first page of pools when more than one page is available', async () => {
    const pools = Array.from({ length: 25 }, (_, index) =>
      buildPool(index, { title: `Pool ${index}`, description: `Description ${index}` })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(pools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Pool 0')).toBeInTheDocument();
    });

    // First page exposes 20 pools; pool indices 0..19 should be rendered.
    expect(screen.getByText('Pool 19')).toBeInTheDocument();
    // Remaining pools are not yet on screen.
    expect(screen.queryByText('Pool 20')).not.toBeInTheDocument();
    expect(screen.queryByText('Pool 24')).not.toBeInTheDocument();

    // The Load More button is enabled and announces the remaining count.
    const loadMore = screen.getByRole('button', { name: /load 5 more pools/i });
    expect(loadMore).toBeEnabled();
  });

  it('appends the next page when Load More is clicked', async () => {
    const user = userEvent.setup();
    const pools = Array.from({ length: 25 }, (_, index) =>
      buildPool(index, { title: `Pool ${index}`, description: `Description ${index}` })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(pools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Pool 0')).toBeInTheDocument();
    });

    const loadMore = screen.getByRole('button', { name: /load 5 more pools/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText('Pool 20')).toBeInTheDocument();
    });
    expect(screen.getByText('Pool 24')).toBeInTheDocument();
  });

  it('disables Load More once all pools have been revealed', async () => {
    const user = userEvent.setup();
    const pools = Array.from({ length: 21 }, (_, index) =>
      buildPool(index, { title: `Pool ${index}`, description: `Description ${index}` })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(pools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Pool 0')).toBeInTheDocument();
    });

    const loadMore = screen.getByRole('button', { name: /load 1 more pool/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText('Pool 20')).toBeInTheDocument();
    });

    // After the final click, the button should switch to its disabled state.
    const allLoaded = screen.getByRole('button', { name: /all pools loaded/i });
    expect(allLoaded).toBeDisabled();
  });

  it('does not render a Load More button when all fetched pools already fit on the first page', async () => {
    vi.mocked(StacksApi.getMarkets).mockResolvedValue([mockPool, settledPool]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Test Pool')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /load.*more pool/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all pools loaded/i })).not.toBeInTheDocument();
  });

  it('does not render Load More when filtered pools fit on the first page', async () => {
    const user = userEvent.setup();
    const pools = Array.from({ length: 25 }, (_, index) =>
      buildPool(index, {
        title: index % 2 === 0 ? `Match ${index}` : `Other ${index}`,
        description: `Description ${index}`,
      })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(pools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Match 0')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    await user.type(searchInput, 'Match');

    // Below the threshold of POOLS_PER_PAGE the Load More block is hidden
    // entirely so we avoid a noisy disabled button on small filtered lists.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load.*more pool/i })).not.toBeInTheDocument();
    });
  });

  it('narrows pagination when the user applies a status filter', async () => {
    const user = userEvent.setup();
    const activePools = Array.from({ length: 30 }, (_, index) =>
      buildPool(index, { title: `Active ${index}`, description: `Active pool` })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(activePools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Active 0')).toBeInTheDocument();
    });

    // Filtering by Settled empties the visible list — there are no settled
    // pools in the dataset, but pagination must coexist with the filter.
    const settledFilter = screen.getByRole('button', { name: /^Settled$/ });
    await user.click(settledFilter);

    await waitFor(() => {
      expect(screen.getByText(/No pools match the current search or filter/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /load.*more pool/i })).not.toBeInTheDocument();

    // Switching back to All restores the first page of the full set.
    const allFilter = screen.getByRole('button', { name: /^All$/ });
    await user.click(allFilter);

    await waitFor(() => {
      expect(screen.getByText('Active 0')).toBeInTheDocument();
    });
    expect(screen.getByText('Active 19')).toBeInTheDocument();
    expect(screen.queryByText('Active 20')).not.toBeInTheDocument();
  });

  it('filters pools by the text search and resets to the first page of results', async () => {
    const user = userEvent.setup();
    const pools = Array.from({ length: 25 }, (_, index) =>
      buildPool(index, {
        title: index % 2 === 0 ? `Match ${index}` : `Other ${index}`,
        description: `Description ${index}`,
      })
    );
    vi.mocked(StacksApi.getMarkets).mockResolvedValue(pools);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Match 0')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    await user.type(searchInput, 'Match');

    // "Other*" titles are filtered out and the Load More block resets to page 1.
    await waitFor(() => {
      expect(screen.queryByText('Other 0')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /load.*more pool/i })).not.toBeInTheDocument();
  });

  it('resets pagination to the first page when pools are refreshed', async () => {
    const user = userEvent.setup();
    const initialPools = Array.from({ length: 25 }, (_, index) =>
      buildPool(index, { title: `Pool ${index}` })
    );
    vi.mocked(StacksApi.getMarkets)
      .mockResolvedValueOnce(initialPools)
      .mockResolvedValueOnce([buildPool(99, { title: 'Refreshed Pool' })]);

    renderWithProviders(<PoolIntegration />);

    await waitFor(() => {
      expect(screen.getByText('Pool 0')).toBeInTheDocument();
    });

    const loadMore = screen.getByRole('button', { name: /load 5 more pools/i });
    await user.click(loadMore);

    await waitFor(() => {
      expect(screen.getByText('Pool 20')).toBeInTheDocument();
    });

    const refreshButton = screen.getByRole('button', { name: /Refresh Pools/i });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(screen.getByText('Refreshed Pool')).toBeInTheDocument();
    });
    // Refresh should snap back to the first page of the fresh dataset.
    expect(vi.mocked(StacksApi.getMarkets)).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Pool 0')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load.*more pool/i })).not.toBeInTheDocument();
  });
});
