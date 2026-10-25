'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('useUserActivity');

import { useState, useCallback, useEffect, useRef } from 'react';
import { predinexReadApi } from '../lib/adapters/predinex-read-api';
import type { ActivityItem } from '../lib/adapters/types';
import { userActivityCache } from '../lib/cache-invalidation';
import { useVisibilityAwarePolling } from '../lib/hooks/useVisibilityAwarePolling';

const REFRESH_INTERVAL_MS = 30_000;

interface UseUserActivityReturn {
    activities: ActivityItem[];
    isLoading: boolean;
    error: string | null;
    refresh: () => void;
}

/**
 * Hook to fetch and manage a user's on-chain activity feed.
 * Uses the Soroban event service to ingest contract events from Stellar.
 * Automatically fetches when an address is provided.
 * Uses the shared userActivityCache so mutation-driven invalidation
 * (via invalidateOnPlaceBet / invalidateOnClaimWinnings) forces a fresh fetch.
 */
export function useUserActivity(
    address: string | undefined,
    limit: number = 20
): UseUserActivityReturn {
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const mountedRef = useRef(true);
    const lastParamsRef = useRef<string | null>(null);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestIdRef.current += 1;
        };
    }, []);

    const fetchActivity = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;

        if (!address) {
            if (mountedRef.current) {
                setActivities([]);
            }
            return;
        }

        // Return in-memory cached result if still fresh
        const cached = userActivityCache.get<ActivityItem[]>(address);
        if (cached) {
            if (mountedRef.current && requestIdRef.current === requestId) {
                setActivities(cached);
            }
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const data = await predinexReadApi.getUserActivitySoroban(address, limit);
            if (!mountedRef.current || requestIdRef.current !== requestId) {
                return;
            }
            setActivities(data);
            userActivityCache.set(address, data, REFRESH_INTERVAL_MS);
        } catch (e) {
            if (!mountedRef.current || requestIdRef.current !== requestId) {
                return;
            }
            setError('Failed to load activity. Please try again.');
            log.error('useUserActivity error:', e);
        } finally {
            if (mountedRef.current && requestIdRef.current === requestId) {
                setIsLoading(false);
            }
        }
    }, [address, limit]);

    useEffect(() => {
        const key = `${address ?? ''}:${limit}`;
        if (lastParamsRef.current === null) {
            lastParamsRef.current = key;
            return;
        }
        if (lastParamsRef.current !== key) {
            lastParamsRef.current = key;
            void fetchActivity();
        }
    }, [address, fetchActivity, limit]);

    useVisibilityAwarePolling(fetchActivity, REFRESH_INTERVAL_MS, {
        enabled: !!address,
    });

    return {
        activities,
        isLoading,
        error,
        refresh: fetchActivity,
    };
}
