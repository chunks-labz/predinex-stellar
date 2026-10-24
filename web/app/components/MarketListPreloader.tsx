'use client';

import { useEffect, useRef } from 'react';
import { readMarketListCache, warmMarketListCache } from '../lib/market-list-cache';

/**
 * Background-warms the markets list cache so the markets page can render
 * from cached data immediately on first navigation.
 */
export default function MarketListPreloader() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // If cache is already fresh, avoid any extra network/contract calls.
    const cache = readMarketListCache();
    if (cache.isFresh) return;

    const warmCache = async () => {
      if (!mountedRef.current) return;
      try {
        await warmMarketListCache();
      } catch {
        // Non-fatal: markets page will handle fetching + UX fallback.
      }
    };

    // Use idle time so we don't block the initial page render/hydration.
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
    };

    let handle: number | undefined;

    if (typeof idleWindow.requestIdleCallback === 'function') {
      handle = idleWindow.requestIdleCallback(() => void warmCache(), { timeout: 2000 });
    } else {
      handle = window.setTimeout(() => void warmCache(), 1000);
    }

    return () => {
      mountedRef.current = false;
      if (handle !== undefined) {
        if (typeof idleWindow.requestIdleCallback === 'function') {
          cancelIdleCallback(handle);
        } else {
          clearTimeout(handle);
        }
      }
    };
  }, []);

  return null;
}

