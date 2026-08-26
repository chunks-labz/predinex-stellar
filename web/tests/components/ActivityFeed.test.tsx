import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ActivityFeed from '../../app/components/ActivityFeed';
import { ActivityItem } from '../../app/lib/market-types';

const mockActivities: ActivityItem[] = [
    {
        txId: '0x1',
        type: 'bet-placed',
        functionName: 'place-bet',
        timestamp: Math.floor(Date.now() / 1000) - 3600,
        status: 'success',
        amount: 5000000,
        poolId: 10,
        explorerUrl: '#'
    }
];

describe('ActivityFeed Component', () => {
    it('renders loading skeleton when isLoading is true', () => {
        render(<ActivityFeed activities={[]} isLoading={true} error={null} />);
        // Check for animate-pulse elements
        expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders activity items when data is provided', () => {
        render(<ActivityFeed activities={mockActivities} isLoading={false} error={null} />);
        expect(screen.getByText('Bet Placed')).toBeInTheDocument();
        expect(screen.getByText('5.00 STX')).toBeInTheDocument();
        expect(screen.getByText('Pool #10')).toBeInTheDocument();
    });

    it('renders empty state when no activities', () => {
        render(<ActivityFeed activities={[]} isLoading={false} error={null} />);
        expect(screen.getByText('No Activity Yet')).toBeInTheDocument();
        expect(screen.getByText('Explore Markets')).toBeInTheDocument();
    });

    it('renders error message when error is provided', () => {
        render(<ActivityFeed activities={[]} isLoading={false} error="Failed to load" />);
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });
});
