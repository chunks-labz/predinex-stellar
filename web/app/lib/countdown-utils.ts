/**
 * Pure helpers backing the live pool-expiry countdown.
 *
 * #1284 — Pool expiry is recorded on-chain as a Unix timestamp in seconds
 * (the contract sets it from `env.ledger().timestamp()`), *not* as a block
 * height. Treating it as a height made `expiry - blockHeight` come out around
 * 1.72e9, which the old block→seconds conversion then multiplied by 5 into
 * roughly 273 years of "remaining" time, so countdowns never entered their
 * urgent state and markets never reported as expired.
 *
 * Because expiry is already in seconds, the remaining time is plain wall-clock
 * arithmetic against `Date.now()` and no block-time estimate is involved.
 */

/** Below this many seconds remaining the countdown is treated as urgent. */
export const URGENT_THRESHOLD_SECONDS = 60 * 60; // 1 hour

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Seconds remaining until an expiry timestamp.
 *
 * @param expiry - Unix timestamp in seconds at which the pool expires.
 * @param nowSeconds - Current Unix time in seconds; defaults to `Date.now()`.
 * @returns Whole seconds remaining, or `null` when the pool has expired or
 *          `expiry` is not a usable timestamp.
 */
export function secondsUntil(expiry: number | null, nowSeconds?: number): number | null {
  if (expiry === null || !Number.isFinite(expiry) || expiry <= 0) return null;

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(now)) return null;

  const remaining = expiry - now;
  return remaining > 0 ? Math.floor(remaining) : null;
}

/**
 * True when the countdown should switch to its visual urgency state
 * (less than one hour remaining, but not yet expired).
 */
export function isUrgent(secondsRemaining: number | null): boolean {
  if (secondsRemaining === null) return false;
  return secondsRemaining > 0 && secondsRemaining < URGENT_THRESHOLD_SECONDS;
}

/**
 * Formats remaining seconds into a compact countdown string. The precision
 * tightens as expiry approaches so urgency reads naturally:
 *   - ≥ 1 day  → "2d 4h 30m"
 *   - ≥ 1 hour → "4h 30m 15s"
 *   - < 1 hour → "30m 15s"
 *
 * @returns The formatted countdown, or "Expired" once time has run out.
 */
export function formatCountdown(secondsRemaining: number | null): string {
  if (secondsRemaining === null) return '--';
  if (secondsRemaining <= 0) return 'Expired';

  const total = Math.floor(secondsRemaining);
  const days = Math.floor(total / SECONDS_PER_DAY);
  const hours = Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Builds a verbose, screen-reader-friendly description of the time remaining.
 * Uses minute granularity so an `aria-live` region announcing it does not flood
 * assistive tech with per-second updates.
 *
 * @returns e.g. "2 days, 4 hours, 30 minutes remaining", "Less than a minute
 *          remaining", or "Expired".
 */
export function formatCountdownAccessible(secondsRemaining: number | null): string {
  if (secondsRemaining === null) return 'Loading time remaining';
  if (secondsRemaining <= 0) return 'Expired';

  const total = Math.floor(secondsRemaining);
  const days = Math.floor(total / SECONDS_PER_DAY);
  const hours = Math.floor((total % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);

  if (parts.length === 0) return 'Less than a minute remaining';
  return `${parts.join(', ')} remaining`;
}
