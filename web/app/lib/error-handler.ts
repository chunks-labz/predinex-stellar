/**
 * Centralized error handling for contract interactions
 * Provides consistent error messages and logging
 */

import { WalletError } from './wallet-errors';

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export class ContractError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Parse error from contract call
 * @param error Error object
 * @returns Formatted error message
 */
export function parseContractError(error: unknown): string {
  if (error instanceof ContractError) return error.message;
  if (error instanceof WalletError) return error.message;

  const e = error as { message?: string; shortMessage?: string; reason?: string; code?: string | number };
  const raw = [e?.message, e?.shortMessage, e?.reason]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const text = raw.toLowerCase();

  if (text.includes('err-')) {
    const match = raw.match(/ERR-[A-Z0-9-]+/i);
    if (match) {
      return formatErrorCode(match[0].toUpperCase());
    }
  }
  if (text.includes('429') || text.includes('rate limit')) {
    return 'Rate limit exceeded. Please try again in a moment.';
  }
  if (
    text.includes('network') ||
    text.includes('failed to fetch') ||
    text.includes('fetch ') ||
    text.includes('rpc') ||
    text.includes('timeout') ||
    text.includes('timed out')
  ) {
    return 'Unable to reach the network. Check your connection and try again.';
  }
  if (
    text.includes('user rejected') ||
    text.includes('user cancelled') ||
    text.includes('user canceled') ||
    text.includes('cancelled by user') ||
    text.includes('canceled by user') ||
    text.includes('reject')
  ) {
    return 'Transaction cancelled. No changes were made.';
  }
  if (text.includes('insufficient') || text.includes('balance')) {
    return 'Insufficient balance for this action.';
  }
  if (text.includes('pool not found') || text.includes('market not found')) {
    return 'This market could not be found.';
  }
  if (text.includes('already claimed')) {
    return 'You have already claimed these winnings.';
  }
  if (text.includes('not settled') || text.includes('has not expired')) {
    return 'This market is not ready for that action yet.';
  }
  if (text.includes('unauthorized') || text.includes('not authorized')) {
    return 'You are not authorized to perform this action.';
  }
  if (text.includes('invalid amount')) {
    return 'Enter a valid amount and try again.';
  }

  if (typeof e?.code === 'number' || typeof e?.code === 'string') {
    const code = String(e.code).toLowerCase();
    if (code.includes('rejected') || code === '4001') {
      return 'Transaction cancelled. No changes were made.';
    }
  }

  return 'The market action could not be completed. Please try again.';
}

/**
 * Format error code to human-readable message
 * @param code Error code
 * @returns Formatted message
 */
export function formatErrorCode(code: string): string {
  const errorMap: Record<string, string> = {
    'ERR-UNAUTHORIZED': 'You are not authorized to perform this action',
    'ERR-INVALID-AMOUNT': 'Invalid amount provided',
    'ERR-POOL-NOT-FOUND': 'Pool not found',
    'ERR-POOL-SETTLED': 'This pool has already been settled',
    'ERR-INVALID-OUTCOME': 'Invalid outcome selected',
    'ERR-NOT-SETTLED': 'Pool has not been settled yet',
    'ERR-ALREADY-CLAIMED': 'You have already claimed winnings for this pool',
    'ERR-NO-WINNINGS': 'You have no winnings to claim',
    'ERR-POOL-NOT-EXPIRED': 'Pool has not expired yet',
    'ERR-INSUFFICIENT-BALANCE': 'Insufficient balance for this transaction',
    'ERR-WITHDRAWAL-FAILED': 'Withdrawal failed',
    'ERR-INVALID-WITHDRAWAL': 'Invalid withdrawal request',
    'ERR-NOT-POOL-CREATOR': 'Only the pool creator can perform this action',
  };

  return errorMap[code] || `Error: ${code}`;
}

/**
 * Log error with context
 * @param context Context information
 * @param error Error object
 */
export function logError(context: string, error: unknown): void {
  const e = error as { message?: string; code?: string; details?: unknown };
  // Use dynamic import to avoid circular dependency
  void import('./logger').then(({ logger }) => {
    logger.error(e?.message ?? 'Unknown error', context, { code: e?.code, details: e?.details });
  });
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = delayMs * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
