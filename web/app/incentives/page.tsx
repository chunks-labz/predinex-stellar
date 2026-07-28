'use client';

import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import IncentivesDisplay from "../components/IncentivesDisplay";
import { useWallet } from '@/components/WalletAdapterProvider';
import { useWalletConnect } from "../lib/hooks/useWalletConnect";

export default function IncentivesPage() {
  const { address } = useWallet();
  const { session } = useWalletConnect();

  const userAddress = session?.address || address || undefined;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <RouteErrorBoundary routeName="Incentives">
      <AuthGuard>
        <div className="pt-32 pb-20 max-w-4xl mx-auto px-4 sm:px-6">
          <div className="glass p-8 rounded-2xl border border-border mb-8">
            <h1 className="text-4xl font-bold mb-2">Liquidity Incentives</h1>
            <p className="text-muted-foreground">Earn bonuses for early betting and consistent participation</p>
          </div>

          <IncentivesDisplay betterId={userAddress} />
        </div>
      </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
