/**
 * Shared formatting utilities for consistent display across the application.
 * Centralizes formatting logic for currency, percentages, addresses, and durations.
 */

import { TOKEN_CONFIG } from '@/app/lib/config';

// =============================================================================
// Currency Formatting (#202 — Configurable token symbol; 1 unit = 10_000_000 stroops)
// =============================================================================

/** Stroops per token unit — the base unit. */
const STROOPS_PER_UNIT = TOKEN_CONFIG.STROOPS_PER_UNIT;

/** Configurable token symbol for display (e.g., 'STX', 'XLM', 'USD'). */
const TOKEN_SYMBOL = TOKEN_CONFIG.SYMBOL;



/**
 * Convert token units to stroops (multiply by STROOPS_PER_UNIT).
 */
export function unitsToStroops(amount: number): number {
  return Math.floor(amount * STROOPS_PER_UNIT);
}

/**
 * Backward-compatible alias for code still using the legacy STX naming.
 */
export const stxToMicroStx = unitsToStroops;


/**
 * Convert stroops to token units (divide by STROOPS_PER_UNIT).
 */
export function stroopsToUnits(stroops: number): number {
  return stroops / STROOPS_PER_UNIT;
}

/**
 * Backward-compatible alias for code still using the legacy STX naming.
 */
export const microStxToStx = stroopsToUnits;


/**
 * Format a stroops amount for display with proper decimal places.
 * Uses 2–7 decimal places based on value size.
 * Uses configurable TOKEN_SYMBOL.
 */
export function formatTokenAmount(stroops: number): string {
  const units = stroopsToUnits(stroops);
  return units.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  }) + ' ' + TOKEN_SYMBOL;
}

/**
 * Backward-compatible alias for code still using the legacy STX naming.
 */
export const formatStxAmount = formatTokenAmount;


/**
 * Format a stroops amount with compact notation (K, M suffixes).
 * Uses configurable TOKEN_SYMBOL.
 */
