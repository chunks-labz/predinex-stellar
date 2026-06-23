'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '../WalletAdapterProvider';
import { Wallet, AlertCircle } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
  redirectTo?: string;
  showConnectPrompt?: boolean;
}

export default function AuthGuard({ 
  children, 
  redirectTo = '/', 
  showConnectPrompt = true 
}: AuthGuardProps) {
  const router = useRouter();
  const { isConnected, connect, isLoading } = useWallet();

  useEffect(() => {
    if (!isLoading && !isConnected) {
      if (!showConnectPrompt) {
        router.push(redirectTo);
      }
    }
  }, [isConnected, isLoading, router, redirectTo, showConnectPrompt]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking wallet connection...</p>
        </div>
      </div>
    );
  }

  // Show connect prompt if user is not authenticated and prompt is enabled
  if (!isConnected && showConnectPrompt) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="glass p-8 rounded-xl text-center">
            <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-6">
              <Wallet className="w-8 h-8 text-primary" />
            </div>
            
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-muted-foreground mb-6">
              You need to connect your Stacks wallet to access the dashboard and view your betting statistics.
            </p>
            
            <div className="space-y-4">
              <button
                onClick={connect}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                <Wallet className="w-5 h-5" />
                Connect Wallet
              </button>
              
              <button
                onClick={() => router.push('/')}
                className="w-full px-6 py-3 border border-muted/50 rounded-lg hover:bg-muted/50 transition-colors"
              >
                Go Home
              </button>
            </div>
            
            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-left">
                  <p className="font-medium text-blue-500 mb-1">Supported Wallets</p>
                  <p className="text-muted-foreground">
                    Leather Wallet and Xverse are supported for connecting to Predinex.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Redirect if user is not authenticated and prompt is disabled
  if (!isConnected && !showConnectPrompt) {
    return null;
  }

  // Render children if user is authenticated
  return <>{children}</>;
}
