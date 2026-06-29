/**
 * Pool activity timeline.
 *
 * Displays chronological pool events including:
 * - Pool Created
 * - Bet Placed
 * - Bet Cancelled
 * - Pool Settled
 * - Claim Processed
 * - Dispute Filed
 * - Duration Extended
 *
 * Each event shows timestamp (relative + absolute), user address (truncated),
 * amount (if applicable), and outcome information.
 */

export type PoolActivityEventType = 
  | 'pool-created' 
  | 'bet-placed' 
  | 'bet-cancelled' 
  | 'pool-settled' 
  | 'claim-processed' 
  | 'dispute-filed' 
  | 'duration-extended';

export interface PoolActivityEvent {
  /** Unique event identifier (typically txHash or eventId) */
  id: string;
  
  /** Event type category */
  type: PoolActivityEventType;
  
  /** Pool ID this event belongs to */
  poolId: number;
  
  /** Address that triggered the event */
  actor: string;
  
  /** Ledger close time, Unix seconds */
  timestamp: number;
  
  /** Transaction hash */
  txHash: string;
  
  /** Block-explorer URL for the transaction */
  explorerUrl: string;
  
  /** Amount involved (if applicable), in microSTX */
  amount?: number;
  
  /** Outcome index (0 or 1) for outcome-specific events */
  outcome?: number;
  
  /** Outcome labels for display context */
  outcomeLabels?: [string, string];
  
  /** Status of the transaction */
  status: 'success' | 'pending' | 'failed';
}

/** Human-readable metadata per event type */
export const POOL_ACTIVITY_EVENT_META: Record<
  PoolActivityEventType,
  { label: string; description: string; icon: string }
> = {
  'pool-created': {
    label: 'Pool Created',
    description: 'The pool was created and betting opened.',
    icon: 'Plus',
  },
  'bet-placed': {
    label: 'Bet Placed',
    description: 'A user placed a bet on an outcome.',
    icon: 'TrendingUp',
  },
  'bet-cancelled': {
    label: 'Bet Cancelled',
    description: 'A bet was cancelled and funds were returned.',
    icon: 'X',
  },
  'pool-settled': {
    label: 'Pool Settled',
    description: 'The pool was settled with a winning outcome.',
    icon: 'CheckCircle',
  },
  'claim-processed': {
    label: 'Claim Processed',
    description: 'Winning bets were claimed and payouts distributed.',
    icon: 'Award',
  },
  'dispute-filed': {
    label: 'Dispute Filed',
    description: 'A dispute was filed against the pool settlement.',
    icon: 'AlertCircle',
  },
  'duration-extended': {
    label: 'Duration Extended',
    description: 'The pool expiry was extended.',
    icon: 'Clock',
  },
};

/** Color accent per event type */
export const POOL_ACTIVITY_EVENT_ACCENT: Record<PoolActivityEventType, string> = {
  'pool-created': 'text-blue-400',
  'bet-placed': 'text-green-400',
  'bet-cancelled': 'text-yellow-400',
  'pool-settled': 'text-purple-400',
  'claim-processed': 'text-emerald-400',
  'dispute-filed': 'text-red-400',
  'duration-extended': 'text-cyan-400',
};

/**
 * Format a Unix timestamp to a relative time string (e.g., "2m ago").
 * @param timestamp Unix seconds
 * @param nowSeconds Current time in Unix seconds
 * @returns Relative time string
 */
export function formatTimeAgo(timestamp: number, nowSeconds: number): string {
  const seconds = nowSeconds - timestamp;
  
  if (seconds < 0) return 'in the future';
  if (seconds < 60) return 'just now';
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  
  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Format a Unix timestamp to an absolute time string.
 * @param timestamp Unix seconds
 * @returns Absolute time string (e.g., "May 31, 2026, 2:30 PM")
 */
export function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Convert microSTX to STX.
 * @param microSTX Amount in microSTX
 * @returns Amount in STX
 */
export function microSTXToSTX(microSTX: number): number {
  return microSTX / 1_000_000;
}

/**
 * Format an amount in microSTX for display.
 * @param microSTX Amount in microSTX
 * @returns Formatted amount string
 */
export function formatAmount(microSTX: number): string {
  const stx = microSTXToSTX(microSTX);
  return stx.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
