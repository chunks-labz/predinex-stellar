/**
 * Validation utilities for form inputs and contract data
 * Provides reusable validation functions
 */

/**
 * Validate pool title
 * @param title Pool title
 * @returns Validation result
 */
import { MAX_POOL_DURATION_SECONDS as MAX_POOL_DURATION_SECS } from './constants';


export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_OUTCOME_LENGTH = 50;
export const MIN_POOL_DURATION_SECS = 300;
export { MAX_POOL_DURATION_SECS };

// A pool supports between 2 and 20 outcomes on-chain. The UI previously capped
// creation at 10; the contract actually accepts up to 20.
export const MIN_OUTCOME_COUNT = 2;
export const MAX_OUTCOME_COUNT = 20;

/**
 * Validate a Stacks contract identifier in `<address>.<name>` form.
 * The address prefix must match the target network when specified.
 */
export function validateContractId(
  contractId: string,
  network?: 'mainnet' | 'testnet' | 'devnet'
): { valid: boolean; error?: string } {
  if (!contractId || contractId.trim().length === 0) {
    return { valid: false, error: 'Contract identifier is required' };
  }

  const trimmed = contractId.trim();
  const separatorIndex = trimmed.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return { valid: false, error: 'Contract identifier must be in <address>.<name> format' };
  }

  const address = trimmed.slice(0, separatorIndex);
  const name = trimmed.slice(separatorIndex + 1);

  if (!/^(SP|ST)[A-Z0-9]{10,}$/.test(address)) {
    return { valid: false, error: 'Invalid Stacks contract address format' };
  }

  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    return { valid: false, error: 'Invalid contract name format' };
  }

  if (network === 'mainnet' && !address.startsWith('SP')) {
    return { valid: false, error: 'Mainnet contract addresses must start with SP' };
  }

  if ((network === 'testnet' || network === 'devnet') && !address.startsWith('ST')) {
    return { valid: false, error: 'Testnet/devnet contract addresses must start with ST' };
  }

  return { valid: true };
}

export function validatePoolTitle(title: string): { valid: boolean; error?: string } {
  if (!title || title.trim().length === 0) {
    return { valid: false, error: 'Title is required' };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or fewer` };
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
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
    };
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
  if (outcome.length > MAX_OUTCOME_LENGTH) {
    return { valid: false, error: `Outcome must be ${MAX_OUTCOME_LENGTH} characters or fewer` };
  }
  if (outcome.length < 2) {
    return { valid: false, error: 'Outcome must be at least 2 characters' };
  }
  return { valid: true };
}

/**
 * Validate a full list of pool outcomes against the on-chain limits.
 *
 * The contract accepts between `MIN_OUTCOME_COUNT` and `MAX_OUTCOME_COUNT`
 * (20) outcomes. Each entry must be a valid outcome label and all entries must
 * be unique (case-insensitive).
 *
 * @param outcomes The candidate outcome labels
 * @returns Validation result
 */
export function validateOutcomesList(
  outcomes: string[]
): { valid: boolean; error?: string } {
  if (!Array.isArray(outcomes) || outcomes.length < MIN_OUTCOME_COUNT) {
    return {
      valid: false,
      error: `A pool requires at least ${MIN_OUTCOME_COUNT} outcomes`,
    };
  }
  if (outcomes.length > MAX_OUTCOME_COUNT) {
    return {
      valid: false,
      error: `A pool supports at most ${MAX_OUTCOME_COUNT} outcomes`,
    };
  }

  for (const outcome of outcomes) {
    const result = validateOutcome(outcome);
    if (!result.valid) return result;
  }

  const normalized = outcomes.map((o) => o.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    return { valid: false, error: 'Outcomes must be unique' };
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
  if (duration < MIN_POOL_DURATION_SECS) {
    return {
      valid: false,
      error: `Duration must be at least ${MIN_POOL_DURATION_SECS} seconds (5 minutes)`,
    };
  }
  if (duration > MAX_POOL_DURATION_SECS) {
    return {
      valid: false,
      error: `Duration must be less than ${MAX_POOL_DURATION_SECS.toLocaleString()} seconds`,
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
    return { valid: false, error: 'Minimum bet is 0.1 XLM' };
  }
  if (amount > 1000000) {
    return { valid: false, error: 'Maximum bet is 1,000,000 XLM' };
  }
  return { valid: true };
}

/**
 * Validate Stellar address format
 * @param address Stellar address (G... strkey)
 * @returns Validation result
 */
export function validateStellarAddress(address: string): { valid: boolean; error?: string } {
  if (!address) {
    return { valid: false, error: 'Address is required' };
  }
  // Stellar strkeys use base32 characters A-Z and 2-7.
  if (!address.match(/^[GC][A-Z2-7]{55}$/)) {
    return { valid: false, error: 'Invalid Stellar address format' };
  }
  return { valid: true };
}

/**
 * Validate that a Stellar contract address is well-formed.
 * Stellar contracts use strkey format starting with 'C' and are 56 characters total.
 *
 * @param contractAddress  Stellar contract address, e.g. `CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA`
 * @returns Validation result with an actionable error message on failure
 */
export function validateStellarContractAddress(
  contractAddress: string
): { valid: boolean; error?: string } {
  if (!contractAddress || contractAddress.trim().length === 0) {
    return { valid: false, error: 'Contract address is required' };
  }

  const address = contractAddress.trim();

  // Validate Stellar contract address format (C prefix, 56 chars total)
  if (!/^C[A-Z2-7]{55}$/.test(address)) {
    return {
      valid: false,
      error: `Invalid Stellar contract address '${address}'. Stellar contract addresses must be 56 characters starting with 'C'.`,
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

type PoolCreationField = 'title' | 'description' | 'outcomeA' | 'outcomeB' | 'duration';

export function validateField(field: PoolCreationField | string, value: string): string | undefined {
  const result =
    field === 'title'
      ? validatePoolTitle(value)
      : field === 'description'
        ? validatePoolDescription(value)
        : field === 'outcomeA' || field === 'outcomeB'
          ? validateOutcome(value)
          : field === 'duration'
            ? validateDuration(Number.parseInt(value, 10))
            : { valid: true };

  return result.valid ? undefined : result.error;
}

export function getCharLimit(field: PoolCreationField | string): number | undefined {
  if (field === 'title') return MAX_TITLE_LENGTH;
  if (field === 'description') return MAX_DESCRIPTION_LENGTH;
  if (field === 'outcomeA' || field === 'outcomeB') return MAX_OUTCOME_LENGTH;
  return undefined;
}

export function getHelpText(field: PoolCreationField | string): string {
  if (field === 'title') return 'Ask a clear, objective market question.';
  if (field === 'description') return 'Include context and resolution criteria.';
  if (field === 'outcomeA' || field === 'outcomeB') return 'Use a short outcome label.';
  if (field === 'duration') return 'Duration is measured in seconds.';
  return '';
}
export * from '@/lib/validators';
