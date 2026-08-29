'use client';

import { useI18n } from '@/app/lib/i18n';

export function DisconnectedState() {
  const { t } = useI18n();
  return (
    <div>
      <p>{t('disconnected.walletNotConnected')}</p>
      <button>{t('disconnected.connectButton')}</button>
    </div>
  );
}
