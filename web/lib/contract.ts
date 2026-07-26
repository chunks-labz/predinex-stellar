/**
 * Public contract facade for the Predinex pool creation flow.
 *
 * UI code should prefer importing from this module instead of reaching into
 * `web/app/lib/adapters/*` directly. The aggregator:
 *   1. Re-exports the read/write adapter surface.
 *   2. Adds a `createPool` facade that augments the standard `create_pool`
 *      contract call with the extended pool form fields (asset, deposit
 *      amount) by encoding them as a metadata block in the description.
 *      When the on-chain `create_multi_asset_pool` function becomes available
 *      it can be swapped in without touching call sites.
 */
import { predinexContract } from '@/app/lib/adapters/predinex-contract';
import type { FreighterWalletClient } from '@/app/lib/freighter-adapter';
import type { TxStage } from '@/app/lib/soroban-transaction-service';

export { predinexContract, predinexReadApi } from '@/app/lib/adapters';
export type { Pool, ActivityItem } from '@/app/lib/adapters';

/**
 * Pool-creation payload exposed to the UI.
 *
 * `name`, `description` and `expirySeconds` map directly to the on-chain
 * `create_multi_outcome_pool` parameters. `asset` and `depositAmount` live
 * alongside the pool metadata block so the form can be wired to a future
 * `create_multi_asset_pool` without further UI changes.
 *
 * `outcomes` is a list of 2–10 outcome label strings. When omitted, defaults
 * to `['Yes', 'No']` for backward-compatibility.
 */
export interface CreatePoolParams {
  name: string;
  description: string;
  asset: string;
  depositAmount: number;
  expirySeconds: number;
  /**
   * 2–10 outcome labels for the pool.
   * @default ['Yes', 'No']
   */
  outcomes?: string[];
}

export interface CreatePoolSubmissionOptions {
  wallet: FreighterWalletClient;
  onStageChange?: (stage: TxStage) => void;
  onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
}

export interface CreatePoolSubmissionResult {
  txHash: string;
  /** The description string actually sent on-chain, including metadata. */
  composedDescription: string;
  /** The outcomes used to satisfy the contract call. */
  outcomes: string[];
}

const POOL_METADATA_DELIMITER = '\n\n---\nPool metadata:';

/**
 * Compose the on-chain description: the user-written description followed by
 * a metadata block that captures the extended fields (asset, deposit).
 */
export function composePoolDescription(params: CreatePoolParams): string {
  const cleanDescription = params.description.trim();
  const meta = [
    `asset=${params.asset.trim().toUpperCase()}`,
    `depositAmount=${params.depositAmount}`,
    `expirySeconds=${params.expirySeconds}`,
  ].join('; ');
  return `${cleanDescription}${POOL_METADATA_DELIMITER} ${meta}`;
}

/**
 * Submit a pool-creation transaction through
 * `predinexContract.createMultiOutcomePoolSoroban`.
 *
 * Accepts 2–10 outcome labels (defaults to `['Yes', 'No']`). Asset / deposit
 * metadata are encoded in the description so extended fields are persisted
 * on-chain without a schema migration.
 */
export async function createPool(
  params: CreatePoolParams,
  options: CreatePoolSubmissionOptions
): Promise<CreatePoolSubmissionResult> {
  const outcomes =
    Array.isArray(params.outcomes) && params.outcomes.length >= 2
      ? params.outcomes
      : ['Yes', 'No'];
  const composedDescription = composePoolDescription(params);

  const { txHash } = await predinexContract.createMultiOutcomePoolSoroban({
    wallet: options.wallet,
    title: params.name.trim(),
    description: composedDescription,
    outcomes,
    durationSeconds: params.expirySeconds,
    onStageChange: options.onStageChange,
    onFeeEstimated: options.onFeeEstimated,
  });

  return { txHash, composedDescription, outcomes };
}
