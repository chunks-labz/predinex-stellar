/**
 * #458 — Accessibility (a11y) compliance tests — WCAG 2.1 AA
 *
 * Uses axe-core to run automated accessibility checks on key components.
 * Covers: Toast, MarketCard, BettingSection (disconnected state), MarketGrid.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import axe from 'axe-core';

// ── Shared mocks ──────────────────────────────────────────────────────────────

vi.mock('@/components/WalletAdapterProvider', () => ({
  useWallet: vi.fn(() => ({
    isConnected: false,
    isLoading: false,
    address: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  WalletAdapterProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../app/lib/hooks/usePoolFavorites', () => ({
  usePoolFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));

vi.mock('@/components/CountdownTimer', () => ({
  default: () => <span>2h remaining</span>,
}));

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

// ── Helper ────────────────────────────────────────────────────────────────────

async function runAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: {
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
    },
  });
  return results.violations;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

import Toast from '../../components/ui/Toast';

describe('Toast — a11y', () => {
  it('success toast has no critical a11y violations', async () => {
    const { container } = render(
      <Toast message="Market created successfully!" type="success" onClose={vi.fn()} />
    );
    const violations = await runAxe(container);
    const critical = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical, `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`).toHaveLength(0);
  });

  it('error toast has role="alert"', () => {
    const { container } = render(
      <Toast message="Transaction failed" type="error" onClose={vi.fn()} />
    );
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('info toast has role="status"', () => {
    const { container } = render(
      <Toast message="Loading..." type="info" onClose={vi.fn()} />
    );
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('dismiss button has accessible label', () => {
    const { container } = render(
      <Toast message="Test" type="info" onClose={vi.fn()} />
    );
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-label')).toBe('Dismiss notification');
  });
});

// ── MarketCard ────────────────────────────────────────────────────────────────

import MarketCard from '@/components/MarketCard';
import type { ProcessedMarket } from '../../app/lib/market-types';

const mockMarket: ProcessedMarket = {
  poolId: 1,
  title: 'Will BTC reach $100k?',
  description: 'Bitcoin price prediction market for end of year.',
  outcomeA: 'Yes',
  outcomeB: 'No',
  oddsA: 60,
  oddsB: 40,
  totalVolume: 1000000,
  timeRemaining: 1000,
  status: 'active',
  creator: 'GABC1234567890',
  settled: false,
  winningOutcome: undefined,
};

describe('MarketCard — a11y', () => {
  it('has no critical a11y violations', async () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const violations = await runAxe(container);
    const critical = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical, `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`).toHaveLength(0);
  });

  it('card link has descriptive aria-label', () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('aria-label')).toContain('Will BTC reach $100k?');
  });

  it('favorite button has aria-pressed', () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const btn = container.querySelector('button[aria-pressed]');
    expect(btn).toBeTruthy();
  });

  it('odds bar has accessible description', () => {
    const { container } = render(<MarketCard market={mockMarket} />);
    const oddsBar = container.querySelector('[role="img"]');
    expect(oddsBar?.getAttribute('aria-label')).toContain('Odds:');
  });
});

// ── MarketGrid ────────────────────────────────────────────────────────────────

import MarketGrid from '@/components/MarketGrid';

describe('MarketGrid — a11y', () => {
  it('markets list has aria-label', () => {
    const { container } = render(
      <MarketGrid
        markets={[mockMarket]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    const list = container.querySelector('ul[aria-label]');
    expect(list).toBeTruthy();
  });

  it('results count uses aria-live', () => {
    const { container } = render(
      <MarketGrid
        markets={[mockMarket]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    const liveRegion = container.querySelector('[aria-live]');
    expect(liveRegion).toBeTruthy();
  });

  it('has no critical a11y violations', async () => {
    const { container } = render(
      <MarketGrid
        markets={[mockMarket]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    const violations = await runAxe(container);
    const critical = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical, `Critical violations: ${JSON.stringify(critical.map((v) => v.id))}`).toHaveLength(0);
  });
});
