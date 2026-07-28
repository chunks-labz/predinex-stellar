/**
 * Contract utility functions for common operations
 * Provides helper functions for contract interactions
 */

import { uintCV, principalCV, stringAsciiCV } from "@stacks/transactions";

/**
 * Convert STX amount to microSTX (multiply by 1,000,000)
 * @param stxAmount Amount in STX
 * @returns Amount in microSTX
 */
export function stxToMicroStx(stxAmount: number): number {
  return Math.floor(stxAmount * 1_000_000);
}

/**
 * Convert microSTX to STX (divide by 1,000,000)
 * @param microStxAmount Amount in microSTX
 * @returns Amount in STX
 */
export function microStxToStx(microStxAmount: number): number {
  return microStxAmount / 1_000_000;
}

/**
 * Format STX amount for display with proper decimals
 * @param microStxAmount Amount in microSTX
 * @returns Formatted string
 */
export function formatStxAmount(microStxAmount: number): string {
  const stxAmount = microStxToStx(microStxAmount);
  return stxAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/**
 * Validate STX amount is positive and above minimum
 * @param amount Amount in STX
 * @param minimum Minimum allowed amount
 * @returns Validation result
 */
export function validateStxAmount(amount: number, minimum: number = 0.1): { valid: boolean; error?: string } {
  if (isNaN(amount) || amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  if (amount < minimum) {
    return { valid: false, error: `Minimum amount is ${minimum} STX` };
  }
  return { valid: true };
}

/**
 * Calculate odds percentage for an outcome
 * @param outcomeAmount Amount bet on outcome
 * @param totalAmount Total amount in pool
 * @returns Percentage (0-100)
 */
export function calculateOdds(outcomeAmount: number, totalAmount: number): number {
  if (totalAmount === 0) return 50;
  return Math.round((outcomeAmount / totalAmount) * 100);
}

/**
 * Calculate potential winnings from a bet
 * @param betAmount Amount bet
 * @param winningOutcomeAmount Total on winning outcome
 * @param losingOutcomeAmount Total on losing outcome
 * @returns Potential winnings
 */
export function calculatePotentialWinnings(
  betAmount: number,
  winningOutcomeAmount: number,
  losingOutcomeAmount: number
): number {
  if (winningOutcomeAmount === 0) return 0;
  const totalPool = winningOutcomeAmount + losingOutcomeAmount;
  const fee = Math.floor((totalPool * 2) / 100); // 2% fee
  const netPool = totalPool - fee;
  return Math.floor((betAmount / winningOutcomeAmount) * netPool);
}

/**
 * Calculate profit/loss from a bet
 * @param betAmount Amount bet
 * @param winnings Amount won (0 if lost)
 * @returns Profit/loss amount
 */
export function calculateProfitLoss(betAmount: number, winnings: number): number {
  return winnings - betAmount;
}

/**
 * Format percentage for display
 * @param percentage Percentage value
 * @returns Formatted string
 */
export function formatPercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Transaction fee reserve for quick-select bet percentage buttons (#837)
// ---------------------------------------------------------------------------

/**
 * Minimum XLM to keep in the wallet for transaction network fees.
 * Stellar base fee is 100 stroops (0.00001 XLM), but Soroban smart-contract
 * transactions can cost considerably more. Keeping 0.5 XLM ensures the
 * account stays above the minimum balance reserve and has enough headroom for
 * a typical Soroban fee surge.
 */
export const BET_TX_FEE_RESERVE_XLM = 0.5;

/**
 * Calculate a safe bet amount from a wallet balance percentage, leaving a
 * `BET_TX_FEE_RESERVE_XLM` buffer for transaction network fees.
 *
 * When the user taps a quick-select button (25 %, 50 %, 75 %, Max) the
 * percentage should be applied to the *spendable* balance (balance minus the
 * fee reserve), not the raw balance. This prevents the transaction from
 * failing because the account cannot cover both the bet and the network fee.
 *
 * @param balanceXlm   - Total wallet balance in XLM
 * @param pct          - Percentage to use (0–100)
 * @param minBetXlm    - Optional minimum bet in XLM; result is clamped to 0 if below this
 * @param maxBetXlm    - Optional maximum bet in XLM; result is clamped to this if exceeded
 * @param feeReserveXlm - Amount to reserve for tx fees (default: BET_TX_FEE_RESERVE_XLM)
 * @returns             Bet amount in XLM, rounded to 7 decimal places; 0 if the
 *                      spendable balance is too low.
 */
export function calcBetFromPercentage(
  balanceXlm: number,
  pct: number,
  minBetXlm = 0,
  maxBetXlm: number | null = null,
  feeReserveXlm = BET_TX_FEE_RESERVE_XLM
): number {
  const spendable = Math.max(0, balanceXlm - feeReserveXlm);
  if (spendable <= 0) return 0;

  let amount = parseFloat(((pct / 100) * spendable).toFixed(7));

  if (maxBetXlm !== null) amount = Math.min(amount, maxBetXlm);
  if (minBetXlm > 0 && amount < minBetXlm) return 0;

  return amount;
}

