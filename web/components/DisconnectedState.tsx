'use client';

import { Wallet } from 'lucide-react';
import { useI18n } from '@/app/lib/i18n';
import { useWallet } from '@/components/WalletAdapterProvider';

export function DisconnectedState() {
  const { t } = useI18n();
  const { connect, isLoading } = useWallet();

  return (
    <div className="flex items-center justify-center py-16 px-4">
      <div className="glass max-w-md w-full p-8 rounded-xl text-center">
        <div className="p-4 bg-primary/10 rounded-full w-fit mx-auto mb-6">
          <Wallet className="w-8 h-8 text-primary" aria-hidden="true" />
        </div>
        <p className="text-lg font-semibold mb-6">{t('disconnected.walletNotConnected')}</p>
        {/* This button previously had no handler, so it did nothing. */}
        <button
          type="button"
          onClick={() => connect()}
          disabled={isLoading}
          className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {t('disconnected.connectButton')}
        </button>
      </div>
    </div>
  );
}
