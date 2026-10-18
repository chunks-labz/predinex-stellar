/**
 * Typed SDK helper for the place-wager flow (Issue #1439).
 *
 * Placing a wager used to require callers to assemble a `place_bet` Soroban
 * invocation themselves — picking the outcome index, converting stroops to
 * `i128`, and encoding the referrer as `Option<Address>` — which is easy to
 * get wrong. `placeWager` wraps that assembly in a single typed entry point:
 *
 * - outcomes are accepted as `0 | 1 | 'A' | 'B'` and encoded to the
 *   contract's `u32` outcome index,
 * - amounts (and pool ids / referrers) are validated *before* any network
 *   call, so invalid input fails fast with a {@link WagerValidationError},
 * - the submission returns a structured {@link PlaceWagerResult} carrying the
 *   transaction hash.
 *
 * @example
 * ```ts
 * import { placeWager } from '@/app/lib/place-wager';
 *
 * const result = await placeWager({
 *   wallet,                        // connected Freighter wallet
 *   poolId: 12,
 *   outcome: 'B',                  // or 1, 'b'
 *   amountStroops: 5_000_000,      // 0.5 XLM
 * });
 *
 * console.log(result.txHash);      // transaction hash on the Stellar network
 * console.log(result.outcomeLabel); // 'B'
 * ```
 */

import { predinexContract } from './adapters/predinex-contract';
import type { FreighterWalletClient } from './freighter-adapter';
import type { TxStage } from './soroban-transaction-service';

/** Minimum bet accepted by the contract (`MIN_BET_AMOUNT`), in stroops. */
export const MIN_WAGER_STROOPS = 1n;

/** Maximum `i128` value the contract's `place_bet` amount can hold. */
export const MAX_WAGER_STROOPS = (1n << 127n) - 1n;

/** Stellar ed25519 account id (`G...`). */
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;

/** Outcome as accepted from integrators; encoded to `0 | 1` before submission. */
export type WagerOutcomeInput = 0 | 1 | 'A' | 'B' | 'a' | 'b';

/** Which parameter failed validation. */
export type WagerField = 'wallet' | 'poolId' | 'outcome' | 'amountStroops' | 'referrer';

/**
 * Thrown when place-wager input is invalid. Carries the offending `field` so
 * callers can map the failure back to a form control.
 */
export class WagerValidationError extends Error {
  readonly field: WagerField;

  constructor(field: WagerField, message: string) {
    super(message);
    this.name = 'WagerValidationError';
    this.field = field;
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return String(value);
}

/**
 * Encodes an outcome accepted by the SDK (`0 | 1 | 'A' | 'B'`) to the `u32`
 * index the contract expects: `0` for 'A', `1` for 'B'.
 *
 * @throws {WagerValidationError} when the value is not a supported outcome.
 */
export function encodeWagerOutcome(outcome: unknown): 0 | 1 {
  if (outcome === 0 || outcome === 'A' || outcome === 'a') return 0;
  if (outcome === 1 || outcome === 'B' || outcome === 'b') return 1;
  throw new WagerValidationError(
    'outcome',
    `outcome must be 0 or "A" for the first outcome, or 1 or "B" for the second (got ${describe(outcome)})`
  );
}

/**
 * Validates a market/pool id: a positive `u32`.
 *
 * @throws {WagerValidationError} when the value is not a positive u32.
 */
export function validatePoolId(poolId: unknown): number {
  if (
    typeof poolId !== 'number' ||
    !Number.isInteger(poolId) ||
    poolId < 1 ||
    poolId > 0xffff_ffff
  ) {
    throw new WagerValidationError(
      'poolId',
      `poolId must be an integer between 1 and 4294967295 (got ${describe(poolId)})`
    );
  }
  return poolId;
}

function parseAmount(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
  }
  return null;
}

/**
 * Validates a wager amount in stroops. Accepts `number`, `bigint` or a
 * decimal string; the amount must be a positive integer within `i128`.
 *
 * @returns The amount as a `bigint`, ready to encode as `i128`.
 * @throws {WagerValidationError} when the amount is not a valid positive
 *   integer, or exceeds the contract's `i128` range.
 */
export function validateWagerAmount(amountStroops: unknown): bigint {
  const parsed = parseAmount(amountStroops);
  if (parsed === null) {
    throw new WagerValidationError(
      'amountStroops',
      `amountStroops must be a positive integer number of stroops (got ${describe(amountStroops)})`
    );
  }
  if (parsed <= 0n) {
    throw new WagerValidationError(
      'amountStroops',
      'amountStroops must be greater than zero'
    );
  }
  if (parsed > MAX_WAGER_STROOPS) {
    throw new WagerValidationError(
      'amountStroops',
      `amountStroops must not exceed ${MAX_WAGER_STROOPS} stroops (the contract stores the amount as i128)`
    );
  }
  return parsed;
}

/**
 * Validates an optional referrer address. Empty/`null`/`undefined` become
 * `null` (no referrer); non-empty values must be a Stellar account id that
 * differs from the wager address (the contract rejects self-referrals).
 *
 * @throws {WagerValidationError} when the referrer is malformed or equals the
 *   wager address.
 */
export function validateReferrer(
  referrer: unknown,
  wagerAddress?: string
): string | null {
  if (referrer === undefined || referrer === null || referrer === '') return null;
  if (typeof referrer !== 'string' || !STELLAR_ACCOUNT_ID.test(referrer)) {
    throw new WagerValidationError(
      'referrer',
      `referrer must be a Stellar account id starting with "G" (got ${describe(referrer)})`
    );
  }
  if (wagerAddress && referrer === wagerAddress) {
    throw new WagerValidationError(
      'referrer',
      'referrer must differ from the wager address (the contract rejects self-referrals)'
    );
  }
  return referrer;
}

