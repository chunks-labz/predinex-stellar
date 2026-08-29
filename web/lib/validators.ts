/**
 * Validation utilities for form inputs and contract data
 * Provides reusable validation functions
 */

/**
 * Validate pool title
 * @param title Pool title
 * @returns Validation result
 */
import { MAX_POOL_DURATION_SECONDS as MAX_POOL_DURATION_SECS } from '@/app/lib/constants';


export const MAX_TITLE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_OUTCOME_LENGTH = 50;
export const MIN_OUTCOMES = 2;
export const MAX_OUTCOMES = 10;
export const DEFAULT_PROTOCOL_FEE_BPS = 200;
export const MAX_PROTOCOL_FEE_BPS = 1000;

export type SettlementType = 'oracle' | 'twap' | 'manual';
export const SETTLEMENT_TYPES: SettlementType[] = ['oracle', 'twap', 'manual'];
export const MIN_POOL_DURATION_SECS = 300;
export const MAX_DEPOSIT_AMOUNT = 1_000_000;
export const MIN_DEPOSIT_AMOUNT = 0.1;
export { MAX_POOL_DURATION_SECS };

/**
 * Supported asset identifier set for the pool creation form.
 *
 * The current Stellar (Soroban) contract only accepts the native asset (`XLM`)
 * but the UI is built to forward additional asset identifiers as metadata in
 * case the contract gains a multi-asset path in the future.
 */
export const SUPPORTED_POOL_ASSETS = ['XLM', 'USDC', 'BTC', 'ETH'] as const;
export type SupportedPoolAsset = (typeof SUPPORTED_POOL_ASSETS)[number];

/**
 * Validate a Stellar Soroban contract address.
 *
 * The optional network argument is accepted for backward-compatible callers,
 * but Stellar contract strkeys do not encode mainnet/testnet in the prefix.
 */
export function validateContractId(
  contractId: string,
  network?: 'mainnet' | 'testnet' | 'devnet'
): { valid: boolean; error?: string } {
  void network;
  return validateStellarContractAddress(contractId);
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
 * Validate bet amount in XLM
 * @param amount Bet amount in XLM
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
 * Validate a pool-creation asset identifier.
 *
 * @param asset Asset symbol input from the pool form
 * @returns Validation result
 */
export function validateAssetType(
  asset: string
): { valid: boolean; error?: string } {
  if (!asset || asset.trim().length === 0) {
    return { valid: false, error: 'Asset type is required' };
  }
  const normalised = asset.trim().toUpperCase();
  if (!SUPPORTED_POOL_ASSETS.includes(normalised as SupportedPoolAsset)) {
    return {
      valid: false,
      error: `Unsupported asset '${asset}'. Choose one of: ${SUPPORTED_POOL_ASSETS.join(', ')}.`,
    };
  }
  return { valid: true };
}

/**
 * Validate a pool deposit / minimum bet amount.
 *
 * @param amount Deposit amount in the chosen asset
 * @returns Validation result
 */
export function validateDepositAmount(
  amount: number
): { valid: boolean; error?: string } {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return { valid: false, error: 'Deposit amount is required' };
  }
  if (amount <= 0) {
    return { valid: false, error: 'Deposit amount must be greater than 0' };
  }
  if (amount < MIN_DEPOSIT_AMOUNT) {
    return {
      valid: false,
      error: `Deposit amount must be at least ${MIN_DEPOSIT_AMOUNT}`,
    };
  }
  if (amount > MAX_DEPOSIT_AMOUNT) {
    return {
      valid: false,
      error: `Deposit amount must be ${MAX_DEPOSIT_AMOUNT.toLocaleString()} or less`,
    };
  }
  return { valid: true };
}

/**
 * Validate the full pool creation form (v2 — pool-centric fields).
 *
 * @param data Form data
 * @returns Validation result with aggregated errors
 */
