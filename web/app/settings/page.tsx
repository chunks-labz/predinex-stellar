'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import Navbar from '@/components/Navbar';
import { useWallet } from '@/components/WalletAdapterProvider';
import { getMarkets, getUserActivity, type Pool, type ActivityItem } from '../lib/stacks-api';
import { useI18n, supportedLanguages, type AppLanguage } from '../lib/i18n';
import { useBrowserNotifications } from '../lib/notifications';
import { useNotificationPreferences } from '../lib/hooks/useNotificationPreferences';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { exportRecords } from '../lib/export';
import { Bell, Download, Languages, LoaderCircle, FileDown, Globe2, ChevronRight } from 'lucide-react';

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card/40 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: ElementType;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <section className="glass rounded-2xl border border-border p-6 space-y-5">
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { address, isConnected } = useWallet();
  const { language, setLanguage, t } = useI18n();
  const { preferences } = useNotificationPreferences();
  const notifications = useBrowserNotifications({ userId: address, preferences });
  const [pools, setPools] = useState<Pool[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadExportData() {
      setIsLoadingData(true);

      try {
        const [marketData, activityData] = await Promise.all([
          getMarkets('all'),
          address ? getUserActivity(address, 25) : Promise.resolve([]),
        ]);

        if (!active) return;
        setPools(marketData);
        setActivity(activityData);
      } finally {
        if (active) {
          setIsLoadingData(false);
        }
      }
    }

    void loadExportData();

    return () => {
      active = false;
    };
  }, [address]);

  const poolExportRows = useMemo(
    () =>
      pools.map((pool) => ({
        poolId: pool.id,
        title: pool.title,
        status: pool.status,
        totalA: pool.totalA,
        totalB: pool.totalB,
        totalVolume: pool.totalA + pool.totalB,
        creator: pool.creator,
        expiry: pool.expiry,
      })),
    [pools],
  );

  const activityExportRows = useMemo(
    () =>
      activity.map((item) => ({
        txId: item.txId,
        type: item.type,
        functionName: item.functionName,
        status: item.status,
        timestamp: new Date(item.timestamp * 1000).toISOString(),
        poolId: item.poolId ?? '',
        poolTitle: item.poolTitle ?? '',
        amount: item.amount ?? '',
      })),
    [activity],
  );

  const handleExport = async (kind: 'pools-csv' | 'pools-json' | 'activity-csv' | 'activity-json') => {
    setIsExporting(kind);
    try {
      switch (kind) {
        case 'pools-csv':
          exportRecords(poolExportRows, 'predinex-pools', 'csv');
          break;
        case 'pools-json':
          exportRecords(poolExportRows, 'predinex-pools', 'json');
          break;
        case 'activity-csv':
          exportRecords(activityExportRows, 'predinex-activity', 'csv');
          break;
        case 'activity-json':
          exportRecords(activityExportRows, 'predinex-activity', 'json');
          break;
      }
    } finally {
      setIsExporting(null);
    }
  };

  const requestNotifications = async () => {
    const permission = await notifications.requestPermission();
    if (permission === 'granted') {
      notifications.sendTestNotification();
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <RouteErrorBoundary routeName="Settings">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Globe2 className="h-4 w-4" />
            {t('settings.title')}
          </div>
          <h1 className="text-4xl font-black tracking-tight">{t('settings.title')}</h1>
          <p className="max-w-2xl text-muted-foreground">{t('settings.subtitle')}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <SettingsCard icon={Languages} title={t('settings.language')} body={t('settings.languageBody')}>
            <div className="space-y-4">
              <label className="block text-sm font-medium text-muted-foreground" htmlFor="language">
                {t('settings.language')}
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm"
              >
                {supportedLanguages.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </SettingsCard>

          <SettingsCard icon={Bell} title={t('settings.notifications')} body={t('settings.notificationsBody')}>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3">
                <div>
                  <p className="font-medium">
                    {notifications.enabled ? t('settings.notificationsOn') : t('settings.notificationsOff')}
                  </p>
                  <p className="text-xs text-muted-foreground">{notifications.permission}</p>
                  {notifications.error && <p className="text-xs text-red-400">{notifications.error}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => notifications.setEnabled(!notifications.enabled)}
                  disabled={notifications.permission === 'denied' || notifications.supportStatus === 'unsupported'}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    notifications.enabled ? 'bg-green-500/15 text-green-400' : 'bg-muted/50 text-muted-foreground'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {notifications.enabled ? 'On' : 'Off'}
                </button>
              </div>

              <Link
                href="/settings/notifications"
                className="flex items-center justify-between rounded-xl border border-border bg-card/40 px-4 py-3 transition-colors hover:bg-card"
              >
                <span className="font-medium text-foreground">Notification Preferences</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void requestNotifications()}
                  disabled={notifications.permission === 'denied' || notifications.supportStatus === 'unsupported'}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('settings.requestPermission')}
                </button>
                <button
                  type="button"
                  onClick={() => void notifications.sendTestNotification()}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 font-semibold transition-colors hover:bg-card"
                >
                  <Bell className="h-4 w-4" />
                  {t('settings.testNotification')}
                </button>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard icon={Download} title={t('settings.exportTitle')} body={t('settings.exportBody')}>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isLoadingData || isExporting !== null}
                onClick={() => void handleExport('pools-csv')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting === 'pools-csv' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {t('settings.exportPoolsCsv')}
              </button>
              <button
                type="button"
                disabled={isLoadingData || isExporting !== null}
                onClick={() => void handleExport('pools-json')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting === 'pools-json' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {t('settings.exportPoolsJson')}
              </button>
              <button
                type="button"
                disabled={!isConnected || isLoadingData || isExporting !== null}
                onClick={() => void handleExport('activity-csv')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting === 'activity-csv' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {t('settings.exportActivityCsv')}
              </button>
              <button
                type="button"
                disabled={!isConnected || isLoadingData || isExporting !== null}
                onClick={() => void handleExport('activity-json')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card/40 px-4 py-3 text-sm font-semibold transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting === 'activity-json' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                {t('settings.exportActivityJson')}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatPill label="Markets" value={pools.length} />
              <StatPill label="Activity" value={activity.length} />
              <StatPill label="Wallet" value={isConnected ? 'Connected' : 'Disconnected'} />
              <StatPill label="Data" value={isLoadingData ? t('settings.loadingData') : 'Ready'} />
            </div>

            {!isConnected && <p className="text-sm text-muted-foreground">{t('settings.noWallet')}</p>}
          </SettingsCard>
        </div>
      </div>
      </RouteErrorBoundary>
    </main>
  );
}
