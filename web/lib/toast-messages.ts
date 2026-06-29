import type { ToastType } from '../components/ui/Toast';
import type { ConnectivityIssue } from '../app/lib/network-errors';
import { getConnectivityMessage } from '../app/lib/network-errors';

/** Minimum bet in XLM — shared by validation, inline hints, and toast copy. */
export const MIN_BET_STX = 0.1;
// Backward-compatible alias (some UI still uses the legacy "XLM" wording).
export const MIN_BET_XLM = MIN_BET_STX;

const formatTokenAmount = (amount: number): string => {
  // Keep string formatting stable for tests (avoid 0.10000000000002).
  if (!Number.isFinite(amount)) return String(amount);
  if (amount === 0) return '0';
  const normalized = parseFloat(amount.toFixed(8));
  return normalized.toString();
};

export type ToastPayload = { message: string; type: ToastType };

/**
 * Typed catalog for user-facing toast copy. Prefer these over ad hoc strings
 * so messages stay consistent and tests can assert against exports.
 */
export const toastMessages = {
  bet: {
    invalidAmount: {
      message: 'Please enter a valid amount',
      type: 'error' as const,
    },
    minBet(min: number = MIN_BET_STX): ToastPayload {
      return {
        message: `Minimum bet is ${formatTokenAmount(min)} XLM`,
        type: 'error',
      };
    },
    maxBet(max: number): ToastPayload {
      return {
        message: `Maximum bet is ${formatTokenAmount(max)} XLM`,
        type: 'error',
      };
    },
    insufficientBalance(balance: number): ToastPayload {
      return {
        message: `Insufficient balance. Available: ${balance.toFixed(2)} XLM`,
        type: 'error',
      };
    },
    success: {
      message: 'Bet placed successfully!',
      type: 'success' as const,
    },
    transactionCancelled: {
      message: 'Transaction cancelled',
      type: 'info' as const,
    },
  },
  network: {
    /** Shown when the wallet prompt is slow to appear. */
    slowConfirmation: {
      message:
        'Network is slow. Waiting for wallet confirmation... You can keep this tab open.',
      type: 'warning' as const,
    },
  },
};

export function connectivityErrorToast(
  issue: ConnectivityIssue,
  actionLabel: string
): ToastPayload {
  return {
    message: getConnectivityMessage(issue, actionLabel),
    type: 'error',
  };
}

export function showToastPayload(
  showToast: (message: string, type?: ToastType) => void,
  payload: ToastPayload
): void {
  showToast(payload.message, payload.type);
}
