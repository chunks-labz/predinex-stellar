import React from 'react';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../helpers/renderWithProviders';
import DashboardPage from '../../app/dashboard/page';
import PoolDetailsPage from '../../app/markets/[id]/page';
import type { ActivityItem } from '../../app/lib/adapters/types';
import type { UserBet } from '../../app/lib/dashboard-types';
import type { Pool } from '../../app/lib/stacks-api';
import type { UserBetData } from '../../app/lib/soroban-read-api';
import { userActivityCache, userDashboardCache } from '../../app/lib/cache-invalidation';

type ClaimRequest = {
  wallet?: unknown;
  poolId: number;
  onStageChange?: (stage: string) => void;
  onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const {
  mockClaimWinningsSoroban,
  mockGetUserBets,
  mockGetUserActivitySoroban,
  mockGetPool,
  mockGetUserBet,
  mockUseWallet,
} = vi.hoisted(() => ({
  mockClaimWinningsSoroban: vi.fn(),
  mockGetUserBets: vi.fn(),
  mockGetUserActivitySoroban: vi.fn(),
  mockGetPool: vi.fn(),
  mockGetUserBet: vi.fn(),
  mockUseWallet: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
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

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    claimWinningsSoroban: mockClaimWinningsSoroban,
  },
}));

vi.mock('../../app/lib/runtime-config', () => ({
  getRuntimeConfig: vi.fn(() => ({
    network: 'testnet' as const,
    contract: {
      address: 'ST1TEST',
      name: 'predinex-pool',
      id: 'ST1TEST.predinex-pool',
    },
    api: {
      coreApiUrl: 'https://api.testnet.hiro.so',
      explorerUrl: 'https://explorer.hiro.so',
      rpcUrl: 'https://api.testnet.hiro.so',
    },
    soroban: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      contractId: 'CTEST123CONTRACT',
    },
  })),
}));

vi.mock('../../app/lib/dashboard-api', async () => {
  const actual = await vi.importActual<typeof import('../../app/lib/dashboard-api')>(
    '../../app/lib/dashboard-api'
  );

  return {
    ...actual,
    getUserBets: mockGetUserBets,
  };
});

vi.mock('../../app/lib/adapters/predinex-read-api', () => ({
  predinexReadApi: {
    getUserActivitySoroban: mockGetUserActivitySoroban,
    getPool: mockGetPool,
    getUserBet: mockGetUserBet,
  },
}));

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: mockUseWallet,
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/AuthGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/RouteErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/PlatformStats', () => ({
  default: () => <div data-testid="platform-stats" />,
}));

vi.mock('../../components/PortfolioOverview', () => ({
  default: () => <div data-testid="portfolio-overview" />,
}));

vi.mock('@/components/BettingSection', () => ({
  default: () => <div data-testid="betting-section" />,
}));

vi.mock('../../components/ShareButton', () => ({
  default: () => <button type="button">Share</button>,
}));

vi.mock('../../components/TruncatedAddress', () => ({
  TruncatedAddress: ({ address }: { address: string }) => <>{address}</>,
}));

const connectedWallet = {
  chain: 'stacks' as const,
  isConnected: true,
  isLoading: false,
  address: 'ST1CLAIMTESTUSER',
  connect: vi.fn(),
  disconnect: vi.fn(),
};

function makeClaimableBet(): UserBet {
  return {
    poolId: 42,
    marketTitle: 'Will BTC hit 100k?',
    outcomeChosen: 'A',
    outcomeName: 'Yes',
    amountBet: 2_000_000,
    betTimestamp: 1_710_000_000,
    currentOdds: 58,
    potentialWinnings: 3_000_000,
    status: 'won',
    claimStatus: 'unclaimed',
    claimableAmount: 3_000_000,
  };
}

function makeClaimedBet(): UserBet {
  return {
    ...makeClaimableBet(),
    claimStatus: 'claimed',
  };
}

