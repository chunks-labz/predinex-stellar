'use client';

import { FlaskConical } from 'lucide-react';

/**
 * Persistent marker for a surface that is rendering fabricated data.
 *
 * #1306 — `NEXT_PUBLIC_ACTIVITY_FIXTURES` and `NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA`
 * substitute seeded rows for real chain data, and before this existed nothing at
 * runtime distinguished the two. A reader judging whether a market was being
 * manipulated had no way to tell a seeded `bet-placed` row from a real
 * `place_bet` event, so every surface rendering these rows must declare it.
 *
 * The banner is intentionally not dismissible: it states where the data on
 * screen came from, which is not an interruption to acknowledge once. Callers
 * render it only when the relevant demo-data flag is active, which
 * `isDemoDataFlagEnabled` confines to non-production builds.
 *
 * @param source What is fabricated, e.g. `"pool activity"`.
 */
export function DemoDataBanner({ source }: { source: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="demo-data-banner"
      className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="m-0">
        <span className="font-semibold">Demo data.</span> Showing seeded {source} fixtures, not
        real on-chain activity. Do not use these figures to judge market activity.
      </p>
    </div>
  );
}
