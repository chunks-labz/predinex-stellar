import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClaimWinningsButton from '../../components/ClaimWinningsButton';
import { renderWithProviders } from '../helpers/renderWithProviders';
import { useWallet } from '@/components/WalletAdapterProvider';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: {
    claimWinningsSoroban: vi.fn(),
  },
}));

vi.mock('../../app/lib/notifications', () => ({
  notifyBrowserEvent: vi.fn(),
}));

vi.mock('../../app/lib/cache-invalidation', () => ({
  invalidateOnClaimWinnings: vi.fn(),
}));

const mockUseWallet = vi.mocked(useWallet);
const mockClaim = vi.mocked(predinexContract.claimWinningsSoroban);

type ClaimParams = Parameters<typeof predinexContract.claimWinningsSoroban>[0];

/** Mimics the service: wait for the fee prompt answer before "signing". */
function claimThatAsksForFee() {
  mockClaim.mockImplementation(async (params: ClaimParams) => {
    const proceed = await params.onFeeEstimated?.('12345');
    if (proceed === false) throw new Error('Transaction cancelled by user');
    return { txHash: 'tx-claim' };
  });
}

describe('ClaimWinningsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWallet.mockReturnValue({
      isConnected: true,
      isLoading: false,
      address: 'GTESTADDRESS',
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>);
  });

  it('shows the fee prompt and completes the claim once confirmed', async () => {
    claimThatAsksForFee();
    const onClaimSuccess = vi.fn();

    renderWithProviders(
      <ClaimWinningsButton poolId={7} isSettled userHasWinnings onClaimSuccess={onClaimSuccess} />
    );

    await userEvent.click(screen.getByRole('button', { name: /claim your winnings/i }));

    // Without the modal the claim waited forever on the fee prompt.
    const dialog = await screen.findByRole('dialog', { name: /confirm transaction/i });
    expect(dialog).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(onClaimSuccess).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /claim your winnings/i })).not.toBeDisabled();
  });

  it('re-enables the button without an inline error when the fee prompt is cancelled', async () => {
    claimThatAsksForFee();

    renderWithProviders(<ClaimWinningsButton poolId={7} isSettled userHasWinnings />);

    await userEvent.click(screen.getByRole('button', { name: /claim your winnings/i }));
    await screen.findByRole('dialog', { name: /confirm transaction/i });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /claim your winnings/i })).not.toBeDisabled()
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the failure inline when the claim fails', async () => {
    mockClaim.mockRejectedValue(new Error('Simulation failed'));

    renderWithProviders(<ClaimWinningsButton poolId={7} isSettled userHasWinnings />);
    await userEvent.click(screen.getByRole('button', { name: /claim your winnings/i }));

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((el) => el.textContent?.includes('Simulation failed'))
      ).toBe(true)
    );
  });
});
