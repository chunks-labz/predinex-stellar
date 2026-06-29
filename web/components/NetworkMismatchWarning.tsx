'use client';

import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { useAppKitAccount } from '@reown/appkit/react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('NetworkMismatchWarning');

/**
 * A warning banner that appears when the connected wallet is on the wrong network.
 * Provides a button to switch to the supported network.
 */
export function NetworkMismatchWarning() {
  const { isConnected } = useAppKitAccount();
  const { isMismatch, expectedNetworkName, currentNetworkName, switchNetwork } = useNetworkMismatch();
  const [isSwitching, setIsSwitching] = useState(false);

  // Only show if connected and there's a mismatch
  if (!isConnected || !isMismatch) {
    return null;
  }

  const handleSwitch = async () => {
    setIsSwitching(true);
    try {
      await switchNetwork();
    } catch (error) {
      log.error('Failed to switch network', error);
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/20 py-2 px-4 animate-in slide-in-from-top duration-300">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">
            Network Mismatch: Your wallet is on <span className="font-bold">{currentNetworkName}</span>, 
            but this app requires <span className="font-bold">{expectedNetworkName}</span>.
          </p>
        </div>
        <button
          onClick={handleSwitch}
          disabled={isSwitching}
          className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
        >
          {isSwitching ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Switch to {expectedNetworkName}
        </button>
      </div>
    </div>
  );
}
