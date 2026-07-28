'use client';

import { ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { createFreighterAdapter, isFreighterInstalled, FreighterWalletClient } from '@/app/lib/freighter-adapter';

const STORAGE_KEY = 'predinex:wallet:connected';
const LEGACY_STORAGE_KEY = 'predinex:wallet:address';

/**
 * Wallet context value exposed to consumers.
 * Extends FreighterWalletClient so hooks that pass the wallet to contract
 * adapters (useClaimWinnings, useClaimAll, create page) can do so without
 * an explicit cast.
 */
export interface WalletContextValue extends FreighterWalletClient {
  isInstalled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletAdapterProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const adapterRef = useRef<FreighterWalletClient | null>(null);

  useEffect(() => {
    const adapter = createFreighterAdapter((patch) => {
      if (patch.address !== undefined) {
        setAddress(patch.address);
        if (patch.address) {
          localStorage.setItem(STORAGE_KEY, 'true');
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } else {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
      if (patch.isConnected !== undefined) setIsConnected(patch.isConnected ?? false);
      if (patch.isLoading !== undefined) setIsLoading(patch.isLoading ?? false);
    });
    adapterRef.current = adapter;

    const persisted = localStorage.getItem(STORAGE_KEY) === 'true' || localStorage.getItem(LEGACY_STORAGE_KEY) !== null;
    if (persisted && isFreighterInstalled()) {
      adapter.connect().catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      });
    }
  }, []);

  const connect = async () => adapterRef.current?.connect();
  const disconnect = () => {
    adapterRef.current?.disconnect();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  };

  // Delegate signing to the adapter so context satisfies FreighterWalletClient
  const signTransaction: WalletContextValue['signTransaction'] = (xdr, opts) => {
    if (!adapterRef.current) throw new Error('Wallet not connected');
    return adapterRef.current.signTransaction(xdr, opts);
  };
  const signAuthEntry: WalletContextValue['signAuthEntry'] = (entryPreimageXdr, opts) => {
    if (!adapterRef.current) throw new Error('Wallet not connected');
    return adapterRef.current.signAuthEntry(entryPreimageXdr, opts);
  };
  const getNetwork: WalletContextValue['getNetwork'] = () => {
    if (!adapterRef.current) throw new Error('Wallet not connected');
    return adapterRef.current.getNetwork();
  };

  const value: WalletContextValue = {
    // FreighterWalletClient base
    chain: 'stacks',
    address,
    isConnected,
    isLoading,
    connect,
    disconnect,
    signTransaction,
    signAuthEntry,
    getNetwork,
    // Extra
    isInstalled: isFreighterInstalled(),
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletAdapterProvider');
  return ctx;
}
