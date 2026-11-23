/**
 * #1662 — the odds chart has a text alternative and announces changes
 * without chattering.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import OddsChart, {
  DEFAULT_ANNOUNCE_DELAY_MS,
  DEFAULT_ANNOUNCE_THRESHOLD_PCT,
  describeOdds,
} from '../../components/OddsChart';

const baseProps = {
  title: 'Current Odds',
  outcomeA: 'Yes',
  outcomeB: 'No',
};

function chart(oddsA: number, oddsB: number) {
  return <OddsChart {...baseProps} oddsA={oddsA} oddsB={oddsB} />;
}

function liveRegion(): HTMLElement {
  return screen.getByRole('status');
}

describe('OddsChart — text alternatives', () => {
  it('names the chart with both series and their current values', () => {
    render(chart(62.5, 37.5));
    expect(screen.getByRole('img', { name: 'Current Odds: Yes 62.5%, No 37.5%' })).toBeInTheDocument();
  });

  it('renders each series value as text, not only as bar width', () => {
    render(chart(62.5, 37.5));
    expect(screen.getByText('Yes: 62.5%')).toBeInTheDocument();
    expect(screen.getByText('No: 37.5%')).toBeInTheDocument();
  });

  it('clamps values outside 0–100 in both the bar and the description', () => {
    render(chart(140, -40));
    expect(screen.getByRole('img', { name: 'Current Odds: Yes 100.0%, No 0.0%' })).toBeInTheDocument();
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(chart(55, 45));
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toHaveLength(0);
  });

  it('exposes a polite, atomic live region', () => {
    render(chart(50, 50));
    const region = liveRegion();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });
});

describe('OddsChart — announcements', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function settle(ms = DEFAULT_ANNOUNCE_DELAY_MS) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('does not announce the first render', async () => {
    render(chart(60, 40));
    await settle();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('ignores movements smaller than the threshold', async () => {
    const { rerender } = render(chart(60, 40));
    const small = DEFAULT_ANNOUNCE_THRESHOLD_PCT / 2;
    rerender(chart(60 + small, 40 - small));
    await settle();
    expect(liveRegion()).toBeEmptyDOMElement();
  });

  it('announces a meaningful change once the values have been still', async () => {
    const { rerender } = render(chart(60, 40));
    rerender(chart(70, 30));
    await settle(DEFAULT_ANNOUNCE_DELAY_MS - 1);
    expect(liveRegion()).toBeEmptyDOMElement();
    await settle(1);
    expect(liveRegion()).toHaveTextContent(`Odds updated. ${describeOdds('Current Odds', 'Yes', 70, 'No', 30)}`);
  });

  it('coalesces a burst of updates into one announcement of the latest values', async () => {
    const { rerender } = render(chart(50, 50));
    const messages: string[] = [];
    const observer = new MutationObserver(() => messages.push(liveRegion().textContent ?? ''));
    observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true });

    for (const a of [55, 58, 61, 64]) {
      rerender(chart(a, 100 - a));
      await settle(DEFAULT_ANNOUNCE_DELAY_MS / 3);
    }
    await settle();
    observer.disconnect();

    expect(messages.filter(Boolean)).toEqual([
      `Odds updated. ${describeOdds('Current Odds', 'Yes', 64, 'No', 36)}`,
    ]);
  });

  it('measures the threshold from the last announcement, not the last render', async () => {
    const { rerender } = render(chart(50, 50));
    // 50 → 50.6 is under the threshold; 51.2 is 1.2 points from the last
    // announced value (the first render) and is announced; 51.8 is only 0.6
    // from that announcement and is not.
    for (const a of [50.6, 51.2]) {
      rerender(chart(a, 100 - a));
      await settle();
    }
    expect(liveRegion()).toHaveTextContent('Yes 51.2%');
    rerender(chart(51.8, 48.2));
    await settle();
    expect(liveRegion()).toHaveTextContent('Yes 51.2%');
    expect(liveRegion()).not.toHaveTextContent('51.8');
  });
});
