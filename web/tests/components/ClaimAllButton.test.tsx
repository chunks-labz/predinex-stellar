import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClaimAllButton, { type ClaimablePool } from '../../components/ClaimAllButton';
import { renderWithProviders } from '../helpers/renderWithProviders';
import { useWallet } from '@/components/WalletAdapterProvider';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    claimAllWinningsSoroban: vi.fn(),
  },
}));

vi.mock('../../app/lib/notifications', () => ({
  notifyBrowserEvent: vi.fn(),
}));

vi.mock('../../app/lib/cache-invalidation', () => ({
  invalidateOnClaimWinnings: vi.fn(),
}));

const mockUseWallet = vi.mocked(useWallet);
const mockClaimAll = vi.mocked(predinexContract.claimAllWinningsSoroban);

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const POOLS: ClaimablePool[] = [
  { poolId: 1, marketTitle: 'BTC > 100k?' },
  { poolId: 2, marketTitle: 'ETH > 5k?' },
];

function connectedWallet() {
  mockUseWallet.mockReturnValue({
    isConnected: true,
    isLoading: false,
    address: 'GTESTADDRESS',
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as ReturnType<typeof useWallet>);
}

describe('ClaimAllButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectedWallet();
  });

  it('shows the "No claims available" empty state when there are no claims', () => {
    renderWithProviders(<ClaimAllButton claimablePools={[]} userAddress="GTESTADDRESS" />);
    expect(screen.getByTestId('claim-all-empty')).toHaveTextContent('No claims available');
    expect(screen.queryByTestId('claim-all-button')).not.toBeInTheDocument();
  });

  it('renders the button with the claim count when claims exist', () => {
    renderWithProviders(<ClaimAllButton claimablePools={POOLS} userAddress="GTESTADDRESS" />);
    const button = screen.getByTestId('claim-all-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Claim All (2)');
  });

  it('opens the progress modal and resolves to a success state', async () => {
    const deferred = createDeferred<{ txHash: string; claimedPoolIds: number[] }>();
    mockClaimAll.mockReturnValue(deferred.promise);
    const onSuccess = vi.fn();

    renderWithProviders(
      <ClaimAllButton claimablePools={POOLS} userAddress="GTESTADDRESS" onClaimSuccess={onSuccess} />
    );

    await userEvent.click(screen.getByTestId('claim-all-button'));

    // In-flight: modal shows the "Claiming 1/2…" counter and per-pool rows.
    await waitFor(() => {
      expect(screen.getByTestId('claim-all-header')).toHaveTextContent('Claiming 1/2…');
    });
    expect(screen.getByTestId('claim-all-pool-1')).toHaveTextContent('BTC > 100k?');
    expect(screen.getByTestId('claim-all-pool-2')).toHaveTextContent('ETH > 5k?');

    // The batched call is invoked once with both pool ids.
    expect(mockClaimAll).toHaveBeenCalledTimes(1);
    expect(mockClaimAll.mock.calls[0][0]).toMatchObject({ poolIds: [1, 2] });

    // Resolve the transaction → success state (both pools paid out).
    deferred.resolve({ txHash: 'abc123', claimedPoolIds: [1, 2] });

    await waitFor(() => {
      expect(screen.getByTestId('claim-all-header')).toHaveTextContent('Claimed 2/2');
    });
    expect(screen.getByTestId('claim-all-pool-1')).toHaveTextContent('Claimed');
    expect(screen.getByTestId('claim-all-pool-2')).toHaveTextContent('Claimed');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows a partial state when only some pools pay out', async () => {
    // Only pool 1 paid out; pool 2 was skipped by the contract.
    mockClaimAll.mockResolvedValue({ txHash: 'partial1', claimedPoolIds: [1] });

    renderWithProviders(<ClaimAllButton claimablePools={POOLS} userAddress="GTESTADDRESS" />);
    await userEvent.click(screen.getByTestId('claim-all-button'));

    await waitFor(() => {
      expect(screen.getByTestId('claim-all-header')).toHaveTextContent('Claimed 1/2');
    });
    expect(screen.getByTestId('claim-all-pool-1')).toHaveTextContent('Claimed');
    expect(screen.getByTestId('claim-all-pool-2')).toHaveTextContent('No payout');
  });

  it('shows a failed state when the batched claim throws', async () => {
    mockClaimAll.mockRejectedValue(new Error('Simulation failed'));

    renderWithProviders(<ClaimAllButton claimablePools={POOLS} userAddress="GTESTADDRESS" />);
    await userEvent.click(screen.getByTestId('claim-all-button'));

    await waitFor(() => {
      expect(screen.getByTestId('claim-all-header')).toHaveTextContent('Claim failed');
    });
    // The error surfaces in the modal (and a toast), so allow multiple matches.
    expect(screen.getAllByText('Simulation failed').length).toBeGreaterThan(0);
  });

  it('caps the batch at 20 pools', async () => {
    const many: ClaimablePool[] = Array.from({ length: 25 }, (_, i) => ({
      poolId: i + 1,
      marketTitle: `Pool ${i + 1}`,
    }));
    const deferred = createDeferred<{ txHash: string; claimedPoolIds: number[] }>();
    mockClaimAll.mockReturnValue(deferred.promise);

    renderWithProviders(<ClaimAllButton claimablePools={many} userAddress="GTESTADDRESS" />);
    expect(screen.getByTestId('claim-all-button')).toHaveTextContent('Claim All (20)');

    await userEvent.click(screen.getByTestId('claim-all-button'));
    await waitFor(() => expect(mockClaimAll).toHaveBeenCalledTimes(1));
    expect(mockClaimAll.mock.calls[0][0].poolIds).toHaveLength(20);

    deferred.resolve({ txHash: 'ok', claimedPoolIds: many.slice(0, 20).map((p) => p.poolId) });
  });
});
