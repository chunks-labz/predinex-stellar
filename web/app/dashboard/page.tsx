'use client';

import dynamic from 'next/dynamic';
import Navbar from '../components/Navbar';
import AuthGuard from '../components/AuthGuard';
import { useSyncExternalStore } from 'react';
import { useUserActivity } from '../hooks/useUserActivity';
import { useActiveBets } from '../lib/hooks/useActiveBets';
import { useWallet } from '../components/WalletAdapterProvider';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { EmptyState } from '../../components/EmptyState';
import { DisconnectedState } from '../../components/DisconnectedState';

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-24 bg-card/20 animate-pulse rounded-2xl border border-border/50" />
      ))}
    </div>
  );
}

function CardSkeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-card/20 animate-pulse rounded-3xl border border-border/50 ${className}`} />;
}

const PlatformStats = dynamic(() => import('../../components/PlatformStats'), {
  loading: () => <StatsSkeleton />,
});

const PortfolioOverview = dynamic(() => import('../../components/PortfolioOverview'), {
  loading: () => <CardSkeleton className="h-32 mb-8" />,
});

const ActivityFeed = dynamic(() => import('../components/ActivityFeed'), {
  loading: () => (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-16 bg-card/20 animate-pulse rounded-2xl border border-border/50" />
      ))}
    </div>
  ),
});

const ActiveBetsCard = dynamic(() => import('../components/dashboard/ActiveBetsCard'), {
  loading: () => <div className="h-48 bg-card/20 animate-pulse rounded-xl border border-border/50" />,
});

function DashboardLoadingState() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-4xl space-y-6">
          <div className="h-12 w-72 rounded-full bg-card/20 animate-pulse" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <div
                key={index}
                className="h-24 rounded-2xl border border-border/50 bg-card/20 animate-pulse"
              />
            ))}
          </div>
          <div className="rounded-3xl border border-border/50 bg-card/20 p-8 animate-pulse space-y-4">
            <div className="h-6 w-40 rounded bg-muted/50" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="h-72 rounded-2xl bg-muted/30" />
              <div className="h-72 rounded-2xl bg-muted/30" />
            </div>
          </div>
          <div
            className="text-center text-sm text-muted-foreground"
            role="status"
            aria-label="Loading dashboard"
            aria-live="polite"
          >
            Loading dashboard...
          </div>
        </div>
      </div>
    </main>
  );
}

function DashboardReadyContent() {
  const { address: stxAddress, isConnected } = useWallet();

  const {
    activities,
    isLoading: activityLoading,
    error: activityError,
    refresh: refreshActivity,
  } = useUserActivity(stxAddress ?? undefined, 5);
  const { activeBets, isLoading: betsLoading, refresh: refreshBets } = useActiveBets(stxAddress);

  if (!isConnected) {
    return <DisconnectedState />;
  }

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <AuthGuard>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h1 className="text-4xl font-black mb-8 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Institutional Dashboard
          </h1>

          <PlatformStats />
          <PortfolioOverview />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
              <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                <div className="w-2 h-6 bg-primary rounded-full" />
                Active Bets
              </h2>
              {activeBets.length === 0 ? (
                <EmptyState message="No active bets yet" />
              ) : (
                <ActiveBetsCard
                  bets={activeBets}
                  claimTransactions={new Map()}
                  onClaim={() => {
                    refreshBets();
                  }}
                  isLoading={betsLoading}
                />
              )}
            </div>
            <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
              {activities.length === 0 ? (
                <EmptyState message="No activity yet" />
              ) : (
                <ActivityFeed
                  activities={activities}
                  isLoading={activityLoading}
                  error={activityError}
                  onRefresh={refreshActivity}
                  limit={5}
                />
              )}
            </div>
          </div>
        </div>
      </AuthGuard>
    </main>
  );
}

export function DashboardContent() {
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!isHydrated) {
    return <DashboardLoadingState />;
  }

  return <DashboardReadyContent />;
}

export default function Dashboard() {
  return (
    <RouteErrorBoundary routeName="Dashboard">
      <DashboardContent />
    </RouteErrorBoundary>
  );
}
