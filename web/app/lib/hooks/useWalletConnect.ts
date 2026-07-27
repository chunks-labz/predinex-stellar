/**
 * Hook for WalletConnect integration
 * Adapted to use Reown AppKit directly
 */

'use client';

import { useWallet } from '@/components/WalletAdapterProvider';
import { getRuntimeConfig } from '@/app/lib/runtime-config';
import { createScopedLogger } from '@/app/lib/logger';
import { useEffect, useMemo, useState } from 'react';

const log = createScopedLogger('useWalletConnect');

const HORIZON_URLS: Record<'mainnet' | 'testnet', string> = {
  mainnet: 'https://horizon.stellar.org',
  testnet: 'https://horizon-testnet.stellar.org',
};

export interface WalletContextType {
  session: {
    address: string;
    isConnected: boolean;
    balance?: number;
  } | null;
}

export function useWalletConnect(): WalletContextType {
  const { address, isConnected } = useWallet();
  const [balance, setBalance] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!isConnected || !address) {
      setBalance(undefined);
      return;
    }

    let cancelled = false;
    const horizonUrl = HORIZON_URLS[getRuntimeConfig().network];

    fetch(`${horizonUrl}/accounts/${address}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const native = data.balances?.find(
          (b: { asset_type: string }) => b.asset_type === 'native'
        );
        setBalance(native ? parseFloat(native.balance) : 0);
      })
      .catch((error) => {
        if (cancelled) return;
        log.error('Failed to fetch wallet balance', error);
        setBalance(0);
      });

    return () => {
      cancelled = true;
    };
  }, [address, isConnected]);

  const session = useMemo(() => {
    if (isConnected && address) {
      return {
        address,
        isConnected: true,
        balance,
      };
    }
    return null;
  }, [address, isConnected, balance]);

  return { session };
}
