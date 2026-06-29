'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type WebPushSubscriptionPayload,
} from './push-notification-types';

const STORAGE_KEY = 'predinex_push_notifications_v1';
const PROMPT_SHOWN_KEY = 'predinex_push_permission_prompt_shown_v1';
const DEFAULT_ICON = '/icons/icon-192.png';

export type BrowserNotificationPermission = 'default' | 'granted' | 'denied';
export type PushSupportStatus = 'supported' | 'unsupported';

export interface BrowserNotificationOptions {
  body?: string;
  tag?: string;
  icon?: string;
}

interface UseBrowserNotificationsOptions {
  userId?: string | null;
  preferences?: NotificationPreferences;
}

function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    isNotificationSupported() &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function getPermission(): BrowserNotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return window.Notification.permission as BrowserNotificationPermission;
}

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
}

export function hasShownPushPermissionPrompt(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(PROMPT_SHOWN_KEY) === 'true';
}

export function markPushPermissionPromptShown(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROMPT_SHOWN_KEY, 'true');
}

export function shouldShowFirstVisitPushPrompt(): boolean {
  return isWebPushSupported() && getPermission() === 'default' && !hasShownPushPermissionPrompt();
}

export function isBrowserNotificationEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setBrowserNotificationEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function normalizePushSubscription(subscription: PushSubscription): WebPushSubscriptionPayload {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!isWebPushSupported()) {
    throw new Error('Web push is not supported in this browser.');
  }

  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
}

export async function subscribeToPredinexPush({
  userId,
  preferences = DEFAULT_NOTIFICATION_PREFERENCES,
}: {
  userId: string;
  preferences?: NotificationPreferences;
}): Promise<WebPushSubscriptionPayload> {
  const vapidPublicKey = getVapidPublicKey();
  if (!vapidPublicKey) {
    throw new Error('Push notifications are not configured for this deployment.');
  }

  const registration = await ensureServiceWorkerRegistration();
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
    }));

  const payload = normalizePushSubscription(subscription);
  await savePushSubscription({ userId, subscription: payload, preferences });
  return payload;
}

export async function savePushSubscription({
  userId,
  subscription,
  preferences,
}: {
  userId: string;
  subscription: WebPushSubscriptionPayload;
  preferences: NotificationPreferences;
}): Promise<void> {
  const response = await fetch('/api/push-subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-predinex-wallet-address': userId,
    },
    body: JSON.stringify({ userId, subscription, preferences }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save push subscription (${response.status}).`);
  }
}

export async function updatePushPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
  const registration = isWebPushSupported() ? await navigator.serviceWorker.getRegistration('/') : undefined;
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await savePushSubscription({
    userId,
    subscription: normalizePushSubscription(subscription),
    preferences,
  });
}

export async function unsubscribeFromPredinexPush(userId?: string | null): Promise<void> {
  if (isWebPushSupported()) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }

  if (!userId) return;

  await fetch('/api/push-subscriptions', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-predinex-wallet-address': userId,
    },
    body: JSON.stringify({ userId }),
  }).catch(() => undefined);
}

export function notifyBrowserEvent(title: string, options: BrowserNotificationOptions = {}): boolean {
  if (!isNotificationSupported() || !isBrowserNotificationEnabled() || getPermission() !== 'granted') {
    return false;
  }

  new window.Notification(title, { icon: DEFAULT_ICON, ...options });
  return true;
}

export function useBrowserNotifications(options: UseBrowserNotificationsOptions = {}) {
  const { userId, preferences = DEFAULT_NOTIFICATION_PREFERENCES } = options;
  const [enabled, setEnabledState, clearEnabled] = useLocalStorage<boolean>(STORAGE_KEY, false);
  const [permission, setPermission] = useState<BrowserNotificationPermission>('default');
  const [supportStatus, setSupportStatus] = useState<PushSupportStatus>('unsupported');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPermission(getPermission());
    setSupportStatus(isWebPushSupported() ? 'supported' : 'unsupported');
  }, []);

  const syncSubscription = useCallback(async () => {
    if (!userId || !enabled || getPermission() !== 'granted') return;

    setIsSaving(true);
    setError(null);
    try {
      await subscribeToPredinexPush({ userId, preferences });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save push subscription.');
    } finally {
      setIsSaving(false);
    }
  }, [enabled, preferences, userId]);

  useEffect(() => {
    void syncSubscription();
  }, [syncSubscription]);

  const requestPermission = useCallback(async () => {
    markPushPermissionPromptShown();

    if (!isNotificationSupported()) {
      setPermission('denied');
      setSupportStatus('unsupported');
      return 'denied' as const;
    }

    const nextPermission = (await window.Notification.requestPermission()) as BrowserNotificationPermission;
    setPermission(nextPermission);
    if (nextPermission === 'granted') {
      setEnabledState(true);
    }
    return nextPermission;
  }, [setEnabledState]);

  const disable = useCallback(() => {
    clearEnabled();
    setPermission(getPermission());
    void unsubscribeFromPredinexPush(userId);
  }, [clearEnabled, userId]);

  const sendTestNotification = useCallback(async () => {
    const nextPermission = permission === 'granted' ? permission : await requestPermission();
    if (nextPermission === 'granted') {
      notifyBrowserEvent('Predinex alerts are enabled', {
        body: 'You will receive browser notifications for important market events.',
        tag: 'predinex-test-notification',
      });
    }
  }, [permission, requestPermission]);

  return useMemo(
    () => ({
      enabled,
      permission,
      supportStatus,
      isSaving,
      error,
      setEnabled: (nextEnabled: boolean) => {
        if (!nextEnabled) {
          disable();
          return;
        }

        setEnabledState(true);
        if (permission !== 'granted') {
          void requestPermission();
        } else {
          void syncSubscription();
        }
      },
      requestPermission,
      syncSubscription,
      disable,
      sendTestNotification,
    }),
    [
      disable,
      enabled,
      error,
      isSaving,
      permission,
      requestPermission,
      sendTestNotification,
      setEnabledState,
      supportStatus,
      syncSubscription,
    ],
  );
}
