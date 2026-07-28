'use client';

import dynamic from 'next/dynamic';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import { useUserActivity } from '../hooks/useUserActivity';
import { useActiveBets } from '../lib/hooks/useActiveBets';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useClaimWinnings } from '../lib/hooks/useClaimWinnings';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { EmptyState } from '../../components/EmptyState';
import { DisconnectedState } from '../../components/DisconnectedState';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import ExportButton from '../../components/ExportButton';

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

const PortfolioOverview = dynamic(() => import('@/components/PortfolioOverview'), {
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

const FavoritePoolsCard = dynamic(() => import('../components/dashboard/FavoritePoolsCard'), {
  loading: () => <div className="h-48 bg-card/20 animate-pulse rounded-xl border border-border/50" />,
});

function DashboardContent() {
  const { address: stxAddress, isConnected } = useWallet();
  const { claimTransactions, claim, feePrompt, setFeePrompt, stage, setStage } = useClaimWinnings(stxAddress);
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
          <TransactionFeeModal
            isOpen={!!feePrompt}
            actionName="Claim Winnings"
            feeStroops={feePrompt?.feeStroops || '0'}
            onConfirm={() => {
                feePrompt?.resolve(true);
                setFeePrompt(null);
            }}
            onCancel={() => {
                feePrompt?.resolve(false);
                setFeePrompt(null);
                setStage('idle');
            }}
            isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
          />

          <h1 className="text-2xl sm:text-4xl font-black mb-8 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Institutional Dashboard
          </h1>

          {stxAddress && (
            <div className="mb-8">
              <ExportButton address={stxAddress} />
            </div>
          )}

          <PlatformStats />
          <PortfolioOverview portfolio={{ totalBets: 0, activeBets: 0, totalWagered: 0, totalWinnings: 0, totalClaimable: 0, profitLoss: 0, winRate: 0 }} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="p-4 sm:p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
              <FavoritePoolsCard />
              <div className="mt-8">
              <h2 className="text-2xl font-black mb-6 flex items-center gap-3">
                <div className="w-2 h-6 bg-primary rounded-full" />
                Active Bets
              </h2>
              {activeBets.length === 0 ? (
                <EmptyState message="No active bets yet" />
              ) : (
                <ActiveBetsCard
                  bets={activeBets}
                  claimTransactions={claimTransactions}
                  onClaim={(poolId) => {
                    void claim(poolId, () => {
                      refreshActivity();
                      refreshBets();
                    }).catch(() => {
                      // useClaimWinnings already records the failure state and toast.
                    });
                  }}
                  userAddress={stxAddress}
                  onClaimAllSuccess={() => {
                    refreshActivity();
                    refreshBets();
                  }}
                  isLoading={betsLoading}
                />
              )}
              </div>
            </div>
            <div className="p-4 sm:p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
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

export default function Dashboard() {
  return (
    <RouteErrorBoundary routeName="Dashboard">
      <DashboardContent />
    </RouteErrorBoundary>
  );
}