export function validatePoolForm(data: {
  name: string;
  description: string;
  asset: string;
  depositAmount: number;
  expirySeconds: number;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const titleValidation = validatePoolTitle(data.name);
  if (!titleValidation.valid) errors.name = titleValidation.error!;

  const descriptionValidation = validatePoolDescription(data.description);
  if (!descriptionValidation.valid) errors.description = descriptionValidation.error!;

  const assetValidation = validateAssetType(data.asset);
  if (!assetValidation.valid) errors.asset = assetValidation.error!;

  const depositValidation = validateDepositAmount(data.depositAmount);
  if (!depositValidation.valid) errors.depositAmount = depositValidation.error!;

  const expiryValidation = validateDuration(data.expirySeconds);
  if (!expiryValidation.valid) errors.expirySeconds = expiryValidation.error!;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validateDepositDeadline(
  depositDeadline: number,
  duration?: number
): { valid: boolean; error?: string } {
  if (!Number.isFinite(depositDeadline) || depositDeadline <= 0) {
    return { valid: false, error: 'Deposit deadline must be greater than 0 seconds' };
  }
  if (depositDeadline < MIN_POOL_DURATION_SECS) {
    return {
      valid: false,
      error: `Deposit deadline must be at least ${MIN_POOL_DURATION_SECS} seconds`,
    };
  }
  if (duration !== undefined && depositDeadline >= duration) {
    return {
      valid: false,
      error: 'Deposit deadline must be shorter than the pool expiry duration',
    };
  }
  return { valid: true };
}

export function validateProtocolFeeBps(
  feeBps: number
): { valid: boolean; error?: string } {
  if (!Number.isFinite(feeBps)) {
    return { valid: false, error: 'Protocol fee is required' };
  }
  if (feeBps < 0 || feeBps > MAX_PROTOCOL_FEE_BPS) {
    return {
      valid: false,
      error: `Protocol fee must be between 0 and ${MAX_PROTOCOL_FEE_BPS} basis points`,
    };
  }
  return { valid: true };
}

export function validateSettlementType(
  value: string
): { valid: boolean; error?: string } {
  if (!SETTLEMENT_TYPES.includes(value as SettlementType)) {
    return { valid: false, error: 'Select a valid settlement type' };
  }
  return { valid: true };
}

export function validateOutcomesList(
  outcomes: string[]
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (outcomes.length < MIN_OUTCOMES) {
    errors.outcomes = `At least ${MIN_OUTCOMES} outcomes are required`;
  }
  if (outcomes.length > MAX_OUTCOMES) {
    errors.outcomes = `No more than ${MAX_OUTCOMES} outcomes are allowed`;
  }

  const seen = new Set<string>();
  outcomes.forEach((outcome, index) => {
    const validation = validateOutcome(outcome);
    if (!validation.valid) {
      errors[`outcome_${index}`] = validation.error!;
      return;
    }
    const key = outcome.trim().toLowerCase();
    if (seen.has(key)) {
      errors[`outcome_${index}`] = 'Outcome labels must be unique';
      return;
    }
    seen.add(key);
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Validate pool creation form (legacy two-outcome wizard).
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

  if (data.outcomeA.toLowerCase() === data.outcomeB.toLowerCase()) {
    errors.outcomeB = 'Outcomes must be different';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function validatePoolWizardForm(data: {
  title: string;
  description: string;
  outcomes: string[];
  duration: number;
  depositDeadline: number;
  protocolFeeBps: number;
  settlementType: string;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const titleValidation = validatePoolTitle(data.title);
  if (!titleValidation.valid) errors.title = titleValidation.error!;

  const descriptionValidation = validatePoolDescription(data.description);
  if (!descriptionValidation.valid) errors.description = descriptionValidation.error!;

  const outcomesValidation = validateOutcomesList(data.outcomes);
  Object.assign(errors, outcomesValidation.errors);

  const durationValidation = validateDuration(data.duration);
  if (!durationValidation.valid) errors.duration = durationValidation.error!;

  const depositValidation = validateDepositDeadline(data.depositDeadline, data.duration);
  if (!depositValidation.valid) errors.depositDeadline = depositValidation.error!;

  const feeValidation = validateProtocolFeeBps(data.protocolFeeBps);
  if (!feeValidation.valid) errors.protocolFeeBps = feeValidation.error!;

  const settlementValidation = validateSettlementType(data.settlementType);
  if (!settlementValidation.valid) errors.settlementType = settlementValidation.error!;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

type PoolCreationField =
  | 'title'
  | 'description'
  | 'duration'
  | 'depositDeadline'
  | 'protocolFeeBps'
  | 'settlementType'
  | 'outcomeA'
  | 'outcomeB';

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
          : field === 'depositDeadline'
            ? validateDepositDeadline(Number.parseInt(value, 10))
            : field === 'protocolFeeBps'
              ? validateProtocolFeeBps(Number.parseInt(value, 10))
              : field === 'settlementType'
                ? validateSettlementType(value)
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
  if (field === 'duration') return 'Pool lifetime in seconds until expiry.';
  if (field === 'depositDeadline') return 'Seconds after open when new deposits stop.';
  if (field === 'protocolFeeBps') return 'Protocol fee in basis points (100 bps = 1%).';
  if (field === 'settlementType') return 'How the winning outcome is determined.';
  return '';
}
