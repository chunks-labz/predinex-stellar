'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/providers/ToastProvider';
import { predinexContract } from '../adapters/predinex-contract';
import { useWallet } from '@/components/WalletAdapterProvider';
import { TxStage } from '../soroban-transaction-service';

export type SettleTxStatus = 'pending' | 'success' | 'failed';

export interface SettleTxState {
  status: SettleTxStatus;
  txId?: string;
  error?: string;
}

export function useSettlePool() {
  const wallet = useWallet();
  const { showToast } = useToast();
  const [settleTransactions, setSettleTransactions] = useState<Map<number, SettleTxState>>(new Map());
  
  const [feePrompt, setFeePrompt] = useState<{ feeStroops: string, resolve: (v: boolean) => void } | null>(null);
  const [stage, setStage] = useState<TxStage>('idle');

  const settle = useCallback(
    async (poolId: number, winningOutcome: number, onSuccess?: () => void) => {
      setSettleTransactions((prev) => new Map(prev).set(poolId, { status: 'pending' }));
      setStage('idle');

      try {
        const { txHash } = await predinexContract.settlePoolSoroban({
          wallet,
          poolId,
          winningOutcome,
          onStageChange: setStage,
          onFeeEstimated: (fee) => {
            return new Promise((resolve) => {
              setFeePrompt({ feeStroops: fee, resolve });
            });
          }
        });

        setSettleTransactions((prev) =>
          new Map(prev).set(poolId, { status: 'success', txId: txHash })
        );
        showToast('Pool settled successfully!', 'success');
        onSuccess?.();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to settle pool';
        setSettleTransactions((prev) =>
          new Map(prev).set(poolId, { status: 'failed', error: message })
        );
        if (message !== 'Transaction cancelled by user') {
          showToast(message, 'error');
        } else {
          showToast('Settle transaction cancelled', 'info');
        }
      } finally {
        setStage('idle');
        setFeePrompt(null);
      }
    },
    [showToast, wallet]
  );

  return { settleTransactions, settle, feePrompt, setFeePrompt, stage, setStage };
}
