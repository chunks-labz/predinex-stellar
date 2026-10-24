'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useWalletConnect } from '@/app/lib/hooks/useWalletConnect';
import { useNotificationPreferences } from '@/app/lib/hooks/useNotificationPreferences';
import {
  markPushPermissionPromptShown,
  shouldShowFirstVisitPushPrompt,
  useBrowserNotifications,
} from '@/app/lib/notifications';

export default function PushNotificationPrompt() {
  const { session } = useWalletConnect();
  const { preferences } = useNotificationPreferences();
  const notifications = useBrowserNotifications({ userId: session?.address, preferences });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(shouldShowFirstVisitPushPrompt());
  }, []);

  if (!visible || notifications.permission !== 'default') {
    return null;
  }

  const dismiss = () => {
    markPushPermissionPromptShown();
    setVisible(false);
  };

  const enable = async () => {
    await notifications.requestPermission();
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-2xl border border-border bg-background/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:right-4">
      <div className="flex gap-3">
        <div className="mt-1 rounded-xl bg-primary/10 p-2 text-primary">
          <Bell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-foreground">Stay updated on Predinex</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enable push alerts for pool settlements, 24h expiry reminders, claim availability, and disputes.
          </p>
          {notifications.error && <p className="mt-2 text-sm text-red-400">{notifications.error}</p>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void enable()}
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Enable notifications
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex items-center justify-center rounded-xl border border-border bg-card/40 px-4 py-2 text-sm font-semibold transition-colors hover:bg-card"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="h-9 w-9 rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss notification prompt"
        >
          <X className="mx-auto h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
