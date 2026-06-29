'use client';

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  formatCountdown,
  formatCountdownAccessible,
  isUrgent,
} from '@/app/lib/countdown-utils';

interface CountdownTimerProps {
  /** Estimated seconds until expiry, or `null` when already expired/unknown. */
  secondsRemaining: number | null;
  /** Settled pools have no countdown; a static label is shown instead. */
  settled?: boolean;
  /** Render a leading status icon (clock / warning / check). */
  showIcon?: boolean;
  /** Extra classes applied to the wrapping element. */
  className?: string;
}

/**
 * Live, self-ticking pool expiry countdown.
 *
 * The visible text decrements every second and tightens its precision as
 * expiry nears ("2d 4h 30m" → "30m 15s"), switching to an amber urgency style
 * under one hour and an "Expired" state at zero. A separate `aria-live` region
 * announces the remaining time at minute granularity so screen readers stay
 * informed without being flooded by per-second updates.
 */
export default function CountdownTimer({
  secondsRemaining,
  settled = false,
  showIcon = false,
  className = '',
}: CountdownTimerProps) {
  // Anchor an absolute target time rather than decrementing a counter, so the
  // countdown stays accurate across re-renders and tab backgrounding.
  const [remaining, setRemaining] = useState<number | null>(secondsRemaining);

  useEffect(() => {
    if (settled || secondsRemaining === null || secondsRemaining <= 0) {
      setRemaining(secondsRemaining);
      return;
    }

    const target = Date.now() + secondsRemaining * 1000;
    const tick = () => {
      const next = Math.round((target - Date.now()) / 1000);
      setRemaining(next > 0 ? next : 0);
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [secondsRemaining, settled]);

  if (settled) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`} role="status">
        {showIcon && <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" />}
        <span>Settled</span>
      </span>
    );
  }

  const expired = remaining === null || remaining <= 0;
  const urgent = isUrgent(remaining);

  const stateClass = expired
    ? 'text-red-500'
    : urgent
      ? 'text-amber-500'
      : '';

  const Icon = expired || urgent ? AlertTriangle : Clock;

  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${stateClass} ${className}`}
      role="timer"
    >
      {showIcon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
      <span aria-hidden="true">{formatCountdown(remaining)}</span>
      <span className="sr-only" aria-live="polite">
        {expired ? 'Expired' : formatCountdownAccessible(remaining)}
      </span>
    </span>
  );
}
