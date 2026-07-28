'use client';

import { BarChart3, Wallet, Award } from 'lucide-react';
import type { DashboardStats } from '@/app/lib/user-dashboard/types';
import { formatStxAmount } from '@/app/lib/user-dashboard/model';
import { useI18n } from '@/app/lib/i18n';

interface DashboardStatsSectionsProps {
  stats: DashboardStats;
  isLoading?: boolean;
}

function StatCardSkeleton() {
  return (
    <div className="glass p-6 rounded-xl border border-border animate-pulse">
      <div className="h-4 w-24 bg-muted/40 rounded mb-3" />
      <div className="h-8 w-20 bg-muted/50 rounded" />
    </div>
  );
}

export function DashboardStatsSections({ stats, isLoading = false }: DashboardStatsSectionsProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="animate-fade-in" role="status" aria-busy="true">
        <span className="sr-only">Loading dashboard stats…</span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <StatCardSkeleton key={`top-${i}`} />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <StatCardSkeleton key={`bottom-${i}`} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.totalBets')}</p>
              <p className="text-3xl font-bold">{stats.totalBets}</p>
            </div>
            <BarChart3 className="w-8 h-8 text-primary opacity-50" />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.totalWagered')}</p>
              <p className="text-3xl font-bold">{formatStxAmount(stats.totalWagered)} STX</p>
            </div>
            <Wallet className="w-8 h-8 text-blue-500 opacity-50" />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.totalWinnings')}</p>
              <p className="text-3xl font-bold text-green-400">{formatStxAmount(stats.totalWinnings)} STX</p>
            </div>
            <Award className="w-8 h-8 text-green-500 opacity-50" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass p-6 rounded-xl border border-border">
          <p className="text-sm text-muted-foreground mb-2">{t('dashboard.winRate')}</p>
          <p className="text-3xl font-bold">{stats.winRate}%</p>
          <div className="mt-4 w-full bg-muted/50 rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${stats.winRate}%` }}
            />
          </div>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <p className="text-sm text-muted-foreground mb-2">{t('dashboard.activeBetsCount')}</p>
          <p className="text-3xl font-bold text-blue-400">{stats.activeBets}</p>
        </div>

        <div className="glass p-6 rounded-xl border border-border">
          <p className="text-sm text-muted-foreground mb-2">{t('dashboard.settledBetsCount')}</p>
          <p className="text-3xl font-bold text-green-400">{stats.settledBets}</p>
        </div>
      </div>
    </>
  );
}
