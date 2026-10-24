import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActivityFeed from '../../app/components/ActivityFeed';
import { ActivityItem } from '../../app/lib/market-types';
import { TOKEN_SYMBOL } from '../../app/lib/formatting';

const mockActivities: ActivityItem[] = [
    {
        txId: '0x1',
        type: 'bet-placed',
        functionName: 'place-bet',
        timestamp: Math.floor(Date.now() / 1000) - 3600,
        status: 'success',
        amount: 50000000, // 5 XLM (1 XLM = 10_000_000 stroops)
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
        expect(screen.getByText(`5.00 ${TOKEN_SYMBOL}`)).toBeInTheDocument();
        expect(screen.getByText('Pool #10')).toBeInTheDocument();
    });

    it('renders empty state when no activities', () => {
        render(<ActivityFeed activities={[]} isLoading={false} error={null} />);
        expect(screen.getByText('No Activity Yet')).toBeInTheDocument();
        expect(screen.getByText('Explore Markets')).toBeInTheDocument();
    });

    it('renders error message when error is provided', () => {
        render(<ActivityFeed activities={[]} isLoading={false} error="Failed to load" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load');
        // The error explains the empty list; "No Activity Yet" would contradict it.
        expect(screen.queryByText('No Activity Yet')).not.toBeInTheDocument();
    });

    it('tells filtered users that nothing matches instead of "no activity"', () => {
        const onClearFilters = vi.fn();
        render(
            <ActivityFeed
                activities={[]}
                isLoading={false}
                error={null}
                isFiltered
                onClearFilters={onClearFilters}
            />
        );
        expect(screen.getByText('No matching activity')).toBeInTheDocument();
        expect(screen.queryByText('No Activity Yet')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(onClearFilters).toHaveBeenCalledTimes(1);
    });
});
