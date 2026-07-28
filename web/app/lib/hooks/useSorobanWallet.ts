'use client';

import { useState, useCallback, useMemo } from 'react';
import { createFreighterAdapter, isFreighterInstalled } from '../freighter-adapter';
import type { FreighterWalletClient } from '../freighter-adapter';

interface SorobanWalletState {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  isInstalled: boolean;
}

export function useSorobanWallet() {
  const [state, setState] = useState<SorobanWalletState>({
    address: null,
    isConnected: false,
    isLoading: false,
    error: null,
    isInstalled: isFreighterInstalled(),
  });

  const adapter = useMemo(
    () =>
      createFreighterAdapter((patch: Partial<FreighterWalletClient>) => {
        setState((prev) => ({
          ...prev,
          address: patch.address !== undefined ? patch.address : prev.address,
          isConnected: patch.isConnected !== undefined ? (patch.isConnected ?? false) : prev.isConnected,
          isLoading: patch.isLoading !== undefined ? (patch.isLoading ?? false) : prev.isLoading,
        }));
      }),
    []
  );

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, error: null }));
    try {
      await adapter.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet connection failed';
      setState((prev) => ({ ...prev, error: message }));
    }
  }, [adapter]);

  const disconnect = useCallback(() => {
    adapter.disconnect();
  }, [adapter]);

  return { ...state, connect, disconnect };
}
