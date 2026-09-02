'use client';

import { useState, useRef, useCallback, type ReactNode } from 'react';

interface PullToRefreshProps {
    onRefresh: () => Promise<void>;
    children: ReactNode;
}

const THRESHOLD = 60;

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
    const [refreshing, setRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const startY = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);

    // Touch events fire faster than React can re-render, so gesture state lives in
    // refs. Reading it from state would leave handleTouchMove looking at a stale
    // closure: the first moves after touchstart would still see pulling === false
    // and be dropped, making a quick swipe feel unresponsive.
    const pullingRef = useRef(false);
    const refreshingRef = useRef(false);
    const pullDistanceRef = useRef(0);

    const setPull = useCallback((distance: number) => {
        pullDistanceRef.current = distance;
        setPullDistance(distance);
    }, []);

    const setRefresh = useCallback((value: boolean) => {
        refreshingRef.current = value;
        setRefreshing(value);
    }, []);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (containerRef.current && containerRef.current.scrollTop === 0) {
            startY.current = e.touches[0].clientY;
            pullingRef.current = true;
        }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!pullingRef.current || refreshingRef.current) return;
        const diff = e.touches[0].clientY - startY.current;
        if (diff > 0) {
            setPull(Math.min(diff * 0.4, THRESHOLD * 1.5));
        }
    }, [setPull]);

    const handleTouchEnd = useCallback(async () => {
        if (!pullingRef.current) return;
        pullingRef.current = false;

        if (pullDistanceRef.current >= THRESHOLD && !refreshingRef.current) {
            setRefresh(true);
            try {
                await onRefresh();
            } finally {
                setRefresh(false);
            }
        }
        setPull(0);
    }, [onRefresh, setPull, setRefresh]);

    return (
        <div
            ref={containerRef}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="relative"
        >
            {(pullDistance > 0 || refreshing) && (
                <div
                    className="flex items-center justify-center text-muted-foreground text-sm py-2 transition-all"
                    style={{ height: refreshing ? 40 : pullDistance }}
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {refreshing ? (
                        <span
                            className="animate-spin inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full"
                            role="status"
                            aria-label="Refreshing content"
                        />
                    ) : pullDistance >= THRESHOLD ? (
                        <span>Release to refresh</span>
                    ) : (
                        <span>Pull to refresh</span>
                    )}
                </div>
            )}
            {children}
        </div>
    );
}
