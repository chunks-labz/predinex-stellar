/**
 * Validation utilities for form inputs and contract data
 * Provides reusable validation functions
 */

/**
 * Validate pool title
 * @param title Pool title
 * @returns Validation result
 */
import { MAX_POOL_DURATION_SECONDS, MIN_POOL_DURATION_SECONDS } from './constants';

export function validatePoolTitle(title: string): { valid: boolean; error?: string } {
  if (!title || title.trim().length === 0) {
    return { valid: false, error: 'Title is required' };
  }
  if (title.length > 256) {
    return { valid: false, error: 'Title must be less than 256 characters' };
  }
  if (title.length < 5) {
    return { valid: false, error: 'Title must be at least 5 characters' };
  }
  return { valid: true };
}

/**
 * Validate pool description
 * @param description Pool description
 * @returns Validation result
 */
export function validatePoolDescription(description: string): { valid: boolean; error?: string } {
  if (!description || description.trim().length === 0) {
    return { valid: false, error: 'Description is required' };
  }
  if (description.length > 512) {
    return { valid: false, error: 'Description must be less than 512 characters' };
  }
  if (description.length < 10) {
    return { valid: false, error: 'Description must be at least 10 characters' };
  }
  return { valid: true };
}

/**
 * Validate outcome name
 * @param outcome Outcome name
 * @returns Validation result
 */
export function validateOutcome(outcome: string): { valid: boolean; error?: string } {
  if (!outcome || outcome.trim().length === 0) {
    return { valid: false, error: 'Outcome is required' };
  }
  if (outcome.length > 128) {
    return { valid: false, error: 'Outcome must be less than 128 characters' };
  }
  if (outcome.length < 2) {
    return { valid: false, error: 'Outcome must be at least 2 characters' };
  }
  return { valid: true };
}

/**
 * Validate pool duration in seconds
 * @param duration Duration in seconds
 * @returns Validation result
 */
export function validateDuration(duration: number): { valid: boolean; error?: string } {
  if (!duration || duration <= 0) {
    return { valid: false, error: 'Duration must be greater than 0' };
  }
  if (duration < MIN_POOL_DURATION_SECONDS) {
    return {
      valid: false,
      error: `Duration must be at least ${MIN_POOL_DURATION_SECONDS} seconds (5 minutes)`,
    };
  }
  if (duration > MAX_POOL_DURATION_SECONDS) {
    return {
      valid: false,
      error: `Duration must be less than ${MAX_POOL_DURATION_SECONDS.toLocaleString()} seconds`,
    };
  }
  return { valid: true };
}

/**
 * Validate bet amount in STX
 * @param amount Bet amount in STX
 * @returns Validation result
 */
export function validateBetAmount(amount: number): { valid: boolean; error?: string } {
  if (!amount || isNaN(amount)) {
    return { valid: false, error: 'Amount is required' };
  }
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  if (amount < 0.1) {
    return { valid: false, error: 'Minimum bet is 0.1 STX' };
  }
  if (amount > 1000000) {
    return { valid: false, error: 'Maximum bet is 1,000,000 STX' };
  }
  return { valid: true };
}

/**
 * Validate Stacks address format
 * @param address Stacks address
 * @returns Validation result
 */
export function validateStacksAddress(address: string): { valid: boolean; error?: string } {
  if (!address) {
    return { valid: false, error: 'Address is required' };
  }
  // Stacks addresses start with SP or SM
  if (!address.match(/^(SP|SM)[A-Z0-9]{38}$/)) {
    return { valid: false, error: 'Invalid Stacks address format' };
  }
  return { valid: true };
}

// Mainnet addresses begin with SP or SM; testnet addresses begin with ST or SN.
const NETWORK_ADDRESS_PREFIXES: Record<'mainnet' | 'testnet', string[]> = {
  mainnet: ['SP', 'SM'],
  testnet: ['ST', 'SN'],
};

