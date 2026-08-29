'use client';

import { useI18n } from '@/app/lib/i18n';

export function DashboardHeader() {
  const { t } = useI18n();

  return (
    <div className="glass p-4 sm:p-8 rounded-2xl border border-border">
      <h1 className="text-2xl sm:text-4xl font-bold mb-2">{t('dashboard.title')}</h1>
      <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
    </div>
  );
}
