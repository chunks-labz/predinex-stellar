/**
 * DemoDataBanner render tests (#1306).
 *
 * The banner is the runtime signal that a surface is showing fabricated rows, so
 * it must announce itself to assistive technology as well as visually, and must
 * name what is fake.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DemoDataBanner } from '@/app/components/DemoDataBanner';

describe('DemoDataBanner', () => {
  it('announces that the named data is seeded and not real', () => {
    render(<DemoDataBanner source="pool activity" />);

    expect(screen.getByTestId('demo-data-banner')).toBeInTheDocument();
    expect(screen.getByText(/Demo data\./)).toBeInTheDocument();
    expect(screen.getByText(/seeded pool activity fixtures/)).toBeInTheDocument();
    expect(screen.getByText(/not real on-chain activity/)).toBeInTheDocument();
  });

  it('exposes itself as a live status region so it is announced, not silent', () => {
    render(<DemoDataBanner source="wallet activity" />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('offers no dismiss control, since it reports data provenance', () => {
    render(<DemoDataBanner source="pool activity" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/dismiss|close/i)).not.toBeInTheDocument();
  });
});
