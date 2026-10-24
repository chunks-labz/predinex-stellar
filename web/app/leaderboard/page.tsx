'use client';

import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import Leaderboard from '../../components/Leaderboard';
import { useWallet } from '@/components/WalletAdapterProvider';

function LeaderboardContent() {
  const { address } = useWallet();

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Leaderboard
        </h1>
        <p className="text-muted-foreground mb-8 text-sm">
          Top 100 bettors and pool creators by volume, sourced from on-chain events.
        </p>
        <Leaderboard currentUserAddress={address} />
      </div>
    </main>
  );
}

export default function LeaderboardPage() {
  return (
    <RouteErrorBoundary routeName="Leaderboard">
      <LeaderboardContent />
    </RouteErrorBoundary>
  );
}
