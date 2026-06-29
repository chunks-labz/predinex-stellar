/**
 * Error Recovery Service
 * Handles graceful degradation and error recovery for wallet operations
 */

import { SessionStorageService } from './session-storage';
import { createScopedLogger } from './logger';

const log = createScopedLogger('error-recovery');

export interface RecoveryAction {
  type: 'retry' | 'fallback' | 'reset' | 'ignore';
  message: string;
  action?: () => Promise<void> | void;
}

export interface ErrorContext {
  operation: string;
  error: Error;
  retryCount: number;
  timestamp: Date;
  userAgent: string;
  url: string;
}

export class ErrorRecoveryService {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAYS = [1000, 2000, 4000]; // Progressive backoff

  /**
   * Determine recovery strategy for an error
   */
  static getRecoveryStrategy(context: ErrorContext): RecoveryAction {
    const { error, operation, retryCount } = context;

    // Connection errors - retry with backoff
    if (this.isConnectionError(error)) {
      if (retryCount < this.MAX_RETRIES) {
        return {
          type: 'retry',
          message: `Connection failed. Retrying in ${this.RETRY_DELAYS[retryCount] / 1000}s...`,
          action: () => this.delay(this.RETRY_DELAYS[retryCount]),
        };
      } else {
        return {
          type: 'fallback',
          message: 'Connection failed. Please check your internet connection.',
        };
      }
    }

    // Wallet not found - provide installation guidance
    if (this.isWalletNotFoundError(error)) {
      return {
        type: 'fallback',
        message: 'No compatible wallet found. Please install Hiro Wallet, Xverse, or Leather.',
      };
    }

    // User rejection - don't retry
    if (this.isUserRejectionError(error)) {
      return {
        type: 'ignore',
        message: 'Transaction cancelled by user.',
      };
    }

    // Session expired - clear and prompt reconnection
    if (this.isSessionExpiredError(error)) {
      return {
        type: 'reset',
        message: 'Session expired. Please reconnect your wallet.',
        action: () => {
          SessionStorageService.clearSession();
        },
      };
    }

    // Network errors - suggest network switch
    if (this.isNetworkError(error)) {
      return {
        type: 'fallback',
        message: 'Network error. Try switching networks or check your connection.',
      };
    }

    // Transaction errors - provide specific guidance
    if (this.isTransactionError(error)) {
      return {
        type: 'fallback',
        message: this.getTransactionErrorMessage(error),
      };
    }

    // Storage errors - clear and reset
    if (this.isStorageError(error)) {
      return {
        type: 'reset',
        message: 'Storage error. Clearing cached data...',
        action: () => {
          try {
            localStorage.clear();
          } catch (e) {
            log.error('Failed to clear storage', e);
          }
        },
      };
    }

    // Generic retry for other errors
    if (retryCount < this.MAX_RETRIES) {
      return {
        type: 'retry',
        message: 'Operation failed. Retrying...',
        action: () => this.delay(1000),
      };
    }

    // Final fallback
    return {
      type: 'fallback',
      message: 'An unexpected error occurred. Please refresh the page and try again.',
    };
  }

  /**
   * Execute recovery action with proper error handling
   */
  static async executeRecovery(action: RecoveryAction): Promise<boolean> {
    try {
      if (action.action) {
        await action.action();
      }
      return true;
    } catch (error) {
      log.error('Recovery action failed', error);
      return false;
    }
  }

  /**
   * Check if browser supports required features
   */
  static checkBrowserSupport(): {
    supported: boolean;
    missing: string[];
    warnings: string[];
  } {
    const missing: string[] = [];
    const warnings: string[] = [];

    // Check localStorage
    if (typeof Storage === 'undefined') {
      missing.push('Local Storage');
    }

    // Check fetch API
    if (typeof fetch === 'undefined') {
      missing.push('Fetch API');
    }

    // Check Promise support
    if (typeof Promise === 'undefined') {
      missing.push('Promise support');
    }

    // Check for older browsers
    if (!window.crypto || !window.crypto.getRandomValues) {
      warnings.push('Crypto API not fully supported');
    }

    // Check for mobile browsers with limited wallet support
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    
    if (isMobile) {
      warnings.push('Mobile wallet support may be limited');
    }

    return {
      supported: missing.length === 0,
      missing,
      warnings,
    };
  }

  /**
   * Get fallback options when primary wallet connection fails
   */
  static getFallbackOptions(): Array<{
    name: string;
    description: string;
    action: string;
  }> {
    return [
      {
        name: 'Install Hiro Wallet',
        description: 'The official Stacks wallet browser extension',
        action: 'https://wallet.hiro.so/',
      },
      {
        name: 'Install Xverse',
        description: 'Multi-chain wallet with Stacks support',
        action: 'https://www.xverse.app/',
      },
      {
        name: 'Install Leather',
        description: 'Open-source Stacks wallet',
        action: 'https://leather.io/',
      },
      {
        name: 'Use Mobile App',
        description: 'Access via mobile wallet app',
        action: 'mobile',
      },
    ];
  }

  // Error type detection methods
  private static isConnectionError(error: Error): boolean {
    return (
      error.message.includes('network') ||
      error.message.includes('connection') ||
      error.message.includes('timeout') ||
      error.message.includes('fetch')
    );
  }

  private static isWalletNotFoundError(error: Error): boolean {
    return (
      error.message.includes('wallet') &&
      (error.message.includes('not found') || 
       error.message.includes('not installed') ||
       error.message.includes('not available'))
    );
  }

  private static isUserRejectionError(error: Error): boolean {
    return (
      error.message.includes('user') &&
      (error.message.includes('rejected') ||
       error.message.includes('cancelled') ||
       error.message.includes('denied'))
    );
  }

  private static isSessionExpiredError(error: Error): boolean {
    return (
      error.message.includes('session') &&
      (error.message.includes('expired') ||
       error.message.includes('invalid') ||
       error.message.includes('not found'))
    );
  }

  private static isNetworkError(error: Error): boolean {
    return (
      error.message.includes('network') ||
      error.message.includes('chain') ||
      error.message.includes('rpc')
    );
  }

  private static isTransactionError(error: Error): boolean {
    return (
      error.message.includes('transaction') ||
      error.message.includes('broadcast') ||
      error.message.includes('fee') ||
      error.message.includes('nonce')
    );
  }

  private static isStorageError(error: Error): boolean {
    return (
      error.message.includes('storage') ||
      error.message.includes('quota') ||
      error.message.includes('localStorage')
    );
  }

  private static getTransactionErrorMessage(error: Error): string {
    if (error.message.includes('insufficient')) {
      return 'Insufficient balance for transaction. Please check your STX balance.';
    }
    if (error.message.includes('fee')) {
      return 'Transaction fee error. Please try again with a higher fee.';
    }
    if (error.message.includes('nonce')) {
      return 'Transaction nonce error. Please wait and try again.';
    }
    return 'Transaction failed. Please check your inputs and try again.';
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}