/**
 * Pure helpers backing the live pool-expiry countdown.
 *
 * Pool expiry is recorded on-chain as a block height, so a "live" countdown is
 * an estimate derived from the number of blocks remaining and the average block
 * time. The 10-minute assumption matches `formatTimeRemaining` in
 * `market-utils.ts`, keeping every block→time estimate in the UI consistent.
 */

/** Average seconds per block (~10 min on Stacks), mirrors `market-utils.ts`. */
export const BLOCK_TIME_SECONDS = 600;

/** Below this many seconds remaining the countdown is treated as urgent. */
export const URGENT_THRESHOLD_SECONDS = 60 * 60; // 1 hour

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Converts a number of remaining blocks into estimated seconds.
 *
 * @param blocksRemaining - Blocks until expiry, or `null` when already expired.
 * @returns Estimated seconds remaining, or `null` when expired/unknown.
 */
export function blocksToSeconds(blocksRemaining: number | null): number | null {
  if (blocksRemaining === null) return null;
  if (!Number.isFinite(blocksRemaining) || blocksRemaining <= 0) return null;
  return Math.round(blocksRemaining * BLOCK_TIME_SECONDS);
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
  if (secondsRemaining === null || secondsRemaining <= 0) return 'Expired';

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
  if (secondsRemaining === null || secondsRemaining <= 0) return 'Expired';

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
