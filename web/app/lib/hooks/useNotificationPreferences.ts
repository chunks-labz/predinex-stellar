import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from '../push-notification-types';

export type { NotificationPreferences } from '../push-notification-types';

const PREFERENCES_KEY = 'predinex_notification_preferences_v1';

export function normalizePreferences(prefs: unknown): NotificationPreferences {
  if (typeof prefs !== 'object' || prefs === null) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const obj = prefs as Record<string, unknown>;
  return {
    poolSettled:
      typeof obj.poolSettled === 'boolean' ? obj.poolSettled : DEFAULT_NOTIFICATION_PREFERENCES.poolSettled,
    disputeFiled:
      typeof obj.disputeFiled === 'boolean' ? obj.disputeFiled : DEFAULT_NOTIFICATION_PREFERENCES.disputeFiled,
    claimAvailable:
      typeof obj.claimAvailable === 'boolean'
        ? obj.claimAvailable
        : DEFAULT_NOTIFICATION_PREFERENCES.claimAvailable,
    poolExpiring24h:
      typeof obj.poolExpiring24h === 'boolean'
        ? obj.poolExpiring24h
        : typeof obj.poolExpiring === 'boolean'
          ? obj.poolExpiring
          : DEFAULT_NOTIFICATION_PREFERENCES.poolExpiring24h,
  };
}

export function useNotificationPreferences() {
  const [storedPrefs, setStoredPrefs, clearStoredPrefs] = useLocalStorage<NotificationPreferences>(
    PREFERENCES_KEY,
    { ...DEFAULT_NOTIFICATION_PREFERENCES }
  );

  const preferences = useMemo(() => normalizePreferences(storedPrefs), [storedPrefs]);

  const updatePreference = useCallback(
    (key: keyof NotificationPreferences, value: boolean) => {
      setStoredPrefs((prev) => ({
        ...normalizePreferences(prev),
        [key]: value,
      }));
    },
    [setStoredPrefs]
  );

  const togglePreference = useCallback(
    (key: keyof NotificationPreferences) => {
      updatePreference(key, !preferences[key]);
    },
    [preferences, updatePreference]
  );

  const resetToDefaults = useCallback(() => {
    clearStoredPrefs();
  }, [clearStoredPrefs]);

  const allEnabled = useMemo(
    () => Object.values(preferences).every((v) => v === true),
    [preferences]
  );

  const allDisabled = useMemo(
    () => Object.values(preferences).every((v) => v === false),
    [preferences]
  );

  return {
    preferences,
    updatePreference,
    togglePreference,
    resetToDefaults,
    allEnabled,
    allDisabled,
  };
}
