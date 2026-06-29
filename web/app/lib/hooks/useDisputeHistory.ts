'use client';

import { useEffect, useState } from 'react';
import { getRuntimeConfig } from '../runtime-config';
import { getDisputeHistoryFromSoroban, type DisputeTimelineEvent } from '../dispute-history';

interface UseDisputeHistoryResult {
  events: DisputeTimelineEvent[];
  isLoading: boolean;
  error: string | null;
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
    setIsLoading(true);
    setError(null);

    const { soroban } = getRuntimeConfig();
    getDisputeHistoryFromSoroban(poolId, {
      rpcUrl: soroban.rpcUrl,
      explorerUrl: soroban.explorerUrl,
      contractId: soroban.contractId,
    })
      .then((result) => {
        if (!cancelled) setEvents(result);
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
