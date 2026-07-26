'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getRuntimeConfig } from '@/app/lib/runtime-config';

const EXPECTED_NETWORK_LABELS: Record<string, string> = {
  mainnet: 'Stellar Mainnet',
  testnet: 'Stellar Testnet',
};

const FREIGHTER_TO_APP_NETWORK: Record<string, string> = {
  MAINNET: 'mainnet',
  PUBNET: 'mainnet',
  TESTNET: 'testnet',
  FUTURENET: 'futurenet',
};

/**
 * Detects a network mismatch between the connected Freighter wallet and the
 * expected app network (NEXT_PUBLIC_NETWORK). Uses Freighter's getNetwork()
 * directly instead of AppKit so no AppKit provider is required.
 */
export function useNetworkMismatch() {
  const { isConnected } = useWallet();
  const [currentNetworkName, setCurrentNetworkName] = useState<string>('');
  const [isMismatch, setIsMismatch] = useState(false);

  const config = getRuntimeConfig();
  const expectedNetworkType = config.network as string; // 'mainnet' | 'testnet'
  const expectedNetworkName = EXPECTED_NETWORK_LABELS[expectedNetworkType] ?? expectedNetworkType;

  const checkNetwork = useCallback(async () => {
    if (!isConnected || typeof window === 'undefined') {
      setIsMismatch(false);
      setCurrentNetworkName('');
      return;
    }

    const freighter = (window as unknown as { freighter?: { getNetwork: () => Promise<{ network: string }> } }).freighter;
    if (!freighter) return;

    try {
      const { network } = await freighter.getNetwork();
      const normalised = FREIGHTER_TO_APP_NETWORK[network.toUpperCase()] ?? network.toLowerCase();
      setCurrentNetworkName(EXPECTED_NETWORK_LABELS[normalised] ?? network);
      setIsMismatch(normalised !== expectedNetworkType);
    } catch {
      // If getNetwork fails, don't block the UI
    }
  }, [isConnected, expectedNetworkType]);

  useEffect(() => {
    checkNetwork();
  }, [checkNetwork]);

  /**
   * Freighter doesn't expose a programmatic network-switch API.
   * Open the extension popup so the user can switch manually.
   */
  const switchNetwork = useCallback(async () => {
    window.open('https://www.freighter.app/', '_blank', 'noopener');
  }, []);

  return {
    isMismatch,
    expectedNetworkType,
    expectedNetworkName,
    currentNetworkName,
    switchNetwork,
  };
}
