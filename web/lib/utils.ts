import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Truncates an address for display.
 * @param address The full address
 * @param startChars Number of characters to show at the start (default: 6)
 * @param endChars Number of characters to show at the end (default: 4)
 * @returns Truncated address string (e.g., "SP2W...580")
 */
export function truncateAddress(address: string, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;

  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Formats a number as a currency string.
 * @param amount The number to format
 * @param currency The currency symbol (default: 'STX')
 * @returns Formatted string (e.g., "1,250 STX")
 */
export function formatAmount(amount: number, currency = 'STX'): string {
  return `${amount.toLocaleString()} ${currency}`;
}
