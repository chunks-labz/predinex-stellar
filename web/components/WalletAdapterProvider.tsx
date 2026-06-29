'use client';

import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { createFreighterAdapter, FreighterWalletClient } from '@/app/lib/freighter-adapter';

const WalletContext = createContext<FreighterWalletClient | undefined>(undefined);

/**
 * WalletAdapterProvider
 * - Tracks Freighter wallet state.
 */
export function WalletAdapterProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [walletState, setWalletState] = useState<Partial<FreighterWalletClient>>({});

  useEffect(() => {
    // Initializing the adapter doesn't connect it
    const client = createFreighterAdapter((patch) => {
      setWalletState((prev) => ({ ...prev, ...patch }));
    });
    setWalletState(client);
  }, []);

  return (
    <WalletContext.Provider value={walletState as FreighterWalletClient}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletAdapterProvider');
  }
  return ctx;
}