function makeBetActivity(): ActivityItem {
  return {
    txId: '0xbet-1',
    type: 'bet-placed',
    functionName: 'place_bet',
    timestamp: 1_710_000_100,
    status: 'success',
    amount: 2_000_000,
    poolId: 42,
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/0xbet-1',
    event: {
      type: 'bet',
      poolId: 42,
      amount: 2_000_000,
      outcome: 0,
    },
  };
}

function makeClaimActivity(): ActivityItem {
  return {
    txId: '0xclaim-1',
    type: 'winnings-claimed',
    functionName: 'claim_winnings',
    timestamp: 1_710_000_200,
    status: 'success',
    amount: 3_000_000,
    poolId: 42,
    explorerUrl: 'https://stellar.expert/explorer/testnet/tx/0xclaim-1',
    event: {
      type: 'claim',
      poolId: 42,
      winnerAmount: 3_000_000,
    },
  };
}

function makeSettledPool(): Pool {
  return {
    id: 42,
    title: 'Will BTC hit 100k?',
    description: 'Test settled pool',
    creator: 'ST1CREATOR',
    outcomeA: 'Yes',
    outcomeB: 'No',
    totalA: 8_000_000,
    totalB: 4_000_000,
    settled: true,
    winningOutcome: 0,
    expiry: 123456,
    status: 'settled',
  };
}

function makeWinningUserBet(): UserBetData {
  return {
    amountA: 2_000_000,
    amountB: 0,
    totalBet: 2_000_000,
  };
}

async function renderPoolDetails() {
  let view: ReturnType<typeof renderWithProviders> | undefined;

  await act(async () => {
    view = renderWithProviders(
      <React.Suspense fallback={<div>Loading route...</div>}>
        <PoolDetailsPage params={Promise.resolve({ id: '42' })} />
      </React.Suspense>
    );
    await Promise.resolve();
  });

  return view!;
}

