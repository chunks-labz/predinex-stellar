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

const poolActivityCache = new Map<
  number,
  { events: PoolActivityEvent[]; cursor?: string; rawCount: number; timestamp: number }
>();

export function clearPoolActivityCache(): void {
  poolActivityCache.clear();
}

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

interface FetchPoolActivityResult {
  events: PoolActivityEvent[];
  cursor?: string;
  rawCount: number;
}

async function fetchPoolActivityFromSoroban(
  poolId: number,
  limit: number,
  cursor?: string,
): Promise<FetchPoolActivityResult> {
  const cfg = getRuntimeConfig();
  const { soroban } = cfg;

  if (!soroban.rpcUrl || !soroban.explorerUrl || !soroban.contractId) {
    log.warn('Soroban config missing, returning empty pool activity');
    return { events: [], rawCount: 0 };
  }

  const paginationParams: { limit: number; cursor?: string } = { limit };
  if (cursor) {
    paginationParams.cursor = cursor;
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
      pagination: paginationParams,
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

  const json: {
    result?: {
      events?: (RawSorobanEvent & { pagingToken?: string })[];
      cursor?: string;
    };
    error?: { message: string };
  } = await response.json();

  if (json.error) {
    throw new Error(`Soroban RPC error: ${json.error.message}`);
  }

  const rawEvents = json.result?.events ?? [];
  const results: PoolActivityEvent[] = [];

  for (const raw of rawEvents) {
    const decoded = decodeSorobanEvent(raw);
    if (!decoded) continue;
    if (decoded.poolId !== poolId) continue;

    const mapped = mapEventToPoolActivity(decoded, soroban.explorerUrl);
    if (mapped) results.push(mapped);
  }

  results.sort((a, b) => b.timestamp - a.timestamp);

  const nextCursor =
    json.result?.cursor ??
    (rawEvents.length > 0
      ? rawEvents[rawEvents.length - 1].pagingToken ?? rawEvents[rawEvents.length - 1].id
      : undefined);

  return {
    events: results.slice(0, limit),
    cursor: nextCursor,
    rawCount: rawEvents.length,
  };
}

export function usePoolActivity(poolId: number | undefined): UsePoolActivityReturn {
  const [events, setEventsState] = useState<PoolActivityEvent[]>([]);
  const [isLoading, setIsLoadingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMoreState] = useState(true);
  const requestIdRef = useRef<number>(0);
  const isMountedRef = useRef(true);
  const cursorRef = useRef<string | undefined>(undefined);
  const isLoadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const eventsRef = useRef<PoolActivityEvent[]>([]);

  const setEvents = useCallback((val: PoolActivityEvent[] | ((prev: PoolActivityEvent[]) => PoolActivityEvent[])) => {
    setEventsState((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      eventsRef.current = next;
      return next;
    });
  }, []);

  const setIsLoading = useCallback((val: boolean) => {
    isLoadingRef.current = val;
    setIsLoadingState(val);
  }, []);

  const setHasMore = useCallback((val: boolean) => {
    hasMoreRef.current = val;
    setHasMoreState(val);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!poolId || poolId <= 0) {
      setEvents([]);
      setError(null);
      setHasMore(false);
      cursorRef.current = undefined;
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    cursorRef.current = undefined;

    try {
      const cached = poolActivityCache.get(poolId);
      let res: FetchPoolActivityResult;

      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        res = { events: cached.events, cursor: cached.cursor, rawCount: cached.rawCount };
      } else {
        res = await fetchPoolActivityFromSoroban(poolId, INITIAL_LOAD_SIZE);
        poolActivityCache.set(poolId, {
          events: res.events,
          cursor: res.cursor,
          rawCount: res.rawCount,
          timestamp: Date.now(),
        });
      }

      if (requestId !== requestIdRef.current || !isMountedRef.current) {
        return;
      }

      cursorRef.current = res.cursor;
      setEvents(res.events);
      setHasMore(res.rawCount >= INITIAL_LOAD_SIZE && res.events.length < MAX_EVENTS);
    } catch (err) {
      if (!isMountedRef.current) return;

      const message = err instanceof Error ? err.message : 'Failed to load pool activity';
      setError(message);
      log.error(`Failed to load activity for pool ${poolId}:`, err);
      setEvents([]);
      setHasMore(false);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [poolId, setEvents, setIsLoading, setHasMore]);

  useEffect(() => {
    loadEvents();
  }, [poolId, loadEvents]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (poolId) {
      poolActivityCache.delete(poolId);
    }
    cursorRef.current = undefined;
    await loadEvents();
  }, [poolId, loadEvents]);

  const loadMore = useCallback(async () => {
    if (!poolId || poolId <= 0 || isLoadingRef.current || !hasMoreRef.current) {
      return;
    }

    const currentEventsCount = eventsRef.current.length;
    if (currentEventsCount >= MAX_EVENTS) {
      setHasMore(false);
      return;
    }

    setIsLoading(true);
    try {
      const remainingAllowed = MAX_EVENTS - currentEventsCount;
      const fetchLimit = Math.min(INITIAL_LOAD_SIZE, remainingAllowed);

      const res = await fetchPoolActivityFromSoroban(poolId, fetchLimit, cursorRef.current);
      if (!isMountedRef.current) return;

      cursorRef.current = res.cursor;

      const existingIds = new Set(eventsRef.current.map((e) => e.id));
      const newEvents = res.events.filter((e) => !existingIds.has(e.id));
      const combined = [...eventsRef.current, ...newEvents].slice(0, MAX_EVENTS);

      setEvents(combined);

      const canLoadMore =
        res.rawCount >= fetchLimit &&
        combined.length < MAX_EVENTS &&
        newEvents.length > 0;

      setHasMore(canLoadMore);
    } catch (err) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to load more activity';
      setError(message);
      log.error(`Failed to load more activity for pool ${poolId}:`, err);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [poolId, setEvents, setIsLoading, setHasMore]);

  return {
    events,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
