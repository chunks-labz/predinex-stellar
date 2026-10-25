/**
 * Centralized error handling for contract interactions
 * Provides consistent error messages and logging
 */

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
  if (error instanceof ContractError) {
    return error.message;
  }
  const e = error as { message?: string };
  if (e?.message?.includes('ERR-')) {
    const match = e.message.match(/ERR-\w+/);
    if (match) {
      return formatErrorCode(match[0]);
    }
  }
  if (e?.message?.includes('429')) {
    return 'Rate limit exceeded. Please try again in a moment.';
  }
  if (e?.message?.includes('Network')) {
    return 'Network error. Please check your connection.';
  }
  if (e?.message?.includes('User cancelled')) {
    return 'Transaction cancelled by user.';
  }
  return e?.message || 'An unknown error occurred';
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
