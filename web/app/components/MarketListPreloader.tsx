'use client';

import { useEffect } from 'react';
import { readMarketListCache, warmMarketListCache } from '../lib/market-list-cache';

/**
 * Background-warms the markets list cache so the markets page can render
 * from cached data immediately on first navigation.
 */
export default function MarketListPreloader() {
  useEffect(() => {
    // If cache is already fresh, avoid any extra network/contract calls.
    const cache = readMarketListCache();
    if (cache.isFresh) return;

    const warmCache = async () => {
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

    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleWindow.requestIdleCallback(() => void warmCache(), { timeout: 2000 });
    } else {
      window.setTimeout(() => void warmCache(), 1000);
    }
  }, []);

  return null;
}

