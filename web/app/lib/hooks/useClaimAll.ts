'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '../adapters/predinex-contract';
import { invalidateOnClaimWinnings } from '../cache-invalidation';
import { useWallet } from '@/components/WalletAdapterProvider';
import { TxStage } from '../soroban-transaction-service';
import { notifyBrowserEvent } from '../notifications';

/** Maximum pools the contract's `claim_all_winnings` accepts in one batch. */
export const CLAIM_ALL_MAX_POOLS = 20;

export type ClaimAllPoolStatus = 'pending' | 'claiming' | 'claimed' | 'skipped';

export interface ClaimAllPoolState {
  poolId: number;
  status: ClaimAllPoolStatus;
}

export type ClaimAllOverallStatus = 'idle' | 'claiming' | 'success' | 'partial' | 'failed';

export interface ClaimAllState {
  status: ClaimAllOverallStatus;
  pools: ClaimAllPoolState[];
  /** Number of pools that actually paid out. */
  claimedCount: number;
  error?: string;
  txId?: string;
}

const emptyState: ClaimAllState = {
  status: 'idle',
  pools: [],
  claimedCount: 0,
};

/**
 * Drives a batched `claim_all_winnings` call with per-pool progress feedback.
 *
 * The contract claims up to 20 pools in a single atomic transaction, so the
 * per-pool statuses transition together: every selected pool is marked
 * `claiming` while the transaction is in flight, then resolved to `claimed`
 * once it succeeds. (A pool the contract skips — e.g. not settled or a losing
 * position — would simply not pay out; callers should only pass known winners.)
 */
export function useClaimAll(userAddress?: string | null) {
  const wallet = useWallet();
  const { showToast } = useToast();
  const [state, setState] = useState<ClaimAllState>(emptyState);
  const [feePrompt, setFeePrompt] = useState<
    { feeStroops: string; resolve: (v: boolean) => void } | null
  >(null);
  const [stage, setStage] = useState<TxStage>('idle');

  const reset = useCallback(() => {
    setState(emptyState);
    setStage('idle');
    setFeePrompt(null);
  }, []);

  const claimAll = useCallback(
    async (poolIds: number[], onSuccess?: () => void) => {
      const batch = poolIds.slice(0, CLAIM_ALL_MAX_POOLS);
      if (batch.length === 0) {
        setState({ ...emptyState });
        return;
      }

      setStage('idle');
      setState({
        status: 'claiming',
        claimedCount: 0,
        pools: batch.map((poolId) => ({ poolId, status: 'claiming' })),
      });

      try {
        const { txHash, claimedPoolIds } = await predinexContract.claimAllWinningsSoroban({
          wallet,
          poolIds: batch,
          onStageChange: setStage,
          onFeeEstimated: (fee) =>
            new Promise<boolean>((resolve) => {
              setFeePrompt({ feeStroops: fee, resolve });
            }),
        });

        if (userAddress) {
          batch.forEach((poolId) => invalidateOnClaimWinnings({ poolId, userAddress }));
        }

        // The contract may pay out only a subset (it skips non-claimable pools),
        // so reflect per-pool outcome and flag a partial claim when some were
        // skipped. If decoding yielded nothing, assume every batched pool paid.
        const ids = claimedPoolIds ?? [];
        const claimed = new Set(ids.length > 0 ? ids : batch);
        const claimedCount = claimed.size;
        const isPartial = claimedCount > 0 && claimedCount < batch.length;

        setState({
          status: isPartial ? 'partial' : 'success',
          txId: txHash,
          claimedCount,
          pools: batch.map((poolId) => ({
            poolId,
            status: claimed.has(poolId) ? 'claimed' : 'skipped',
          })),
        });
        notifyBrowserEvent('Claim All submitted', {
          body: `Claimed winnings for ${claimedCount} pool${claimedCount === 1 ? '' : 's'}.`,
          tag: 'predinex-claim-all',
        });
        showToast(
          isPartial
            ? `Claimed ${claimedCount} of ${batch.length} pools.`
            : `Claimed winnings for ${claimedCount} pools!`,
          isPartial ? 'info' : 'success'
        );
        onSuccess?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to claim winnings';
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: message,
          pools: prev.pools.map((p) => ({ ...p, status: 'pending' })),
        }));
        if (message !== 'Transaction cancelled by user') {
          showToast(message, 'error');
        } else {
          showToast('Claim All transaction cancelled', 'info');
        }
      } finally {
        setStage('idle');
        setFeePrompt(null);
      }
    },
    [showToast, userAddress, wallet]
  );

  return { state, claimAll, reset, feePrompt, setFeePrompt, stage, setStage };
}
