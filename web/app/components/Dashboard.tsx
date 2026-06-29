'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useWalletConnect } from '../lib/hooks/useWalletConnect';
import { useUserDashboard } from '../lib/user-dashboard/useUserDashboard';
import type { DashboardTabId } from '../lib/user-dashboard/types';
import { useI18n } from '../lib/i18n';
import { DashboardConnectPrompt } from './user-dashboard/DashboardConnectPrompt';
import { DashboardHeader } from './user-dashboard/DashboardHeader';
import { DashboardStatsSections } from './user-dashboard/DashboardStatsSections';
import { DashboardTabBar } from './user-dashboard/DashboardTabBar';
import { DashboardOverviewPanel } from './user-dashboard/DashboardBetPanels';
import StaleDataIndicator from '@/components/StaleDataIndicator';

function PanelSkeleton() {
  return <div className="h-40 bg-card/20 animate-pulse rounded-xl border border-border" />;
}

const DashboardActiveBetsPanel = dynamic(
  () => import('./user-dashboard/DashboardBetPanels').then((m) => ({ default: m.DashboardActiveBetsPanel })),
  { loading: () => <PanelSkeleton /> },
);

const DashboardHistoryPanel = dynamic(
  () => import('./user-dashboard/DashboardBetPanels').then((m) => ({ default: m.DashboardHistoryPanel })),
  { loading: () => <PanelSkeleton /> },
);

const IncentivesDisplay = dynamic(() => import('./IncentivesDisplay'), {
  loading: () => <PanelSkeleton />,
});

export default function Dashboard() {
  const { isConnected, address } = useWallet();
  const { session } = useWalletConnect();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');

  const sessionConnected = !!session?.isConnected;
  const { stats, bets, isLoading, fetchUserData } = useUserDashboard(isConnected, sessionConnected, address || session?.address);

  if (!sessionConnected && !isConnected) {
    return <DashboardConnectPrompt />;
  }

  return (
    <div className="space-y-8">
      <DashboardHeader />
      <DashboardStatsSections stats={stats} />
      <DashboardTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'overview' && <DashboardOverviewPanel bets={bets} isLoading={isLoading} />}
      {activeTab === 'bets' && <DashboardActiveBetsPanel bets={bets} isLoading={isLoading} />}
      {activeTab === 'history' && <DashboardHistoryPanel bets={bets} isLoading={isLoading} />}
      {activeTab === 'incentives' && <IncentivesDisplay betterId={address || session?.address} />}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void fetchUserData()}
          disabled={isLoading}
          className="flex-1 py-3 bg-primary/10 hover:bg-primary/20 text-primary font-bold rounded-xl transition-all disabled:opacity-50"
        >
          {isLoading ? t('dashboard.refreshing') : t('dashboard.refresh')}
        </button>
      </div>

      <div className="flex justify-center">
        <StaleDataIndicator
          lastFetchedAt={stats.lastUpdated}
          isRefreshing={isLoading}
          onRefresh={() => void fetchUserData()}
        />
      </div>
    </div>
  );
}
