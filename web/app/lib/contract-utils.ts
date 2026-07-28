/**
 * Contract utility functions for common operations.
 * Formatting and unit conversion live in the shared formatting module.
 */

/**
 * Convert STX amount to microSTX (multiply by 1,000,000)
 * @param stxAmount Amount in STX
 * @returns Amount in microSTX
 */
export function stxToMicroStx(stxAmount: bigint): bigint {
  return stxAmount * BigInt(1_000_000);
}

/**
 * Convert microSTX to STX (divide by 1,000,000)
 * @param microStxAmount Amount in microSTX
 * @returns Amount in STX
 */
export function microStxToStx(microStxAmount: bigint): number {
  return Number(microStxAmount) / 1_000_000;
}

/**
 * Format STX amount for display with proper decimals
 * @param microStxAmount Amount in microSTX
 * @returns Formatted string
 */
export function formatStxAmount(microStxAmount: bigint): string {
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
