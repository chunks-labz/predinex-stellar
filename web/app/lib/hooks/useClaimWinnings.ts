'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '../adapters/predinex-contract';
import { invalidateOnClaimWinnings } from '../cache-invalidation';
import { useWallet } from '@/components/WalletAdapterProvider';
import { TxStage } from '../soroban-transaction-service';
import { notifyBrowserEvent } from '../notifications';

export type ClaimTxStatus = 'pending' | 'success' | 'failed';

export interface ClaimTxState {
  status: ClaimTxStatus;
  txId?: string;
  error?: string;
}

export function useClaimWinnings(userAddress?: string | null) {
  const wallet = useWallet();
  const { showToast } = useToast();
  const [claimTransactions, setClaimTransactions] = useState<Map<number, ClaimTxState>>(new Map());
  
  const [feePrompt, setFeePrompt] = useState<{ feeStroops: string, resolve: (v: boolean) => void } | null>(null);
  const [stage, setStage] = useState<TxStage>('idle');

  const claim = useCallback(
    async (poolId: number, onSuccess?: () => void) => {
      setClaimTransactions((prev) => new Map(prev).set(poolId, { status: 'pending' }));
      setStage('idle');

      try {
        const { txHash } = await predinexContract.claimWinningsSoroban({
          wallet,
          poolId,
          onStageChange: setStage,
          onFeeEstimated: (fee) => {
            return new Promise((resolve) => {
              setFeePrompt({ feeStroops: fee, resolve });
            });
          }
        });

        if (userAddress) {
          invalidateOnClaimWinnings({ poolId, userAddress });
        }

        setClaimTransactions((prev) =>
          new Map(prev).set(poolId, { status: 'success', txId: txHash })
        );
        notifyBrowserEvent('Claim submitted', {
          body: `Winnings claim for pool #${poolId} is being processed.`,
          tag: `predinex-claim-${poolId}`,
        });
        showToast('Claim submitted successfully!', 'success');
        onSuccess?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to claim winnings';
        setClaimTransactions((prev) =>
          new Map(prev).set(poolId, { status: 'failed', error: message })
        );
        if (message !== 'Transaction cancelled by user') {
          showToast(message, 'error');
        } else {
          showToast('Claim transaction cancelled', 'info');
        }
      } finally {
        setStage('idle');
        setFeePrompt(null);
      }
    },
    [showToast, userAddress, wallet]
  );

  return { claimTransactions, claim, feePrompt, setFeePrompt, stage, setStage };
}
