import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MarketGrid from '@/components/MarketGrid';
import { ProcessedMarket } from '@/app/lib/market-types';

describe('MarketGrid Component (#1446)', () => {
  afterEach(() => {
    cleanup();
  });

  const mockRetry = vi.fn();
  const mockResetFilters = vi.fn();

  const mockMarket: ProcessedMarket = {
    poolId: 1,
    creator: 'GCREATOR123',
    question: 'Will XLM exceed $1 in 2026?',
    description: 'Resolves to Yes if XLM touches $1.00 or higher.',
    options: ['Yes', 'No'],
    expiry: Date.now() + 86400000,
    totalVolume: 5000,
    status: 'active',
    category: 'Crypto',
    resolvedOutcome: null,
    totalPool: 5000,
    userBet: null,
    disputed: false,
    asset: 'XLM',
    resolutionSource: 'https://oracle.example.com',
  };

  it('renders loading skeleton cards when isLoading is true', () => {
    render(
      <MarketGrid
        markets={[]}
        isLoading={true}
        error={null}
        onRetry={mockRetry}
      />
    );

    const statusContainer = screen.getByRole('status');
    expect(statusContainer).toBeInTheDocument();
    expect(statusContainer).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading markets…')).toBeInTheDocument();
  });

  it('renders error state distinctly when error is provided and allows retry', () => {
    render(
      <MarketGrid
        markets={[]}
        isLoading={false}
        error="Network connection lost"
        onRetry={mockRetry}
      />
    );

    const alertContainer = screen.getByRole('alert');
    expect(alertContainer).toBeInTheDocument();
    expect(screen.getByText('Failed to Load Markets')).toBeInTheDocument();
    expect(screen.getByText('Network connection lost')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    expect(retryButton).toBeInTheDocument();
    fireEvent.click(retryButton);
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('renders friendly empty state when there are zero markets in the protocol', () => {
    render(
      <MarketGrid
        markets={[]}
        isLoading={false}
        error={null}
        onRetry={mockRetry}
        searchQuery=""
        hasFilters={false}
      />
    );

    expect(screen.getByText('No Markets Found')).toBeInTheDocument();
    expect(
      screen.getByText(/there are no prediction markets available yet/i)
    ).toBeInTheDocument();

    const createLink = screen.getByRole('link', { name: /create market/i });
    expect(createLink).toBeInTheDocument();
    expect(createLink).toHaveAttribute('href', '/create');
  });

  it('renders friendly filter empty state when search/filters return 0 results and allows clearing filters', () => {
    render(
      <MarketGrid
        markets={[]}
        isLoading={false}
        error={null}
        onRetry={mockRetry}
        onResetFilters={mockResetFilters}
        searchQuery="nonexistent"
        hasFilters={true}
      />
    );

    expect(screen.getByText('No Matching Markets')).toBeInTheDocument();
    expect(screen.getByText(/no markets match "nonexistent"/i)).toBeInTheDocument();

    const clearButton = screen.getByRole('button', { name: /clear filters/i });
    expect(clearButton).toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(mockResetFilters).toHaveBeenCalledTimes(1);

    const createLink = screen.getByRole('link', { name: /create market/i });
    expect(createLink).toBeInTheDocument();
  });

  it('renders market cards when data is loaded successfully', () => {
    render(
      <MarketGrid
        markets={[mockMarket]}
        isLoading={false}
        error={null}
        onRetry={mockRetry}
      />
    );

    expect(screen.getByText('1 market found')).toBeInTheDocument();
    expect(screen.getByText('Will XLM exceed $1 in 2026?')).toBeInTheDocument();
  });
});
