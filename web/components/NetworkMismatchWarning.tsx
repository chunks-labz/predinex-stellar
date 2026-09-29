'use client';

import { useWallet } from '@/components/WalletAdapterProvider';
import { useNetworkMismatch } from '@/lib/hooks/useNetworkMismatch';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('NetworkMismatchWarning');

/**
 * How the warning is laid out.
 *
 * - `banner` — full-width strip for the top of the page (the navbar renders this).
 * - `inline`  — card-sized block for panels that need the warning in context,
 *               such as the betting section.
 *
 * Both variants say the same thing and offer the same switch action; only the
 * surrounding layout differs. There is one warning for a wrong-network wallet,
 * so it lives in one component.
 */
export type NetworkMismatchWarningVariant = 'banner' | 'inline';

export function NetworkMismatchWarning({
  variant = 'banner',
  message,
}: {
  variant?: NetworkMismatchWarningVariant;
  /**
   * Replaces the default English copy. Lets a caller localise the wording
   * without re-implementing the layout or the switch action.
   */
  message?: ReactNode;
} = {}) {
  const { isConnected } = useWallet();
  const { isMismatch, expectedNetworkName, currentNetworkName, switchNetwork } = useNetworkMismatch();
  const [isSwitching, setIsSwitching] = useState(false);

  if (!isConnected || !isMismatch) return null;

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

  const text =
    message ?? (
      <>
        Network Mismatch: Your wallet is on{' '}
        <span className="font-bold">{currentNetworkName}</span>, but this app requires{' '}
        <span className="font-bold">{expectedNetworkName}</span>.
      </>
    );

  const switchButton = (
    <button
      onClick={handleSwitch}
      disabled={isSwitching}
      className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-1.5 rounded-full text-xs font-bold transition-all disabled:opacity-50 shadow-sm whitespace-nowrap"
    >
      <RefreshCw className={`w-3 h-3 ${isSwitching ? 'animate-spin' : ''}`} />
      Switch to {expectedNetworkName}
    </button>
  );

  if (variant === 'inline') {
    return (
      <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{text}</p>
        </div>
        {switchButton}
      </div>
    );
  }

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/20 py-2 px-4 animate-in slide-in-from-top duration-300">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-500">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{text}</p>
        </div>
        {switchButton}
      </div>
    </div>
  );
}
