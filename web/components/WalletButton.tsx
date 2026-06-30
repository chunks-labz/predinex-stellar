'use client';

import { useWallet } from '@/components/WalletAdapterProvider';
import { FreighterInstallPrompt } from '@/components/wallet';
import { Wallet } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '../providers/ToastProvider';
import { formatDisplayAddress } from '../app/lib/address-display';
import { classifyConnectivityIssue, withTimeout } from '../app/lib/network-errors';
import { connectivityErrorToast, showToastPayload } from '../lib/toast-messages';

interface WalletButtonProps {
  className?: string;
  label?: string;
}

export default function WalletButton({ className, label = 'Connect Wallet' }: WalletButtonProps) {
  const { connect, disconnect, isConnected, address, isInstalled } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return (
      <button
        disabled
        className={`flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full border border-primary/20 font-medium text-sm ${className}`}
      >
        <Wallet className="w-4 h-4" />
        Loading…
      </button>
    );
  }

  if (showInstallPrompt) {
    return (
      <FreighterInstallPrompt
        onRetry={() => setShowInstallPrompt(false)}
        className={className}
      />
    );
  }

  const handleConnect = async () => {
    if (!isInstalled) {
      setShowInstallPrompt(true);
      return;
    }
    try {
      await withTimeout(connect(), 15000, 'Wallet connection timeout');
    } catch (error) {
      const issue = classifyConnectivityIssue(error);
      showToastPayload(showToast, connectivityErrorToast(issue, 'Connecting wallet'));
    }
  };

  if (isConnected) {
    return (
      <button
        onClick={disconnect}
        className={`flex items-center gap-2 bg-secondary/10 hover:bg-secondary/20 text-secondary px-4 py-2 rounded-full border border-secondary/20 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 ${className}`}
        aria-label="Disconnect wallet"
      >
        <Wallet className="w-4 h-4" />
        {address ? formatDisplayAddress(address) : 'Connected'}
      </button>
    );
  }

  return (
    <button
      onClick={handleConnect}
      className={`flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 ${className}`}
    >
      <Wallet className="w-4 h-4" />
      {label}
    </button>
  );
}
