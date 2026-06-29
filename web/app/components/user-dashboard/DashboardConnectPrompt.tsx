'use client';

import { Wallet } from 'lucide-react';
import { useI18n } from '@/app/lib/i18n';

export function DashboardConnectPrompt() {
  const { t } = useI18n();

  return (
    <div className="glass p-8 rounded-2xl border border-border text-center">
      <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
      <p className="text-lg font-bold mb-2">{t('dashboard.connectPromptTitle')}</p>
      <p className="text-muted-foreground">{t('dashboard.connectPromptBody')}</p>
    </div>
  );
}