/**
 * Validate that a contract identifier (`<address>.<name>`) is well-formed and
 * that its address prefix matches the expected network.
 *
 * @param contractId  Full contract identifier, e.g. `SP2ABC...XYZ.my-contract`
 * @param network     Target network (`'mainnet'` or `'testnet'`)
 * @returns Validation result with an actionable error message on failure
 */
export function validateContractId(
  contractId: string,
  network: 'mainnet' | 'testnet'
): { valid: boolean; error?: string } {
  if (!contractId || contractId.trim().length === 0) {
    return { valid: false, error: 'Contract identifier is required' };
  }

  const id = contractId.trim();
  const lastDot = id.lastIndexOf('.');
  if (lastDot <= 0 || lastDot >= id.length - 1) {
    return {
      valid: false,
      error: `Invalid contract identifier '${id}'. Expected '<address>.<contractName>' format.`,
    };
  }

  const address = id.slice(0, lastDot);
  const name = id.slice(lastDot + 1);

  // Validate address format (SP/SM for mainnet, ST/SN for testnet, 40–41 chars total)
  if (!/^(SP|SM|ST|SN)[A-Z0-9]{38,39}$/.test(address)) {
    return {
      valid: false,
      error: `Invalid contract address '${address}' in identifier '${id}'. Stacks addresses must be 40–41 characters starting with SP, SM (mainnet) or ST, SN (testnet).`,
    };
  }

  // Validate network pairing
  const expectedPrefixes = NETWORK_ADDRESS_PREFIXES[network];
  const hasCorrectPrefix = expectedPrefixes.some((prefix) => address.startsWith(prefix));
  if (!hasCorrectPrefix) {
    const wrongNetwork = network === 'mainnet' ? 'testnet' : 'mainnet';
    return {
      valid: false,
      error: `Contract address '${address}' looks like a ${wrongNetwork} address (prefix '${address.slice(0, 2)}') but NEXT_PUBLIC_NETWORK is set to '${network}'. Update NEXT_PUBLIC_NETWORK or use a ${network} contract address (prefix: ${expectedPrefixes.join(' or ')}).`,
    };
  }

  // Validate contract name: lowercase letters, digits, hyphens only
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return {
      valid: false,
      error: `Invalid contract name '${name}' in identifier '${id}'. Contract names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens.`,
    };
  }

  return { valid: true };
}

/**
 * Validate withdrawal amount
 * @param amount Withdrawal amount
 * @param availableBalance Available balance
 * @returns Validation result
 */
export function validateWithdrawalAmount(
  amount: number,
  availableBalance: number
): { valid: boolean; error?: string } {
  if (!amount || amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  if (amount > availableBalance) {
    return { valid: false, error: 'Insufficient balance' };
  }
  return { valid: true };
}

/**
 * Validate pool creation form
 * @param data Form data
 * @returns Validation result
 */
export function validatePoolCreationForm(data: {
  title: string;
  description: string;
  outcomeA: string;
  outcomeB: string;
  duration: number;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const titleValidation = validatePoolTitle(data.title);
  if (!titleValidation.valid) errors.title = titleValidation.error!;

  const descriptionValidation = validatePoolDescription(data.description);
  if (!descriptionValidation.valid) errors.description = descriptionValidation.error!;

  const outcomeAValidation = validateOutcome(data.outcomeA);
  if (!outcomeAValidation.valid) errors.outcomeA = outcomeAValidation.error!;

  const outcomeBValidation = validateOutcome(data.outcomeB);
  if (!outcomeBValidation.valid) errors.outcomeB = outcomeBValidation.error!;

  const durationValidation = validateDuration(data.duration);
  if (!durationValidation.valid) errors.duration = durationValidation.error!;

  // Check outcomes are different
  if (data.outcomeA.toLowerCase() === data.outcomeB.toLowerCase()) {
    errors.outcomeB = 'Outcomes must be different';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}
