'use client';
import { useWallet } from '../../app/components/WalletAdapterProvider';
import { useQuery } from '@tanstack/react-query';
import { getRuntimeConfig } from '../../app/lib/runtime-config';
import { createScopedLogger } from '../../app/lib/logger';

const log = createScopedLogger('useWalletAccount');

interface WalletAccountData {
  address: string | null;
  balance: string;
  isConnected: boolean;
}

/**
 * Hook to fetch wallet account data including balance.
 * Works with Stellar/Soroban wallets.
 */
export function useWalletAccount(): WalletAccountData {
  const { address, isConnected } = useWallet();
  const cfg = getRuntimeConfig();

  const { data: balance } = useQuery({
    queryKey: ['wallet-balance', address],
    queryFn: async () => {
      if (!address) return '0';

      // Use Stellar Horizon API for balance
      const horizonUrl = cfg.network === 'testnet'
        ? 'https://horizon-testnet.stellar.org'
        : 'https://horizon.stellar.org';

      try {
        const response = await fetch(`${horizonUrl}/accounts/${address}`);
        if (!response.ok) {
          log.error(`Failed to fetch balance: ${response.statusText}`);
          return '0';
        }
        const data = await response.json();
        // Find native XLM balance
        const nativeBalance = data.balances?.find(
          (b: { asset_type: string }) => b.asset_type === 'native'
        );
        return nativeBalance ? (parseFloat(nativeBalance.balance)).toFixed(7) : '0';
      } catch (error) {
        log.error('Error fetching balance', error);
        return '0';
      }
    },
    enabled: isConnected && !!address,
  });

  return {
    address,
    balance: balance || '0',
    isConnected,
  };
}

/**
 * @deprecated Use useWalletAccount instead. Maintained for backward compatibility.
 */
export function useStacksAccount() {
  return useWalletAccount();
}
