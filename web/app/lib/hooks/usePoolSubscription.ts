'use client';

import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';

const SUBSCRIPTIONS_KEY = 'predinex_pool_subscriptions_v1';

/**
 * Tracks which pool IDs the user has subscribed to for in-app notifications.
 */
export function usePoolSubscription() {
  const [subscribed, setSubscribed] = useLocalStorage<number[]>(SUBSCRIPTIONS_KEY, []);

  const isSubscribed = useCallback(
    (poolId: number) => subscribed.includes(poolId),
    [subscribed],
  );

  const subscribe = useCallback(
    (poolId: number) => {
      setSubscribed((prev) => (prev.includes(poolId) ? prev : [...prev, poolId]));
    },
    [setSubscribed],
  );

  const unsubscribe = useCallback(
    (poolId: number) => {
      setSubscribed((prev) => prev.filter((id) => id !== poolId));
    },
    [setSubscribed],
  );

  const toggle = useCallback(
    (poolId: number) => {
      if (isSubscribed(poolId)) {
        unsubscribe(poolId);
      } else {
        subscribe(poolId);
      }
    },
    [isSubscribed, subscribe, unsubscribe],
  );

  return useMemo(
    () => ({ subscribed, isSubscribed, subscribe, unsubscribe, toggle }),
    [subscribed, isSubscribed, subscribe, unsubscribe, toggle],
  );
}
