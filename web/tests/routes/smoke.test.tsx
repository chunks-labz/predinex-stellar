/**
 * Route smoke tests — verify every top-level App Router page mounts without
 * crashing.  These tests catch broken imports, missing providers, and
 * route-only regressions that component-focused suites won't see.
 *
 * Each test renders the page inside the shared provider tree and asserts that
 * the route's landmark element (main) is present in the document.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../helpers/renderWithProviders';

// ── Shared infrastructure mocks ───────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComponent = React.lazy(loader);
    return function DynamicComponent(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <LazyComponent {...props} />
        </React.Suspense>
      );
    };
  },
}));

// ── Wallet / auth mocks ───────────────────────────────────────────────────────

const mockWallet = {
  chain: 'stacks' as const,
  isConnected: false,
  isLoading: false,
  address: null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(() => mockWallet),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/StacksProvider', () => ({
  useStacks: vi.fn(() => ({
    userData: null,
    authenticate: vi.fn(),
    userSession: {},
    setUserData: vi.fn(),
    signOut: vi.fn(),
    openWalletModal: vi.fn(),
    isLoading: false,
  })),
  StacksProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/hooks/useWalletConnect', () => ({
  useWalletConnect: vi.fn(() => ({ session: null })),
}));

// ── UI / layout mocks ─────────────────────────────────────────────────────────

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/RouteErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Data / hook mocks ─────────────────────────────────────────────────────────

vi.mock('../../app/lib/hooks/useMarketDiscovery', () => ({
  useMarketDiscovery: vi.fn(() => ({
    paginatedMarkets: [],
    isLoading: false,
    error: null,
    blockHeightWarning: null,
    filters: {
      search: '',
      status: 'all',
      asset: 'all',
      minVolume: '',
      maxVolume: '',
      timeRange: 'all',
      sortBy: 'newest',
    },
    assetOptions: ['STX'],
    hasActiveFilters: false,
    pagination: { page: 1, totalPages: 1, total: 0, pageSize: 12 },
    setSearch: vi.fn(),
    setStatusFilter: vi.fn(),
    setAssetFilter: vi.fn(),
    setMinVolume: vi.fn(),
    setMaxVolume: vi.fn(),
    setTimeRange: vi.fn(),
    setSortBy: vi.fn(),
    resetFilters: vi.fn(),
    setPage: vi.fn(),
    retry: vi.fn(),
    filteredMarkets: [],
  })),
}));

vi.mock('../../app/lib/hooks/useLeaderboard', () => ({
  useLeaderboard: vi.fn(() => ({ userRank: null, entries: [] })),
}));

vi.mock('../../app/hooks/useUserActivity', () => ({
  useUserActivity: vi.fn(() => ({
    activities: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  })),
}));

vi.mock('../../app/lib/hooks/useActiveBets', () => ({
  useActiveBets: vi.fn(() => ({
    activeBets: [],
    isLoading: false,
    refresh: vi.fn(),
  })),
}));

vi.mock('../../app/lib/hooks/useWalletConnect', () => ({
  useWalletConnect: vi.fn(() => ({ session: null })),
}));

vi.mock('../../app/lib/hooks/usePoolFavorites', () => ({
  usePoolFavorites: vi.fn(() => ({ isFavorite: vi.fn(() => false), toggleFavorite: vi.fn() })),
}));

vi.mock('../../app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getPool: vi.fn(() => Promise.resolve(null)),
    getUserBet: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('../../lib/hooks/useNetworkMismatch', () => ({
  useNetworkMismatch: vi.fn(() => ({
    isMismatch: false,
    expectedNetworkName: 'Stellar Testnet',
    currentNetworkName: 'Stellar Testnet',
    expectedNetworkType: 'testnet',
    switchNetwork: vi.fn(),
  })),
}));

// ── Component mocks (heavy/async dependencies) ────────────────────────────────

vi.mock('../../app/components/Hero', () => ({
  default: () => <section data-testid="hero" />,
}));

vi.mock('../../app/components/IncentivesDisplay', () => ({
  default: () => <div data-testid="incentives-display" />,
}));

vi.mock('../../app/components/DisputeManagement', () => ({
  default: () => <div data-testid="dispute-management" />,
}));

vi.mock('@/components/SearchBar', () => ({
  default: () => <input data-testid="search-bar" />,
}));

vi.mock('@/components/FilterControls', () => ({
  default: () => <div data-testid="filter-controls" />,
}));

vi.mock('@/components/SortControls', () => ({
  default: () => <div data-testid="sort-controls" />,
}));

vi.mock('@/components/MarketGrid', () => ({
  default: () => <div data-testid="market-grid" />,
}));

vi.mock('@/components/Pagination', () => ({
  default: () => <div data-testid="pagination" />,
}));

vi.mock('../../app/components/ActivityFeed', () => ({
  default: () => <div data-testid="activity-feed" />,
}));

vi.mock('../../components/Leaderboard', () => ({
  default: () => <div data-testid="leaderboard" />,
}));

vi.mock('../../components/PlatformStats', () => ({
  default: () => <div data-testid="platform-stats" />,
}));

vi.mock('../../components/PortfolioOverview', () => ({
  default: () => <div data-testid="portfolio-overview" />,
}));

vi.mock('../../components/EmptyState', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  default: ({ message }: { message: string }) => <p>{message}</p>,
}));

vi.mock('../../components/DisconnectedState', () => ({
  DisconnectedState: () => <div data-testid="disconnected-state" />,
  default: () => <div data-testid="disconnected-state" />,
}));

vi.mock('../../app/components/dashboard/ActiveBetsCard', () => ({
  default: () => <div data-testid="active-bets-card" />,
}));

vi.mock('../../components/ui/StatsCard', () => ({
  StatsCard: ({ title, value }: { title: string; value: unknown }) => (
    <div data-testid="stats-card">{title}: {String(value)}</div>
  ),
}));

vi.mock('../../components/ui/MarketCardHeader', () => ({
  default: () => <div data-testid="market-card-header" />,
}));

vi.mock('../../components/ui/accordion', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'testnet',
    contract: {
      address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
      name: 'predinex-pool',
      id: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.predinex-pool',
    },
    api: { coreApiUrl: '', explorerUrl: '', rpcUrl: '' },
  })),
}));

vi.mock('@stacks/connect', () => ({
  openContractCall: vi.fn(),
  AppConfig: vi.fn(),
  UserSession: vi.fn(() => ({
    isSignInPending: () => false,
    isUserSignedIn: () => false,
    handlePendingSignIn: vi.fn(),
    loadUserData: vi.fn(),
    signUserOut: vi.fn(),
  })),
  showConnect: vi.fn(),
}));

// ── Route imports ─────────────────────────────────────────────────────────────

import HomePage from '../../app/page';
import MarketsPage from '../../app/markets/page';
import PoolDetailPage from '../../app/markets/[id]/page';
import CreatePage from '../../app/create/page';
import DashboardPage from '../../app/dashboard/page';
import DisputesPage from '../../app/disputes/page';
import RewardsPage from '../../app/rewards/page';
import ActivityPage from '../../app/activity/page';
import IncentivesPage from '../../app/incentives/page';

// ── Smoke suite ───────────────────────────────────────────────────────────────

import * as WalletAdapterProvider from '@/components/WalletAdapterProvider';

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM',
  connect: vi.fn(),
  disconnect: vi.fn(),
};

describe('Route smoke tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to disconnected wallet; individual tests override as needed.
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(mockWallet);
  });

  it('home (/) renders without crashing', () => {
    renderWithProviders(<HomePage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/markets renders without crashing', () => {
    renderWithProviders(<MarketsPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/create renders without crashing', () => {
    renderWithProviders(<CreatePage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/dashboard renders without crashing', () => {
    // Dashboard shows the full layout only when a wallet is connected.
    vi.mocked(WalletAdapterProvider.useWallet).mockReturnValue(connectedWallet);
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/disputes renders without crashing', () => {
    renderWithProviders(<DisputesPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/rewards renders without crashing', () => {
    renderWithProviders(<RewardsPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/activity renders without crashing', () => {
    renderWithProviders(<ActivityPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/incentives renders without crashing', () => {
    renderWithProviders(<IncentivesPage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('/markets/[id] renders without crashing (loading state)', async () => {
    // Params resolve asynchronously; the page shows a loading skeleton first.
    renderWithProviders(
      <PoolDetailPage params={Promise.resolve({ id: '1' })} />
    );
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });
});
