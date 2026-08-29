'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronLeft, LoaderCircle, RotateCcw } from 'lucide-react';
import Navbar from '@/components/Navbar';
import { useWalletConnect } from '../../lib/hooks/useWalletConnect';
import { useNotificationPreferences } from '../../lib/hooks/useNotificationPreferences';
import { useBrowserNotifications, updatePushPreferences } from '../../lib/notifications';

function NotificationToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card/40 hover:bg-card/60 transition-colors">
      <div className="flex-1">
        <h3 className="font-medium text-foreground">{label}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`ml-4 relative inline-flex h-8 w-14 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? 'bg-green-500/20 border border-green-500/30' : 'bg-muted/50 border border-border'
        }`}
      >
        <span
          className={`inline-block h-6 w-6 transform rounded-full bg-foreground transition-transform ${
            checked ? 'translate-x-7' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

export default function NotificationPreferencesPage() {
  const { preferences, togglePreference, resetToDefaults, allEnabled, allDisabled } =
    useNotificationPreferences();
  const { session } = useWalletConnect();
  const notifications = useBrowserNotifications({ userId: session?.address, preferences });
  const [resetConfirm, setResetConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleReset = () => {
    if (resetConfirm) {
      resetToDefaults();
      setResetConfirm(false);
    } else {
      setResetConfirm(true);
      setTimeout(() => setResetConfirm(false), 3000);
    }
  };

  const handleToggle = async (key: keyof typeof preferences) => {
    const nextPreferences = { ...preferences, [key]: !preferences[key] };
    togglePreference(key);

    if (!session?.address || notifications.permission !== 'granted') return;

    setSaveStatus('saving');
    try {
      await updatePushPreferences(session.address, nextPreferences);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  };

  const enablePush = async () => {
    const permission = await notifications.requestPermission();
    if (permission === 'granted') {
      await notifications.syncSubscription();
    }
  };

  const disabledByPermission = notifications.permission === 'denied' || notifications.supportStatus === 'unsupported';
  const statusLabel =
    notifications.supportStatus === 'unsupported'
      ? 'Push notifications are not supported in this browser.'
      : notifications.permission === 'denied'
        ? 'Notification permission is blocked. Update your browser site settings to enable push alerts.'
        : notifications.permission === 'granted'
          ? session?.address
            ? 'Push notifications are enabled for this wallet.'
            : 'Connect a wallet to save this browser subscription on the server.'
          : 'Enable push notifications to receive alerts when this tab is closed.';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="mx-auto max-w-3xl px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/settings"
            className="p-2 hover:bg-muted/50 rounded-lg transition-colors"
            aria-label="Back to settings"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-medium text-primary mb-2">
              <Bell className="h-4 w-4" />
              Notification Preferences
            </div>
            <h1 className="text-3xl font-black tracking-tight">Notification Settings</h1>
            <p className="mt-2 text-muted-foreground">
              Customize which notifications you receive about market events.
            </p>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-border bg-card/30 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">Push permission: {notifications.permission}</p>
              <p className="mt-1 text-sm text-muted-foreground">{statusLabel}</p>
              {notifications.error && <p className="mt-2 text-sm text-red-400">{notifications.error}</p>}
              {saveStatus === 'saved' && <p className="mt-2 text-sm text-green-400">Preferences saved.</p>}
              {saveStatus === 'error' && (
                <p className="mt-2 text-sm text-red-400">Could not save preferences. Try again shortly.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void enablePush()}
              disabled={disabledByPermission || notifications.isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {notifications.isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Enable push
            </button>
          </div>
        </div>

        {/* Preferences Grid */}
        <div className="space-y-4 mb-8">
          <NotificationToggle
            label="Pool Settled"
            description="Receive alerts when prediction pools you've participated in reach settlement."
            checked={preferences.poolSettled}
            onChange={() => void handleToggle('poolSettled')}
          />
          <NotificationToggle
            label="Dispute Filed"
            description="Get notified when disputes are filed against pools you're involved in."
            checked={preferences.disputeFiled}
            onChange={() => void handleToggle('disputeFiled')}
          />
          <NotificationToggle
            label="Claim Available"
            description="Be notified when you have winnings available to claim."
            checked={preferences.claimAvailable}
            onChange={() => void handleToggle('claimAvailable')}
          />
          <NotificationToggle
            label="Pool Expiring, 24h before expiry"
            description="Receive reminders 24 hours before pools you follow are scheduled to expire."
            checked={preferences.poolExpiring24h}
            onChange={() => void handleToggle('poolExpiring24h')}
          />
        </div>

        {/* Summary */}
        <div className="mb-8 p-4 rounded-xl border border-border bg-card/30">
          <p className="text-sm text-muted-foreground">
            {allEnabled
              ? 'All notification types are enabled.'
              : allDisabled
                ? 'All notification types are disabled.'
                : `${Object.values(preferences).filter(Boolean).length} of 4 notification types enabled.`}
          </p>
        </div>

        {/* Reset Button */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReset}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 font-semibold transition-colors ${
              resetConfirm
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                : 'bg-muted/50 text-muted-foreground border border-border hover:bg-muted'
            }`}
          >
            <RotateCcw className="h-4 w-4" />
            {resetConfirm ? 'Click again to confirm reset' : 'Reset to defaults'}
          </button>
          <Link
            href="/settings"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card/40 px-4 py-3 font-semibold transition-colors hover:bg-card"
          >
            Back
          </Link>
        </div>
      </div>
    </main>
  );
}
