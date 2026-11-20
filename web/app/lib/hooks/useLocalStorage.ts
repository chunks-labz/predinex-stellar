/**
 * Custom hook for managing local storage
 * Provides persistent state management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('useLocalStorage');

/**
 * Hook for managing local storage
 * @param key Storage key
 * @param initialValue Initial value if not in storage
 * @returns Value and setter function
 */
/**
 * Same-tab change notification. The browser's `storage` event only fires in
 * *other* tabs, so without this every hook instance kept a private copy of the
 * value and writes from one instance silently clobbered another's.
 */
const LOCAL_STORAGE_CHANGE_EVENT = 'predinex:local-storage';

function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Hook for managing local storage.
 *
 * Every instance reading the same key stays in sync — within the tab via a
 * custom event, across tabs via the native `storage` event — and functional
 * updates are applied to the latest persisted value rather than this
 * instance's last render.
 *
 * @param key Storage key
 * @param initialValue Initial value if not in storage
 * @returns Value and setter function
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  migrate?: (value: unknown) => T
) {
  // Keep the latest props in refs so `readValue` stays stable across renders
  // even when callers pass inline literals / callbacks.
  const initialValueRef = useRef(initialValue);
  const migrateRef = useRef(migrate);
  initialValueRef.current = initialValue;
  migrateRef.current = migrate;

  const readValue = useCallback((): T => {
    try {
      const item = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;

      if (item) {
        const parsed = JSON.parse(item);
        return migrateRef.current ? migrateRef.current(parsed) : parsed;
      }

      return initialValueRef.current;
    } catch (error) {
      log.error(`Error reading from localStorage for key "${key}":`, error);
      return initialValueRef.current;
    }
  }, [key]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  // Raw string this instance last saw, so a notification for content it
  // already holds (including its own write) doesn't hand consumers a new,
  // equal object and re-run their effects.
  const lastRawRef = useRef<string | null>(
    typeof window !== 'undefined' ? safeGetItem(key) : null
  );

  // Mirror of the latest value, so functional updates never compose against a
  // stale render when several updates land before React re-renders.
  const latestRef = useRef(storedValue);
  latestRef.current = storedValue;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = (changedKey: string | null) => {
      // `null` is what `localStorage.clear()` reports.
      if (changedKey !== null && changedKey !== key) return;
      const raw = safeGetItem(key);
      if (raw === lastRawRef.current) return;
      lastRawRef.current = raw;
      const next = readValue();
      latestRef.current = next;
      setStoredValue(next);
    };

    // A sessionStorage event with the same key only causes a harmless re-read.
    const onStorage = (event: StorageEvent) => sync(event.key);
    const onLocalChange = (event: Event) => {
      sync((event as CustomEvent<{ key: string }>).detail?.key ?? null);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, onLocalChange);
    };
  }, [key, readValue]);

  const notify = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(LOCAL_STORAGE_CHANGE_EVENT, { detail: { key } })
    );
  }, [key]);

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        // Allow value to be a function so we have same API as useState.
        // Compose against what is persisted, which may have been written by
        // another instance since this one last rendered.
        const current = typeof window !== 'undefined' ? readValue() : latestRef.current;
        const valueToStore = value instanceof Function ? value(current) : value;

        // Save state
        latestRef.current = valueToStore;
        setStoredValue(valueToStore);

        // Save to local storage
        if (typeof window !== 'undefined') {
          const raw = JSON.stringify(valueToStore);
          window.localStorage.setItem(key, raw);
          lastRawRef.current = raw;
          notify();
        }
      } catch (error) {
        log.error(`Error writing to localStorage for key "${key}":`, error);
      }
    },
    [key, readValue, notify]
  );

  // Remove from local storage
  const removeValue = useCallback(() => {
    try {
      latestRef.current = initialValueRef.current;
      setStoredValue(initialValueRef.current);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
        lastRawRef.current = null;
        notify();
      }
    } catch (error) {
      log.error(`Error removing from localStorage for key "${key}":`, error);
    }
  }, [key, notify]);

  return [storedValue, setValue, removeValue] as const;
}

/**
 * Hook for managing session storage
 * @param key Storage key
 * @param initialValue Initial value if not in storage
 * @returns Value and setter function
 */
export function useSessionStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;

      if (item) {
        return JSON.parse(item);
      }

      return initialValue;
    } catch (error) {
      log.error(`Error reading from sessionStorage for key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;

        setStoredValue(valueToStore);

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        log.error(`Error writing to sessionStorage for key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(key);
      }
    } catch (error) {
      log.error(`Error removing from sessionStorage for key "${key}":`, error);
    }
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue] as const;
}
