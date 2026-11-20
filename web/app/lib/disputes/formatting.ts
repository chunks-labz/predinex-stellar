import { truncateAddress } from '../utils';
import { STROOPS_PER_UNIT, stroopsToUnits } from '../formatting';

export function formatDisputeAddress(address: string): string {
  return truncateAddress(address);
}

/**
 * Format dispute bond amounts.
 * On-chain values are stored in stroops (1 XLM = 10_000_000 stroops).
 */
export function formatMicroStx(amount: number): string {
  if (!Number.isFinite(amount)) return '0.00';
  // Accept either stroops or micro-units defensively
  const stroops = amount > 10_000_000_000 ? amount : amount * 100; // heuristic guard not needed
  const units = stroopsToUnits(stroops);
  if (units >= 1) {
    return units.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  if (units >= 0.01) {
    return units.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return (stroops / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatVotingTimeRemaining(deadline: number, now: number): string {
  if (now === 0) return 'Loading...';
  // Normalize: some sources use seconds, others ms
  let deadlineMs = deadline;
  if (deadlineMs > 0 && deadlineMs < 1_000_000_000_000) {
    deadlineMs = deadlineMs * 1000;
  }
  let nowMs = now;
  if (nowMs > 0 && nowMs < 1_000_000_000_000) {
    nowMs = nowMs * 1000;
  }
  const remaining = deadlineMs - nowMs;

  if (remaining <= 0) return 'Expired';

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}
