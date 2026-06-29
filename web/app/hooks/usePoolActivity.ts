'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('usePoolActivity');

import { useState, useEffect, useRef, useCallback } from 'react';
import { getRuntimeConfig } from '../lib/runtime-config';
import {
  decodeSorobanEvent,
  SUPPORTED_EVENT_SCHEMA_VERSION,
  type RawSorobanEvent,
  type SorobanEventName,
} from '../lib/soroban-event-service';
import type { PoolActivityEvent, PoolActivityEventType } from '../lib/pool-activity';

interface UsePoolActivityReturn {
  events: PoolActivityEvent[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
}

const INITIAL_LOAD_SIZE = 100;
const MAX_EVENTS = 200;
const CACHE_TTL = 30000;

const poolActivityCache = new Map<number, { events: PoolActivityEvent[]; timestamp: number }>();

const EVENT_TYPE_MAP: Record<SorobanEventName, PoolActivityEventType | null> = {
  create_pool: 'pool-created',
  place_bet: 'bet-placed',
  settle_pool: 'pool-settled',
  claim_winnings: 'claim-processed',
  fee_collected: null,
  treasury_withdrawal: null,
};

function mapEventToPoolActivity(
  decoded: NonNullable<ReturnType<typeof decodeSorobanEvent>>,
  explorerUrl: string,
): PoolActivityEvent | null {
  const eventType = EVENT_TYPE_MAP[decoded.name];
  if (!eventType) return null;

  return {
    id: decoded.txHash,
    type: eventType,
    poolId: decoded.poolId ?? 0,
    actor: decoded.user ?? '',
    timestamp: decoded.timestamp,
    txHash: decoded.txHash,
    explorerUrl: `${explorerUrl}/tx/${decoded.txHash}`,
    amount: decoded.amount ?? decoded.winnings,
    outcome: decoded.outcome ?? decoded.winningOutcome,
    status: 'success',
  };
}

async function fetchPoolActivityFromSoroban(
  poolId: number,
  limit: number,
): Promise<PoolActivityEvent[]> {
  const cfg = getRuntimeConfig();
  const { soroban } = cfg;

  if (!soroban.rpcUrl || !soroban.explorerUrl || !soroban.contractId) {
    log.warn('Soroban config missing, returning empty pool activity');
    return [];
  }

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getEvents',
    params: {
      filters: [
        {
          type: 'contract',
          contractIds: [soroban.contractId],
          topics: [
            ['create_pool', 'place_bet', 'settle_pool', 'claim_winnings'],
            [SUPPORTED_EVENT_SCHEMA_VERSION],
          ],
        },
      ],
      pagination: { limit },
    },
  };

  const response = await fetch(soroban.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Soroban RPC error: ${response.status}`);
  }

  const json: { result?: { events?: RawSorobanEvent[] }; error?: { message: string } } =
    await response.json();

  if (json.error) {
    throw new Error(`Soroban RPC error: ${json.error.message}`);
  }

  const rawEvents: RawSorobanEvent[] = json.result?.events ?? [];

  const results: PoolActivityEvent[] = [];

  for (const raw of rawEvents) {
    const decoded = decodeSorobanEvent(raw);
    if (!decoded) continue;
    if (decoded.poolId !== poolId) continue;

    const mapped = mapEventToPoolActivity(decoded, soroban.explorerUrl);
    if (mapped) results.push(mapped);
  }

  results.sort((a, b) => b.timestamp - a.timestamp);

  return results.slice(0, limit);
}

export function usePoolActivity(poolId: number | undefined): UsePoolActivityReturn {
  const [events, setEvents] = useState<PoolActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef(true);

  const fetchPoolActivity = useCallback(
    async (id: number, limit: number): Promise<PoolActivityEvent[]> => {
      const cached = poolActivityCache.get(id);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.events;
      }

      const events = await fetchPoolActivityFromSoroban(id, limit);

      poolActivityCache.set(id, { events, timestamp: Date.now() });

      return events;
    },
    [],
  );

  const loadEvents = useCallback(async () => {
    if (!poolId || poolId <= 0) {
      setEvents([]);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const fetchedEvents = await fetchPoolActivity(poolId, INITIAL_LOAD_SIZE);

      if (requestId !== requestIdRef.current || !isMountedRef.current) {
        return;
      }

      setEvents(fetchedEvents);
      setHasMore(fetchedEvents.length >= INITIAL_LOAD_SIZE);
    } catch (err) {
      if (!isMountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Failed to load pool activity';
      setError(message);
      log.error(`Failed to load activity for pool ${poolId}:`, err);
      setEvents([]);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [poolId, fetchPoolActivity]);

  useEffect(() => {
    loadEvents();
  }, [poolId, loadEvents]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (poolId) {
      poolActivityCache.delete(poolId);
    }
    await loadEvents();
  }, [poolId, loadEvents]);

  const loadMore = useCallback(() => {
    setHasMore(false);
  }, []);

  return {
    events,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
