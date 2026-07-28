import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PredinexWidget } from '../src/PredinexWidget';
import type { WidgetPool } from '../src/types';

const mockPool: WidgetPool = {
  id: 1,
  title: 'Will ETH hit $5k?',
  description: 'End of 2025',
  outcomeA: 'Yes',
  outcomeB: 'No',
  totalA: 300,
  totalB: 700,
  settled: false,
  expiry: 9999999,
  status: 'open',
};

const fetchPool = vi.fn().mockResolvedValue(mockPool);
const placeBet  = vi.fn().mockResolvedValue('abc123txid');

describe('PredinexWidget', () => {
  it('renders loading state while fetching', () => {
    render(<PredinexWidget contractId="C123" poolId={1} fetchPool={fetchPool} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading pool…');
  });

  it('renders pool after fetch resolves', async () => {
    render(<PredinexWidget contractId="C123" poolId={1} fetchPool={fetchPool} />);
    await waitFor(() => expect(screen.getByText('Will ETH hit $5k?')).toBeInTheDocument());
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders "provide poolId" hint when no poolId given', () => {
    render(<PredinexWidget contractId="C123" fetchPool={fetchPool} />);
    expect(screen.getByText(/provide a/i)).toBeInTheDocument();
  });

  it('shows error when fetchPool rejects', async () => {
    const badFetch = vi.fn().mockRejectedValue(new Error('RPC down'));
    render(<PredinexWidget contractId="C123" poolId={1} fetchPool={badFetch} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('RPC down'));
  });

  it('calls placeBet and shows success', async () => {
    const onBet = vi.fn();
    render(
      <PredinexWidget
        contractId="C123"
        poolId={1}
        fetchPool={fetchPool}
        placeBet={placeBet}
        onBet={onBet}
      />
    );
    await waitFor(() => screen.getByText('Yes'));

    fireEvent.click(screen.getByText('Yes'));
    fireEvent.change(screen.getByLabelText(/bet amount/i), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Bet'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('abc123tx'));
    expect(onBet).toHaveBeenCalledWith(1, 0, 10);
  });

  it('shows error for invalid amount', async () => {
    render(<PredinexWidget contractId="C123" poolId={1} fetchPool={fetchPool} placeBet={placeBet} />);
    await waitFor(() => screen.getByText('Yes'));

    fireEvent.click(screen.getByText('No'));
    fireEvent.click(screen.getByText('Bet'));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('valid amount'));
  });

  it('applies custom theme via CSS vars', async () => {
    const { container } = render(
      <PredinexWidget contractId="C123" poolId={1} fetchPool={fetchPool} theme={{ primaryColor: '#ff0000', mode: 'dark' }} />
    );
    const widget = container.querySelector('.pdx-widget') as HTMLElement;
    expect(widget.style.getPropertyValue('--pdx-primary')).toBe('#ff0000');
    expect(widget.style.getPropertyValue('--pdx-bg')).toBe('#1a1a2e');
  });

  it('shows winner banner for settled pool', async () => {
    const settled: WidgetPool = { ...mockPool, status: 'settled', settled: true, winningOutcome: 1 };
    render(<PredinexWidget contractId="C123" poolId={1} fetchPool={vi.fn().mockResolvedValue(settled)} />);
    await waitFor(() => expect(screen.getByText(/Winner: No/)).toBeInTheDocument());
  });
});
