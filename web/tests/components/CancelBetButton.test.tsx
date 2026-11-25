import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CancelBetButton from '../../app/components/user-dashboard/CancelBetButton';
import { DashboardHistoryPanel } from '../../app/components/user-dashboard/DashboardBetPanels';
import { predinexContract } from '../../app/lib/adapters/predinex-contract';
import type { UserBet } from '../../app/lib/user-dashboard/types';

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: () => ({ address: 'GBUSER123STELLARADDRESS', isConnected: true }),
}));

vi.mock('../../app/lib/adapters/predinex-contract', () => ({
  predinexContract: { cancelBetSoroban: vi.fn() },
}));

const mockCancel = vi.mocked(predinexContract.cancelBetSoroban);

const bet: UserBet = {
  poolId: 7,
  poolTitle: 'Will XLM close above $1?',
  outcome: 'Yes',
  amount: 12.5,
  status: 'active',
  createdAt: 0,
  outcomeIndex: 0,
  stakeStroops: 125_000_000,
  cancellable: true,
};

describe('CancelBetButton (#1702)', () => {
  beforeEach(() => {
    mockCancel.mockReset();
  });

  it('opens a dialog naming the market and the bet', async () => {
    render(<CancelBetButton bet={bet} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel bet' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Will XLM close above $1?');
    expect(dialog).toHaveTextContent('12.50');
    expect(dialog).toHaveTextContent('on Yes');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('dismissing the dialog leaves the bet untouched', async () => {
    render(<CancelBetButton bet={bet} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel bet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep bet' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('submits once, disables the button while pending, then reports success', async () => {
    let resolve!: (v: { txHash: string }) => void;
    mockCancel.mockReturnValue(new Promise((r) => (resolve = r)));
    const onCancelled = vi.fn();
    render(<CancelBetButton bet={bet} onCancelled={onCancelled} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel bet' }));
    const confirm = screen.getByRole('button', { name: 'Confirm cancel' });
    await userEvent.click(confirm);
    await userEvent.click(confirm);

    expect(confirm).toBeDisabled();
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(
      expect.objectContaining({ poolId: 7, outcome: 0, amountStroops: 125_000_000 }),
    );

    resolve({ txHash: 'abc' });
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the error when the cancel fails', async () => {
    mockCancel.mockRejectedValue(new Error('PoolExpired'));
    render(<CancelBetButton bet={bet} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel bet' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('PoolExpired');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders nothing for a bet that cannot be cancelled', () => {
    const { container } = render(<CancelBetButton bet={{ ...bet, cancellable: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DashboardHistoryPanel realized PnL (#1701)', () => {
  it('shows signed PnL with the token symbol, and a dash when unknown', () => {
    render(
      <DashboardHistoryPanel
        isLoading={false}
        bets={[
          { ...bet, poolId: 1, poolTitle: 'Won', status: 'won', amount: 20, winnings: 45 },
          { ...bet, poolId: 2, poolTitle: 'Lost', status: 'lost', amount: 10 },
          { ...bet, poolId: 3, poolTitle: 'Unknown', status: 'won', amount: 5, winnings: undefined },
        ]}
      />,
    );

    expect(screen.getByText(/PnL \+\s*25\.00/)).toBeInTheDocument();
    expect(screen.getByText(/PnL -\s*10\.00/)).toBeInTheDocument();
    expect(screen.getByText('Realized PnL not available')).toBeInTheDocument();
    expect(screen.queryByText(/PnL [+-]?\s*0\.00/)).not.toBeInTheDocument();
  });
});
