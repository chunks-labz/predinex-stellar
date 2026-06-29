'use client';

import { Gift } from 'lucide-react';
import type { DashboardTabId } from '@/app/lib/user-dashboard/types';
import { useI18n } from '@/app/lib/i18n';

interface DashboardTabBarProps {
  activeTab: DashboardTabId;
  onTabChange: (tab: DashboardTabId) => void;
}

export function DashboardTabBar({ activeTab, onTabChange }: DashboardTabBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex gap-4 border-b border-border overflow-x-auto">
      <button
        type="button"
        onClick={() => onTabChange('overview')}
        className={`px-4 py-2 font-bold transition-all whitespace-nowrap ${
          activeTab === 'overview'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('dashboard.overview')}
      </button>
      <button
        type="button"
        onClick={() => onTabChange('bets')}
        className={`px-4 py-2 font-bold transition-all whitespace-nowrap ${
          activeTab === 'bets'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('dashboard.activeBets')}
      </button>
      <button
        type="button"
        onClick={() => onTabChange('history')}
        className={`px-4 py-2 font-bold transition-all whitespace-nowrap ${
          activeTab === 'history'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('dashboard.history')}
      </button>
      <button
        type="button"
        onClick={() => onTabChange('incentives')}
        className={`px-4 py-2 font-bold transition-all whitespace-nowrap flex items-center gap-2 ${
          activeTab === 'incentives'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Gift className="w-4 h-4" />
        {t('dashboard.incentives')}
      </button>
    </div>
  );
}
