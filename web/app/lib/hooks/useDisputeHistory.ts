'use client';

import { useEffect, useState } from 'react';
import { getRuntimeConfig } from '../runtime-config';
import { getDisputeHistoryFromSoroban, type DisputeTimelineEvent } from '../dispute-history';

interface UseDisputeHistoryResult {
  events: DisputeTimelineEvent[];
  isLoading: boolean;
  error: string | null;
}

const DISPUTE_HISTORY_TTL_MS = 60_000;
const disputeHistoryCache = new Map<number, { events: DisputeTimelineEvent[]; cachedAt: number }>();

/** Test/debug helper — clears cached dispute timelines. */
export function clearDisputeHistoryCache(): void {
  disputeHistoryCache.clear();
}

/**
 * Loads the dispute-lifecycle timeline for a pool from the Soroban event log.
 * Safe to call with `undefined` (returns an empty, idle result).
 */
export function useDisputeHistory(poolId?: number): UseDisputeHistoryResult {
  const [events, setEvents] = useState<DisputeTimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (poolId === undefined || Number.isNaN(poolId)) return;

    let cancelled = false;

    // Reuse a recent timeline when navigating back to a market so the detail
    // view does not replay the same event-log request on every visit.
    const cached = disputeHistoryCache.get(poolId);
    if (cached && Date.now() - cached.cachedAt < DISPUTE_HISTORY_TTL_MS) {
      setEvents(cached.events);
      setIsLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }

    setIsLoading(true);
    setError(null);

    const { soroban } = getRuntimeConfig();
    getDisputeHistoryFromSoroban(poolId, {
      rpcUrl: soroban.rpcUrl,
      explorerUrl: soroban.explorerUrl,
      contractId: soroban.contractId,
    })
      .then((result) => {
        if (!cancelled) {
          setEvents(result);
          disputeHistoryCache.set(poolId, { events: result, cachedAt: Date.now() });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dispute history');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId]);

  return { events, isLoading, error };
}
