import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DisputeHistoryTimeline from '../../app/components/DisputeHistoryTimeline';
import type { DisputeTimelineEvent } from '../../app/lib/dispute-history';

const EVENTS: DisputeTimelineEvent[] = [
  {
    type: 'disputed',
    actor: 'GBQODISPUTERABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    timestamp: Date.parse('2026-03-01T10:00:00Z') / 1000,
    txHash: 'txdispute',
    explorerUrl: 'https://explorer.example/tx/txdispute',
  },
  {
    type: 'unfrozen',
    actor: 'GADMINUNFREEZERABCDEFGHIJKLMNOPQRSTUVWXYZ77',
    timestamp: Date.parse('2026-03-05T12:00:00Z') / 1000,
    txHash: 'txunfreeze',
    explorerUrl: 'https://explorer.example/tx/txunfreeze',
  },
];

describe('DisputeHistoryTimeline', () => {
  it('renders an entry per event with labels and explorer links', () => {
    render(<DisputeHistoryTimeline events={EVENTS} />);

    expect(screen.getByText('Dispute initiated')).toBeInTheDocument();
    expect(screen.getByText('Pool unfrozen')).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const links = screen.getAllByRole('link', { name: /view on explorer/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://explorer.example/tx/txdispute');
  });

  it('shows the triggering address for each event', () => {
    render(<DisputeHistoryTimeline events={EVENTS} />);
    // TruncatedAddress exposes the full address via aria-label.
    expect(
      screen.getByLabelText('GBQODISPUTERABCDEFGHIJKLMNOPQRSTUVWXYZ234567')
    ).toBeInTheDocument();
  });

  it('renders an empty state for never-disputed pools', () => {
    render(<DisputeHistoryTimeline events={[]} />);
    expect(screen.getByText('No disputes on record')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a loading state', () => {
    render(<DisputeHistoryTimeline events={[]} isLoading />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading dispute history/i);
  });

  it('renders an error state', () => {
    render(<DisputeHistoryTimeline events={[]} error="RPC unavailable" />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('RPC unavailable')).toBeInTheDocument();
  });
});
