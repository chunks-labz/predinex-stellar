/**
 * Application configuration constants
 * Centralized configuration for the entire application
 */

/**
 * Token/Currency configuration
 * Configurable token symbol for rewards, incentives, and display
 */
export const TOKEN_CONFIG = {
  /** Display symbol for the native token (e.g., 'STX', 'XLM', 'USD') */
  SYMBOL: process.env.NEXT_PUBLIC_TOKEN_SYMBOL ?? 'STX',
  /** Full token name for display */
  NAME: process.env.NEXT_PUBLIC_TOKEN_NAME ?? 'Stacks Token',
  /** Decimal places for display formatting */
  DECIMALS: 2,
  /** Stroops/micro units per token (for conversion) */
  STROOPS_PER_UNIT: 1_000_000,
} as const;

/**
 * Bet configuration
 */
export const BET_CONFIG = {
  MINIMUM_BET: 0.1, // in TOKEN_CONFIG.SYMBOL units
  MAXIMUM_BET: 1_000_000, // in TOKEN_CONFIG.SYMBOL units
  FEE_PERCENTAGE: 2, // 2% fee
} as const;

/**
 * Pool configuration
 */
export const POOL_CONFIG = {
  MINIMUM_DURATION: 10, // blocks
  MAXIMUM_DURATION: 1_000_000, // blocks
  TITLE_MAX_LENGTH: 256,
  DESCRIPTION_MAX_LENGTH: 512,
  OUTCOME_MAX_LENGTH: 128,
  TITLE_MIN_LENGTH: 5,
  DESCRIPTION_MIN_LENGTH: 10,
  OUTCOME_MIN_LENGTH: 2,
} as const;

/**
 * Withdrawal configuration
 */
export const WITHDRAWAL_CONFIG = {
  MINIMUM_WITHDRAWAL: 0.1, // STX
  WITHDRAWAL_DELAY: 10, // blocks
  BATCH_SIZE: 10, // max withdrawals per batch
} as const;

/**
 * API configuration
 */
export const API_CONFIG = {
  TIMEOUT: 30000, // milliseconds
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // milliseconds
  RATE_LIMIT_DELAY: 2000, // milliseconds between requests
} as const;

/**
 * UI configuration
 */
export const UI_CONFIG = {
  ITEMS_PER_PAGE: 20,
  TOAST_DURATION: 5000, // milliseconds
  ANIMATION_DURATION: 300, // milliseconds
  DEBOUNCE_DELAY: 500, // milliseconds
} as const;

/**
 * Block time configuration
 */
export const BLOCK_TIME = {
  AVERAGE_BLOCK_TIME: 10 * 60, // 10 minutes in seconds
  BLOCKS_PER_DAY: 144,
  BLOCKS_PER_HOUR: 6,
} as const;

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection.',
  RATE_LIMIT: 'Rate limit exceeded. Please try again later.',
  INVALID_AMOUNT: 'Invalid amount provided.',
  INSUFFICIENT_BALANCE: 'Insufficient balance.',
  POOL_NOT_FOUND: 'Pool not found.',
  UNAUTHORIZED: 'You are not authorized to perform this action.',
  TRANSACTION_FAILED: 'Transaction failed. Please try again.',
  WALLET_NOT_CONNECTED: 'Please connect your wallet first.',
} as const;

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  BET_PLACED: 'Bet placed successfully!',
  POOL_CREATED: 'Pool created successfully!',
  WINNINGS_CLAIMED: 'Winnings claimed successfully!',
  WITHDRAWAL_REQUESTED: 'Withdrawal requested successfully!',
  TRANSACTION_SUBMITTED: 'Transaction submitted successfully!',
} as const;

/**
 * Validation messages
 */
export const VALIDATION_MESSAGES = {
  REQUIRED_FIELD: 'This field is required.',
  INVALID_FORMAT: 'Invalid format.',
  TOO_SHORT: 'Input is too short.',
  TOO_LONG: 'Input is too long.',
  MUST_BE_POSITIVE: 'Value must be positive.',
  MUST_BE_DIFFERENT: 'Values must be different.',
} as const;

/**
 * Feature flags
 */
export const FEATURE_FLAGS = {
  ENABLE_BATCH_CLAIMING: true,
  ENABLE_BATCH_WITHDRAWALS: true,
  ENABLE_REFUNDS: true,
  ENABLE_EMERGENCY_WITHDRAWAL: true,
  ENABLE_ANALYTICS: false,
} as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  POOL_DATA_TTL: 5 * 60 * 1000, // 5 minutes
  USER_DATA_TTL: 2 * 60 * 1000, // 2 minutes
  MARKET_STATS_TTL: 10 * 60 * 1000, // 10 minutes
} as const;
