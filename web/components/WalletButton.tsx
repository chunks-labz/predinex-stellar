'use client';

import { useWallet } from '@/components/WalletAdapterProvider';
import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../providers/ToastProvider';
import { formatDisplayAddress } from '../app/lib/address-display';
import {
  classifyConnectivityIssue,
  withTimeout,
} from '../app/lib/network-errors';
import { connectivityErrorToast, showToastPayload } from '../lib/toast-messages';

interface WalletButtonProps {
  className?: string;
  label?: string;
}

export default function WalletButton({ className, label = 'Connect Wallet' }: WalletButtonProps) {
  const { connect, disconnect, isConnected, address } = useWallet();
  const [mounted, setMounted] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!mounted) {
    return (
      <button 
        className={`flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm ${className}`}
        disabled
      >
        <Wallet className="w-4 h-4" />
        Loading...
      </button>
    );
  }

  const handleConnect = async () => {
    try {
      await withTimeout(Promise.resolve(connect()), 15000, 'Wallet connection timeout');
    } catch (error) {
      const issue = classifyConnectivityIssue(error);
      showToastPayload(showToast, connectivityErrorToast(issue, 'Connecting wallet'));
    }
  };

  return (
    <>
      {!isConnected ? (
        <button
          onClick={handleConnect}
          className={`flex items-center gap-2 bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-full border border-primary/20 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 ${className}`}
        >
          <Wallet className="w-4 h-4" />
          {label}
        </button>
      ) : (
        <button
          onClick={() => disconnect()}
          className={`flex items-center gap-2 bg-secondary/10 hover:bg-secondary/20 text-secondary px-4 py-2 rounded-full border border-secondary/20 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-secondary/50 ${className}`}
        >
          <Wallet className="w-4 h-4" />
          {address ? formatDisplayAddress(address) : 'Connected'}
        </button>
      )}
    </>
  );
}
