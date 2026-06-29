/**
 * Write-side adapter: Soroban contract calls for the Predinex pool contract.
 * Keeps wallet prompt details, argument encoding, and contract identity out of UI components.
 */
import { getRuntimeConfig } from '../runtime-config';
import { SorobanTransactionService, TxStage } from '../soroban-transaction-service';
import { FreighterWalletClient } from '../freighter-adapter';

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
  }): Promise<{ txHash: string }> {
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

    return { txHash: result.txHash };
  },
};
