/**
 * Write-side adapter: Soroban contract calls for the Predinex pool contract.
 * Keeps wallet prompt details, argument encoding, and contract identity out of UI components.
 */
import { openContractCall } from '@stacks/connect';
import type { Finished } from '@stacks/connect';
import { uintCV, stringAsciiCV } from '@stacks/transactions';
import { scValToNative } from '@stellar/stellar-sdk';
import { getRuntimeConfig } from '../runtime-config';
import { SorobanTransactionService, TxStage } from '../soroban-transaction-service';
import { FreighterWalletClient } from '../freighter-adapter';
import { scValToNative } from '@stellar/stellar-sdk';
import { invalidateOnPlaceBet, invalidateOnClaimWinnings } from '../cache-invalidation';

let sorobanService: SorobanTransactionService | null = null;

function getSorobanService() {
  if (!sorobanService) {
    const { soroban, network } = getRuntimeConfig();
    sorobanService = new SorobanTransactionService(soroban.rpcUrl, network);
  }
  return sorobanService;
}

export const predinexContract = {
  /**
   * Submit a `create_pool` Soroban contract call (wallet prompt).
   */
  async createMarketSoroban(params: {
    wallet: FreighterWalletClient;
    title: string;
    description: string;
    outcomeA: string;
    outcomeB: string;
    durationSeconds: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.createPool(
      params.wallet,
      soroban.contractId,
      {
        title: params.title,
        description: params.description,
        outcomeA: params.outcomeA,
        outcomeB: params.outcomeB,
        duration: params.durationSeconds,
      },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    let poolId: number | undefined;
    try {
      if (result.returnValue) {
        const decoded = scValToNative(result.returnValue);
        if (typeof decoded === 'number' || typeof decoded === 'bigint') {
          poolId = Number(decoded);
        }
      }
    } catch {
      // best-effort; extended metadata call will be skipped if poolId is unavailable
    }

    return { txHash: result.txHash, poolId };
  },

  /**
   * Submit a `create_multi_outcome_pool` Soroban contract call (wallet prompt).
   */
  async createMultiOutcomePoolSoroban(params: {
    wallet: FreighterWalletClient;
    title: string;
    description: string;
    outcomes: string[];
    durationSeconds: number;
    metadataUri?: string | null;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.createMultiOutcomePool(
      params.wallet,
      soroban.contractId,
      {
        title: params.title,
        description: params.description,
        outcomes: params.outcomes,
        duration: params.durationSeconds,
        metadataUri: params.metadataUri,
      },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    let poolId: number | undefined;
    try {
      if (result.returnValue) {
        const decoded = scValToNative(result.returnValue);
        if (typeof decoded === 'number' || typeof decoded === 'bigint') {
          poolId = Number(decoded);
        }
      }
    } catch {
      // best-effort; extended metadata call will be skipped if poolId is unavailable
    }

    return { txHash: result.txHash, poolId };
  },

  /**
   * Submit a `create_pool_from_template` Soroban contract call (wallet prompt).
   */
  async createPoolFromTemplateSoroban(params: {
    wallet: FreighterWalletClient;
    templateId: number;
    overrides: {
      title?: string;
      description?: string;
      outcomes?: string[];
      durationSeconds?: number;
      metadataUri?: string | null;
    };
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.createPoolFromTemplate(
      params.wallet,
      soroban.contractId,
      {
        templateId: params.templateId,
        overrides: {
          title: params.overrides.title,
          description: params.overrides.description,
          outcomes: params.overrides.outcomes,
          duration: params.overrides.durationSeconds,
          metadataUri: params.overrides.metadataUri,
        },
      },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    return { txHash: result.txHash };
  },

  /**
   * Submit a `place_bet` Soroban contract call (wallet prompt).
   */
  async placeBetSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    outcome: number;
    amountStroops: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.placeBet(
      params.wallet,
      soroban.contractId,
      {
        poolId: params.poolId,
        outcome: params.outcome,
        amountStroops: params.amountStroops,
      },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    // Issue #990: the pool detail page's manual fetchPool/fetchUserBet polling
    // and the market list/activity caches all go stale until the invalidation
    // policy already defined in cache-invalidation.ts actually runs — it was
    // never called from anywhere.
    if (params.wallet.address) {
      invalidateOnPlaceBet({ poolId: params.poolId, userAddress: params.wallet.address });
    }

    return { txHash: result.txHash };
  },

  /**
   * Submit a `set_pool_bet_limits` Soroban contract call (admin/treasury).
   *
   * @param params.wallet - Connected Freighter wallet client
   * @param params.poolId - ID of the pool to update
   * @param params.minBetStroops - New minimum bet size, in stroops
   * @param params.maxBetStroops - New maximum bet size, in stroops
   * @param params.onStageChange - Optional callback for transaction stage updates
   * @param params.onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The transaction hash
   *
   * @example
   * ```ts
   * const { txHash } = await predinexContract.setPoolBetLimitsSoroban({
   *   wallet,
   *   poolId: 12,
   *   minBetStroops: 1_000_000,
   *   maxBetStroops: 100_000_000,
   * });
   * ```
   */
  async setPoolBetLimitsSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    minBetStroops: number;
    maxBetStroops: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.setPoolBetLimits(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId, minBetStroops: params.minBetStroops, maxBetStroops: params.maxBetStroops },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    return { txHash: result.txHash };
  },

  /**
   * Submit a `claim_winnings` Soroban contract call (wallet prompt).
   */
  async claimWinningsSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.claimWinnings(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    // See the matching note in placeBetSoroban above (issue #990).
    if (params.wallet.address) {
      invalidateOnClaimWinnings({ poolId: params.poolId, userAddress: params.wallet.address });
    }

    return { txHash: result.txHash };
  },

  /**
   * Submit a `claim_all_winnings` Soroban contract call batching up to 20
   * pools in a single transaction (wallet prompt).
   */
  async claimAllWinningsSoroban(params: {
    wallet: FreighterWalletClient;
    poolIds: number[];
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string; claimedPoolIds: number[] }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.claimAllWinnings(
      params.wallet,
      soroban.contractId,
      { poolIds: params.poolIds },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    // Which pools actually paid out (the contract skips non-claimable ones).
    const claimedPoolIds = SorobanTransactionService.decodeClaimedPoolIds(result.returnValue);

    return { txHash: result.txHash, claimedPoolIds };
  },

  /**
   * Submit a `settle_pool` Soroban contract call (admin/treasury).
   *
   * @param params.wallet - Connected Freighter wallet client
   * @param params.poolId - ID of the pool being settled
   * @param params.winningOutcome - Index of the outcome declared as the winner (0 or 1)
   * @param params.onStageChange - Optional callback for transaction stage updates
   * @param params.onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The transaction hash
   *
   * @example
   * ```ts
   * const { txHash } = await predinexContract.settlePoolSoroban({
   *   wallet,
   *   poolId: 12,
   *   winningOutcome: 0,
   * });
   * ```
   */
  async settlePoolSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    winningOutcome: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string; winningOutcome?: number }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.settlePool(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId, winningOutcome: params.winningOutcome },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') {
      throw new Error(result.error || 'Transaction failed');
    }

    // Report success/outcome from the real on-chain result only. The pre-submit
    // simulation (`simulatedResults`) is stale once the transaction is mined and
    // must never be used to report the settled outcome. If the actual return
    // value cannot be decoded we fail loudly instead of silently reporting a
    // fabricated outcome.
    let decodedWinningOutcome: number | undefined;
    if (result.returnValue !== undefined) {
      try {
        decodedWinningOutcome = Number(scValToNative(result.returnValue));
      } catch (error) {
        throw new Error(
          `Settlement confirmed on-chain but its result could not be decoded: ${
            error instanceof Error ? error.message : 'decode error'
          }`
        );
      }
    }

    return { txHash: result.txHash, winningOutcome: decodedWinningOutcome };
  },

  async freezePoolSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.freezePool(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async disputePoolSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.disputePool(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async unfreezePoolSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.unfreezePool(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async depositLiquiditySoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    amountStroops: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.depositLiquidity(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId, amountStroops: params.amountStroops },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async withdrawLiquiditySoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    shares: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.withdrawLiquidity(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId, shares: params.shares },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async stakeLpSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    shares: number;
    durationSecs: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.stakeLp(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId, shares: params.shares, durationSecs: params.durationSecs },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },

  async claimLpRewardsSoroban(params: {
    wallet: FreighterWalletClient;
    poolId: number;
    onStageChange?: (stage: TxStage) => void;
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>;
  }): Promise<{ txHash: string }> {
    const { soroban } = getRuntimeConfig();
    const service = getSorobanService();

    const result = await service.claimLpRewards(
      params.wallet,
      soroban.contractId,
      { poolId: params.poolId },
      params.onStageChange,
      params.onFeeEstimated
    );

    if (result.status === 'FAILED') throw new Error(result.error || 'Transaction failed');
    return { txHash: result.txHash };
  },
};
