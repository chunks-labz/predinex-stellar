'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getRuntimeConfig } from '../runtime-config';

export type TxStatus = 'pending' | 'success' | 'failed' | 'idle';

export interface TxState {
  status: TxStatus;
  txId: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 3000;

async function fetchTxStatus(txId: string, sorobanRpcUrl: string): Promise<'pending' | 'success' | 'failed'> {
  const res = await fetch(sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: { hash: txId },
    }),
  });
  if (!res.ok) return 'pending';
  const data = await res.json();
  if (data.result && data.result.status === 'SUCCESS') return 'success';
  if (data.result && data.result.status === 'FAILED') return 'failed';
  return 'pending';
}

/**
 * Tracks a Stellar Soroban transaction from submission to finalization.
 * Polls every 3 s and stops when the tx finalizes or the component unmounts.
 *
 * @returns [txState, trackTx] — call trackTx(txId) immediately after contract call onFinish.
 */
export function useTxStatus(): [TxState, (txId: string) => void] {
  const [state, setState] = useState<TxState>({ status: 'idle', txId: null, error: null });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const trackTx = useCallback((txId: string) => {
    stopPolling();
    setState({ status: 'pending', txId, error: null });

    const { soroban } = getRuntimeConfig();

    intervalRef.current = setInterval(async () => {
      try {
        const status = await fetchTxStatus(txId, soroban.rpcUrl);
        if (status !== 'pending') {
          setState({ status, txId, error: status === 'failed' ? 'Transaction failed on-chain.' : null });
          stopPolling();
        }
      } catch {
        // network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  // Clean up on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  return [state, trackTx];
}
