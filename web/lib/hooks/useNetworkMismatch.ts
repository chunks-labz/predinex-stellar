'use client';

import { useAppKitNetwork } from '@reown/appkit/react';
import { getRuntimeConfig } from '@/app/lib/runtime-config';
import { stellarNetworks } from '@/lib/appkit-config';
import { useCallback, useMemo } from 'react';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('useNetworkMismatch');

/**
 * Hook to detect if the connected wallet is on a different network than what the app expects.
 * Returns mismatch status, expected network details, and a function to switch to the correct network.
 */
export function useNetworkMismatch() {
  const { caipNetwork, switchNetwork } = useAppKitNetwork();
  const config = getRuntimeConfig();

  // expectedNetwork is 'mainnet' or 'testnet' from NEXT_PUBLIC_NETWORK
  const expectedNetworkType = config.network;

  // caipNetwork?.id is a CAIP-2 chain id, e.g. 'stellar:pubnet' or 'stellar:testnet'
  const currentNetworkId = caipNetwork?.id;
  const expectedNetworkId =
    expectedNetworkType === 'mainnet' ? stellarNetworks.mainnet.id : stellarNetworks.testnet.id;

  const isMismatch = useMemo(() => {
    if (!currentNetworkId) return false;
    return currentNetworkId !== expectedNetworkId;
  }, [currentNetworkId, expectedNetworkId]);

  const handleSwitchNetwork = useCallback(async () => {
    const targetNetwork =
      expectedNetworkType === 'mainnet' ? stellarNetworks.mainnet : stellarNetworks.testnet;
    try {
      await (switchNetwork as unknown as (n: typeof targetNetwork) => Promise<void>)(targetNetwork);
    } catch (error) {
      log.error('Failed to switch network', error);
      throw error;
    }
  }, [expectedNetworkType, switchNetwork]);

  return {
    isMismatch,
    expectedNetworkType,
    expectedNetworkName:
      expectedNetworkType === 'mainnet' ? stellarNetworks.mainnet.name : stellarNetworks.testnet.name,
    currentNetworkName: caipNetwork?.name || 'Unknown',
    switchNetwork: handleSwitchNetwork,
  };
}