function validateWallet(
  wallet: FreighterWalletClient | null | undefined
): FreighterWalletClient {
  if (!wallet || typeof wallet.address !== 'string' || wallet.address.length === 0) {
    throw new WagerValidationError(
      'wallet',
      'wallet must be a connected wallet with a Stellar address'
    );
  }
  return wallet;
}

/** Input accepted by {@link placeWager}. */
export interface PlaceWagerParams {
  /** Connected wallet that will sign and pay for the wager. */
  wallet: FreighterWalletClient;
  /** Market/pool id to wager on (positive `u32`). */
  poolId: number;
  /** Outcome to back: `0`/`'A'` or `1`/`'B'` (case-insensitive). */
  outcome: WagerOutcomeInput;
  /** Wager size in stroops: positive integer `number`, `bigint` or decimal string. */
  amountStroops: number | bigint | string;
  /** Optional referrer account id; must differ from the wager address. */
  referrer?: string | null;
  /** Optional progress callback (simulating → signing → submitting → polling → success). */
  onStageChange?: (stage: TxStage) => void;
  /** Optional fee confirmation callback; return `false` to abort before signing. */
  onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
}

/** Validated, contract-ready form of {@link PlaceWagerParams}. */
export interface NormalizedWager {
  poolId: number;
  outcome: 0 | 1;
  amountStroops: bigint;
  referrer: string | null;
}

/**
 * Validates and normalizes place-wager input without touching the network.
 * Every check throws a {@link WagerValidationError} naming the bad field.
 */
export function normalizePlaceWagerParams(params: PlaceWagerParams): NormalizedWager {
  const wallet = validateWallet(params?.wallet);
  const poolId = validatePoolId(params?.poolId);
  const outcome = encodeWagerOutcome(params?.outcome);
  const amountStroops = validateWagerAmount(params?.amountStroops);
  const referrer = validateReferrer(params?.referrer ?? null, wallet.address);

  return { poolId, outcome, amountStroops, referrer };
}

/** Contract-ready arguments handed to the submitter. */
export interface PlaceBetSubmission {
  wallet: FreighterWalletClient;
  poolId: number;
  outcome: 0 | 1;
  amountStroops: bigint;
  referrer: string | null;
  onStageChange?: (stage: TxStage) => void;
  onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
}

/**
 * Submits an encoded `place_bet` call. The default submission routes through
 * the wallet-prompt adapter; tests and custom signers can inject their own.
 */
export type PlaceBetSubmitter = (
  submission: PlaceBetSubmission
) => Promise<{ txHash: string }>;

/** Default submitter: the Freighter wallet-prompt adapter. */
export const defaultPlaceBetSubmitter: PlaceBetSubmitter = (submission) =>
  predinexContract.placeBetSoroban({
    wallet: submission.wallet,
    poolId: submission.poolId,
    outcome: submission.outcome,
    amountStroops: submission.amountStroops,
    referrer: submission.referrer,
    onStageChange: submission.onStageChange,
    onFeeEstimated: submission.onFeeEstimated,
  });

/** Optional dependencies for {@link placeWager} (primarily for tests). */
export interface PlaceWagerDeps {
  /** Override the transaction submitter. */
  submit?: PlaceBetSubmitter;
}

/** Structured result of a successful wager submission. */
export interface PlaceWagerResult {
  /** Always `'SUCCESS'`; failures reject instead. */
  status: 'SUCCESS';
  /** Transaction hash on the Stellar network. */
  txHash: string;
  /** Market/pool id that was wagered on. */
  poolId: number;
  /** Encoded outcome index submitted to the contract. */
  outcome: 0 | 1;
  /** Human-readable outcome label (`'A'` or `'B'`). */
  outcomeLabel: 'A' | 'B';
  /** Wager size in stroops, exact (BigInt serialized as a decimal string). */
  amountStroops: string;
  /** Referrer account id, or `null` when none was used. */
  referrer: string | null;
  /** ISO timestamp of the submission. */
  submittedAt: string;
}

/**
 * Builds and submits a `place_bet` transaction through the connected wallet.
 *
 * Invalid input fails fast (before any RPC call) with a
 * {@link WagerValidationError}; submission errors from the wallet or network
 * are propagated unchanged so the caller can surface them.
 *
 * @example
 * ```ts
 * const result = await placeWager({
 *   wallet,
 *   poolId: 12,
 *   outcome: 'B',
 *   amountStroops: 5_000_000,
 *   referrer: 'GB...', // optional
 * });
 *
 * console.log(`Wager submitted: ${result.txHash}`);
 * ```
 */
export async function placeWager(
  params: PlaceWagerParams,
  deps: PlaceWagerDeps = {}
): Promise<PlaceWagerResult> {
  const normalized = normalizePlaceWagerParams(params);
  const submit = deps.submit ?? defaultPlaceBetSubmitter;

  const { txHash } = await submit({
    wallet: params.wallet,
    poolId: normalized.poolId,
    outcome: normalized.outcome,
    amountStroops: normalized.amountStroops,
    referrer: normalized.referrer,
    onStageChange: params.onStageChange,
    onFeeEstimated: params.onFeeEstimated,
  });

  if (typeof txHash !== 'string' || txHash.length === 0) {
    throw new Error('place_wager submission did not return a transaction hash');
  }

  return {
    status: 'SUCCESS',
    txHash,
    poolId: normalized.poolId,
    outcome: normalized.outcome,
    outcomeLabel: normalized.outcome === 0 ? 'A' : 'B',
    amountStroops: normalized.amountStroops.toString(),
    referrer: normalized.referrer,
    submittedAt: new Date().toISOString(),
  };
}
