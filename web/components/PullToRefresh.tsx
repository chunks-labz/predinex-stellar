'use client';

import { useState, useRef, useCallback, type ReactNode } from 'react';

interface PullToRefreshProps {
    onRefresh: () => Promise<void>;
    children: ReactNode;
}

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
    const [pulling, setPulling] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const startY = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const THRESHOLD = 60;

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (containerRef.current && containerRef.current.scrollTop === 0) {
            startY.current = e.touches[0].clientY;
            setPulling(true);
        }
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!pulling || refreshing) return;
        const diff = e.touches[0].clientY - startY.current;
        if (diff > 0) {
            setPullDistance(Math.min(diff * 0.4, THRESHOLD * 1.5));
        }
    }, [pulling, refreshing]);

    const handleTouchEnd = useCallback(async () => {
        if (!pulling) return;
        setPulling(false);

        if (pullDistance >= THRESHOLD && !refreshing) {
            setRefreshing(true);
            try {
                await onRefresh();
            } finally {
                setRefreshing(false);
            }
        }
        setPullDistance(0);
    }, [pulling, pullDistance, refreshing, onRefresh]);

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
                >
                    {refreshing ? (
                        <span className="animate-spin inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full" />
                    ) : pullDistance >= THRESHOLD ? (
                        'Release to refresh'
                    ) : (
                        'Pull to refresh'
                    )}
                </div>
            )}
            {children}
        </div>
    );
}
