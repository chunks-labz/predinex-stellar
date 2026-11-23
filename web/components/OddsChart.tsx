'use client';

/**
 * OddsChart — the two-outcome odds bar shown on the market and pool pages.
 *
 * Issue #1662: the bar used to carry meaning through colour and width only.
 *
 * - **Text alternative.** The bar is an `img` whose accessible name states
 *   both series and their current values ("Current odds: Yes 62.5%, No
 *   37.5%"). The legend under it is plain text, so it reads in browse mode.
 * - **Announcements without chatter.** Odds are polled, so values change
 *   often and by tiny amounts. A polite live region speaks only when a
 *   value has moved by at least `announceThresholdPct` percentage points
 *   since the last announcement, and only after the values have been still
 *   for `announceDelayMs`, so a burst of updates becomes one message. The
 *   first render is never announced: the chart's own label covers it.
 */

import { useEffect, useRef, useState } from 'react';
import { formatOdds } from '@/app/lib/formatting';

export interface OddsChartProps {
  outcomeA: string;
  outcomeB: string;
  /** Share of the pool backing outcome A, 0–100. */
  oddsA: number;
  /** Share of the pool backing outcome B, 0–100. */
  oddsB: number;
  /** Visible heading for the chart, e.g. "Current Odds". */
  title: string;
  /** Optional id for the heading element (lets callers reference it). */
  titleId?: string;
  /** Minimum movement, in percentage points, that is worth announcing. */
  announceThresholdPct?: number;
  /** How long values must be still before an announcement is made. */
  announceDelayMs?: number;
  /** Extra content rendered next to the heading (e.g. an info tooltip). */
  headingAccessory?: React.ReactNode;
  className?: string;
}

export const DEFAULT_ANNOUNCE_THRESHOLD_PCT = 1;
export const DEFAULT_ANNOUNCE_DELAY_MS = 1500;

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** The sentence used both as the chart's name and as an announcement. */
export function describeOdds(
  title: string,
  outcomeA: string,
  oddsA: number,
  outcomeB: string,
  oddsB: number
): string {
  return `${title}: ${outcomeA} ${formatOdds(clampPct(oddsA))}, ${outcomeB} ${formatOdds(clampPct(oddsB))}`;
}

export default function OddsChart({
  outcomeA,
  outcomeB,
  oddsA,
  oddsB,
  title,
  titleId,
  announceThresholdPct = DEFAULT_ANNOUNCE_THRESHOLD_PCT,
  announceDelayMs = DEFAULT_ANNOUNCE_DELAY_MS,
  headingAccessory,
  className = 'mb-8',
}: OddsChartProps) {
  const a = clampPct(oddsA);
  const b = clampPct(oddsB);
  const description = describeOdds(title, outcomeA, a, outcomeB, b);

  const [announcement, setAnnouncement] = useState('');
  // Values as of the last announcement (or first render).
  const lastAnnounced = useRef<{ a: number; b: number } | null>(null);

  useEffect(() => {
    if (lastAnnounced.current === null) {
      lastAnnounced.current = { a, b };
      return;
    }
    const prev = lastAnnounced.current;
    const moved = Math.max(Math.abs(a - prev.a), Math.abs(b - prev.b));
    if (moved < announceThresholdPct) return;

    const timer = setTimeout(() => {
      lastAnnounced.current = { a, b };
      setAnnouncement(`Odds updated. ${description}`);
    }, announceDelayMs);
    return () => clearTimeout(timer);
  }, [a, b, description, announceThresholdPct, announceDelayMs]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm text-muted-foreground" id={titleId}>
          {title}
        </p>
        {headingAccessory}
      </div>
      <div className="flex h-4 rounded-full overflow-hidden" role="img" aria-label={description}>
        <div className="bg-green-500 transition-all" style={{ width: `${a}%` }} />
        <div className="bg-red-500 transition-all" style={{ width: `${b}%` }} />
      </div>
      <div className="flex justify-between gap-3 mt-2 text-sm">
        <span className="text-green-400 min-w-0 break-words">
          {outcomeA}: {formatOdds(a)}
        </span>
        <span className="text-red-400 min-w-0 break-words text-right">
          {outcomeB}: {formatOdds(b)}
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}