export function formatTokenAmountCompact(stroops: number): string {
  const amount = stroopsToUnits(stroops);
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}M ${TOKEN_SYMBOL}`;
  } else if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}K ${TOKEN_SYMBOL}`;
  } else if (amount >= 1) {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${TOKEN_SYMBOL}`;
  } else {
    return `${amount.toLocaleString('en-US', { maximumFractionDigits: 7 })} ${TOKEN_SYMBOL}`;
  }
}

/**
 * Backward-compatible alias for code still using the legacy STX naming.
 */
export const formatStxAmountCompact = formatTokenAmountCompact;


/**
 * Format a raw stroops value without asset suffix.
 */
export function formatStroopsValue(stroops: number): string {
  return stroopsToUnits(stroops).toFixed(2);
}

/**
 * Backward-compatible alias for code still using the legacy STX naming.
 */
export const formatMicroStxValue = formatStroopsValue;


// Export the configurable token symbol for use in components
export { TOKEN_SYMBOL, TOKEN_CONFIG };

// =============================================================================
// Percentage Formatting
// =============================================================================

/**
 * Format a percentage value with consistent decimal places.
 * @param percentage Percentage value (e.g., 75.5 for 75.5%)
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted string (e.g., "75.5%")
 */
export function formatPercentage(percentage: number, decimals = 1): string {
  return `${percentage.toFixed(decimals)}%`;
}

/**
 * Format a ratio as a percentage.
 * @param numerator Numerator value
 * @param denominator Denominator value
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted percentage string or "0%" if denominator is 0
 */
export function formatRatioAsPercentage(
  numerator: number,
  denominator: number,
  decimals = 1
): string {
  if (denominator === 0) return '0%';
  const percentage = (numerator / denominator) * 100;
  return formatPercentage(percentage, decimals);
}

// =============================================================================
// Address Formatting
// =============================================================================

export interface AddressDisplayOptions {
  /** Number of characters to show at the start (default: 6) */
  startChars: number;
  /** Number of characters to show at the end (default: 4) */
  endChars: number;
  /** Separator between start and end (default: "...") */
  separator: string;
}

const DEFAULT_ADDRESS_OPTIONS: AddressDisplayOptions = {
  startChars: 6,
  endChars: 4,
  separator: '...',
};

/**
 * Truncate an address for display.
 * @param address The full address (Stacks, Ethereum, etc.)
 * @param options Formatting options
 * @returns Truncated address string (e.g., "SP2W...580")
 */
export function formatAddress(
  address: string,
  options: Partial<AddressDisplayOptions> = {}
): string {
  if (!address) return '';

  const { startChars, endChars, separator } = { ...DEFAULT_ADDRESS_OPTIONS, ...options };

  if (address.length <= startChars + endChars) return address;

  return `${address.slice(0, startChars)}${separator}${address.slice(-endChars)}`;
}

/**
 * Format a Stellar address for standard wallet display.
 * Uses the canonical 6...4 truncation pattern.
 * @param address The full Stellar address
 * @returns Formatted address string
 */
export function formatStellarAddress(address: string): string {
  return formatAddress(address, { startChars: 6, endChars: 4 });
}

// =============================================================================
// Duration/Time Formatting
// =============================================================================

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Format milliseconds into a human-readable duration.
 * @param ms Duration in milliseconds
 * @param options Formatting options
 * @returns Formatted duration string
 */
export function formatDuration(
  ms: number,
  options: { compact?: boolean; showSeconds?: boolean } = {}
): string {
  const { compact = false, showSeconds = true } = options;

  if (ms <= 0) return compact ? '0s' : '0 seconds';

  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);

  const parts: string[] = [];

  if (days > 0) {
    parts.push(compact ? `${days}d` : `${days} day${days !== 1 ? 's' : ''}`);
  }
  if (hours > 0) {
    parts.push(compact ? `${hours}h` : `${hours} hour${hours !== 1 ? 's' : ''}`);
  }
  if (minutes > 0) {
    parts.push(compact ? `${minutes}m` : `${minutes} minute${minutes !== 1 ? 's' : ''}`);
  }
  if (showSeconds && seconds > 0 && days === 0) {
    parts.push(compact ? `${seconds}s` : `${seconds} second${seconds !== 1 ? 's' : ''}`);
  }

  if (parts.length === 0) {
    return compact ? '0s' : '0 seconds';
  }

  return compact ? parts.join(' ') : parts.join(', ');
}

/**
 * Format a deadline with time remaining.
 * @param deadlineMs Deadline timestamp in milliseconds
 * @param nowMs Current timestamp in milliseconds (defaults to Date.now())
 * @returns Formatted string showing time remaining or status
 */
export function formatTimeRemaining(
  deadlineMs: number,
  nowMs: number = Date.now()
): string {
  if (nowMs === 0) return 'Loading...';

  const remaining = deadlineMs - nowMs;

  if (remaining <= 0) return 'Expired';

  const hours = Math.floor(remaining / MS_PER_HOUR);
  const minutes = Math.floor((remaining % MS_PER_HOUR) / MS_PER_MINUTE);

  return `${hours}h ${minutes}m remaining`;
}

/**
 * Format a timestamp for display.
 * @param timestamp Unix timestamp in milliseconds or seconds
 * @param format Output format preference
 * @returns Formatted date/time string
 */
export function formatTimestamp(
  timestamp: number,
  format: 'short' | 'long' | 'relative' = 'short'
): string {
  // Treat 10-digit unix timestamps as seconds and 13-digit values as milliseconds.
  const ms = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);

  switch (format) {
    case 'short':
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    case 'long':
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    case 'relative':
      const now = Date.now();
      const diff = ms - now;

      if (Math.abs(diff) < MS_PER_MINUTE) {
        return diff > 0 ? 'in a few seconds' : 'just now';
      } else if (Math.abs(diff) < MS_PER_HOUR) {
        const mins = Math.floor(Math.abs(diff) / MS_PER_MINUTE);
        return diff > 0 ? `in ${mins}m` : `${mins}m ago`;
      } else if (Math.abs(diff) < MS_PER_DAY) {
        const hrs = Math.floor(Math.abs(diff) / MS_PER_HOUR);
        return diff > 0 ? `in ${hrs}h` : `${hrs}h ago`;
      } else {
        return formatDuration(Math.abs(diff), { compact: true });
      }
    default:
      return date.toISOString();
  }
}

// =============================================================================
// Number Formatting
// =============================================================================

/**
 * Format a number with locale-aware separators.
 * @param value Number to format
 * @param decimals Number of decimal places (default: 0)
 * @returns Formatted string (e.g., "1,234,567")
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a number with compact notation (K, M, B, T suffixes).
 * @param value Number to format
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted string (e.g., "1.5M", "2.3K")
 */
export function formatNumberCompact(value: number, decimals = 1): string {
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(decimals)}T`;
  } else if (absValue >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(decimals)}B`;
  } else if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(decimals)}M`;
  } else if (absValue >= 1_000) {
    return `${(value / 1_000).toFixed(decimals)}K`;
  }

  return value.toFixed(decimals);
}
