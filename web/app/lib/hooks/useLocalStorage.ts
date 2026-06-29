/**
 * Custom hook for managing local storage
 * Provides persistent state management
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing local storage
 * @param key Storage key
 * @param initialValue Initial value if not in storage
 * @returns Value and setter function
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      // Get from local storage by key
      const item = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;

      if (item) {
        return JSON.parse(item);
      }

      return initialValue;
    } catch (error) {
      log.error(`Error reading from localStorage for key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        // Allow value to be a function so we have same API as useState
        const valueToStore = value instanceof Function ? value(storedValue) : value;

        // Save state
        setStoredValue(valueToStore);

        // Save to local storage
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }
      } catch (error) {
        log.error(`Error writing to localStorage for key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Remove from local storage
  const removeValue = useCallback(() => {
    try {
      setStoredValue(initialValue);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(key);
      }
    } catch (error) {
      log.error(`Error removing from localStorage for key "${key}":`, error);
    }
  }, [key, initialValue]);

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
