import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from '@axe-core/react';
import { MarketGrid } from '@/components/MarketGrid';
import { FeaturedMarkets } from '@/components/FeaturedMarkets';
import { WalletModal } from '@/components/WalletModal';
import { Dialog } from '@/components/ui/Dialog';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';

expect.extend(toHaveNoViolations);

describe('Accessibility (WCAG 2.1 AA) axe-core tests', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('markets list page has no critical/serious violations', async () => {
    const { container } = render(
      <div>
        <h1>Prediction Markets</h1>
        <MarketGrid
          markets: [
            {
              poolId: 1,
              title: 'Test Market',
              description: 'Test description',
              outcomeA: 'Yes',
              outcomeB: 'No',
              totalA: '1000000',
              totalB: '2000000',
              participant_count: 5,
              status: 'active' as const,
              oddsA: '50.0',
              oddsB: '50.0',
            } as any,
          ] as any[],
          isLoading: false,
          error: null,
          onRetry: () => {},
          searchQuery: '',
          hasFilters: false,
        />
      </div>
    );

    const violations = await axe(container).run();
    const critical = violations violations.filter(
      (v: any) => v.description?.includes('critical') || v.id === 'region'
    );
    const serious = violations violations.filter(
      (v: any) => v.description?.includes('serious') || v.tags?.includes('critical') || v.tags?.includes('serious')
    );

    expect(violations).toHaveLength(0);
    expect(critical.length).toBe(0);
    expect(serious.length).toBe(0);
  });

  it('featured markets section has no critical/serious violations', async () => {
    const { container } = render(
      <FeaturedMarkets />
    );

    const violations = await axe(container).run();
    expect(violations).toHaveLength(0);
    expect(violations[0]?.level).toBe('minor');
  });

  it('wallet modal has no critical/serious violations', async () => {
    const { container } = render(
      <WalletModal
        isOpen={true}
        onClose={() => {}}
        onSelectWallet={() => {}}
      />
    );

    const violations = await axe(container).run();
    expect(violations).toHaveLength(0);
  });

  it('dialog component has no critical/serious violations', async () => {
    const { container } = render(
      <Dialog open={true} onClose={() => {}} title="Test dialog">
        <p>Dialog body text</p>
      </Dialog>
    );

    const violations = await axe(container).run();
    expect(violations).toHaveLength(0);
  });

  it('transaction fee modal has no critical/serious violations', async () => {
    const { container } = render(
      <TransactionFeeModal
        isOpen
        actionName="Create Pool"
        feeStroops="500"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    const violations = await axe(container).run();
    expect(violations).toHaveLength(0);
  });

  it('pool detail page has no critical/serious violations', async () => {
    const { container } = render(
      <div>
        <h1>Pool Detail</h1>
        <div className="glass p-8 rounded-2xl border border-border">
          <h1 className="text-3xl font-bold">Test Pool</h1>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-muted/50 p-4 rounded-lg text-center">
              <div>Total Volume</div>
              <div className="font-bold">3000000 STX</div>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg text-center">
              <div>Participants</div>
              <div>10</div>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg text-center">
              <div>Expires</div>
              <div>Block 1000</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <span>Updates every 10s · Pool #1</span>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" className="hidden">
            <span className="sr-only">Live pool update</span>
            <span id="live-pool-update" />
          </div>
        </div>
      </div>
    );

    const violations = await axe(container).run();
    expect(violations).toHaveLength(0);
  });
});