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
 * `create_pool` parameters. `asset` and `depositAmount` live alongside the
 * pool metadata block (a leading description prefix) so the form can be
 * wired to a future `create_multi_asset_pool` without further UI changes.
 */
export interface CreatePoolParams {
  name: string;
  description: string;
  asset: string;
  depositAmount: number;
  expirySeconds: number;
  /** Defaults supplied if the form is empty. */
  outcomes?: { a: string; b: string };
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
  /** The default outcomes used to satisfy the contract call. */
  outcomes: { a: string; b: string };
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
 * Submit a pool-creation transaction through `predinexContract.createMarketSoroban`.
 *
 * The underlying contract call is `create_pool`. Asset / deposit metadata are
 * encoded in the description so the UI acceptance criteria are met today
 * while remaining forward-compatible with a future `create_multi_asset_pool`.
 */
export async function createPool(
  params: CreatePoolParams,
  options: CreatePoolSubmissionOptions
): Promise<CreatePoolSubmissionResult> {
  const outcomes = params.outcomes ?? { a: 'Yes', b: 'No' };
  const composedDescription = composePoolDescription(params);

  const { txHash } = await predinexContract.createMarketSoroban({
    wallet: options.wallet,
    title: params.name.trim(),
    description: composedDescription,
    outcomeA: outcomes.a,
    outcomeB: outcomes.b,
    durationSeconds: params.expirySeconds,
    onStageChange: options.onStageChange,
    onFeeEstimated: options.onFeeEstimated,
  });

  return { txHash, composedDescription, outcomes };
}