describe('claim flow integration', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    userActivityCache.clear();
    userDashboardCache.clear();
    vi.clearAllMocks();
    mockUseWallet.mockReturnValue(connectedWallet);
    mockGetPool.mockResolvedValue(makeSettledPool());
    mockGetUserBet.mockResolvedValue(makeWinningUserBet());
  });

  afterEach(() => {
    cleanup();
  });

  it('refreshes dashboard claim state and activity after a successful claim', async () => {
    const user = userEvent.setup();
    let claimed = false;
    const claimDeferred = createDeferred<{ txHash: string }>();

    mockGetUserBets.mockImplementation(async () => (claimed ? [makeClaimedBet()] : [makeClaimableBet()]));
    mockGetUserActivitySoroban.mockImplementation(async () =>
      claimed ? [makeClaimActivity(), makeBetActivity()] : [makeBetActivity()]
    );
    mockClaimWinningsSoroban.mockImplementation(async (params: ClaimRequest) => {
      const proceed = await params.onFeeEstimated?.('2500');
      if (!proceed) {
        throw new Error('Transaction cancelled by user');
      }
      params.onStageChange?.('signing');
      return claimDeferred.promise;
    });

    renderWithProviders(<DashboardPage />);

    const claimButton = await screen.findByRole(
      'button',
      { name: /claim winnings/i },
      { timeout: 5_000 }
    );
    expect(await screen.findByText('Bet Placed')).toBeInTheDocument();

    await user.click(claimButton);
    await user.click(await screen.findByRole('button', { name: /^confirm$/i }));

    expect(mockClaimWinningsSoroban).toHaveBeenCalledWith(
      expect.objectContaining({ poolId: 42 })
    );
    expect(await screen.findByRole('button', { name: /claiming/i })).toBeDisabled();

    claimed = true;
    await act(async () => {
      claimDeferred.resolve({ txHash: '0xclaim-1' });
      await claimDeferred.promise;
    });

    await waitFor(() => {
      expect(mockGetUserBets).toHaveBeenCalledTimes(2);
      expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('Claim submitted successfully!')).toBeInTheDocument();
    expect(await screen.findByText('Winnings Claimed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /claim winnings/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/ready to claim/i)).not.toBeInTheDocument();
  });

  it('keeps dashboard state unchanged and surfaces the error when a claim fails', async () => {
    const user = userEvent.setup();

    mockGetUserBets.mockResolvedValue([makeClaimableBet()]);
    mockGetUserActivitySoroban.mockResolvedValue([makeBetActivity()]);
    mockClaimWinningsSoroban.mockImplementationOnce(async (params: ClaimRequest) => {
      const proceed = await params.onFeeEstimated?.('2500');
      if (!proceed) {
        throw new Error('Transaction cancelled by user');
      }
      throw new Error('Contract execution failed');
    });

    renderWithProviders(<DashboardPage />);

    await user.click(await screen.findByRole('button', { name: /claim winnings/i }));
    await user.click(await screen.findByRole('button', { name: /^confirm$/i }));

    expect(await screen.findByText('Failed to claim: Contract execution failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /claim winnings/i })).toBeEnabled();
    expect(mockGetUserBets).toHaveBeenCalledTimes(1);
    expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(1);
  });

  it('updates the settled market view to already-claimed after a successful claim', async () => {
    const user = userEvent.setup();
    let claimed = false;
    const claimDeferred = createDeferred<{ txHash: string }>();

    mockGetUserActivitySoroban.mockImplementation(async () =>
      claimed ? [makeClaimActivity()] : [makeBetActivity()]
    );
    mockClaimWinningsSoroban.mockImplementation(async (params: ClaimRequest) => {
      params.onStageChange?.('signing');
      return claimDeferred.promise;
    });

    await renderPoolDetails();

    await user.click(await screen.findByRole('button', { name: /claim winnings/i }));
    expect(await screen.findByRole('button', { name: /processing/i })).toBeDisabled();

    claimed = true;
    await act(async () => {
      claimDeferred.resolve({ txHash: '0xclaim-1' });
      await claimDeferred.promise;
    });

    await waitFor(() => {
      expect(mockGetPool).toHaveBeenCalledTimes(2);
      expect(mockGetUserBet).toHaveBeenCalledTimes(2);
      expect(mockGetUserActivitySoroban).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText('Claim submitted successfully!')).toBeInTheDocument();
    expect(await screen.findByText('Winnings already claimed for this market.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /claim winnings/i })).not.toBeInTheDocument();
  });

  it('keeps the settled market view unchanged when the wallet claim is cancelled', async () => {
    const user = userEvent.setup();
    const claimDeferred = createDeferred<{ txHash: string }>();

    mockGetUserActivitySoroban.mockResolvedValue([makeBetActivity()]);
    mockClaimWinningsSoroban.mockImplementation(async () => claimDeferred.promise);

    await renderPoolDetails();

    await user.click(await screen.findByRole('button', { name: /claim winnings/i }));
    expect(await screen.findByRole('button', { name: /processing/i })).toBeDisabled();
    const poolCallsBeforeCancel = mockGetPool.mock.calls.length;
    const activityCallsBeforeCancel = mockGetUserActivitySoroban.mock.calls.length;

    await act(async () => {
      claimDeferred.reject(new Error('Transaction cancelled by user'));
      try {
        await claimDeferred.promise;
      } catch {
        // The hook handles the cancellation and converts it into UI feedback.
      }
    });

    expect(await screen.findByText('Claim transaction cancelled')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /claim winnings/i })).toBeEnabled();
    expect(mockGetPool.mock.calls.length).toBe(poolCallsBeforeCancel);
    expect(mockGetUserActivitySoroban.mock.calls.length).toBe(activityCallsBeforeCancel);
    expect(screen.queryByText('Winnings already claimed for this market.')).not.toBeInTheDocument();
  });

  it('hides claim controls for markets that are already claimed on initial load', async () => {
    mockGetUserActivitySoroban.mockResolvedValue([makeClaimActivity()]);

    await renderPoolDetails();

    expect(await screen.findByText('Winnings already claimed for this market.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /claim winnings/i })).not.toBeInTheDocument();
  });
});
