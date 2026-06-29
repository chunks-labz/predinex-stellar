'use client';

import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, RefreshCw } from 'lucide-react';

interface StaleDataIndicatorProps {
  /** Timestamp (ms since epoch) when the data was last fetched */
  lastFetchedAt?: number;
  /** Maximum age in milliseconds before data is considered stale */
  maxAge?: number;
  /** Whether data is currently being refreshed */
  isRefreshing?: boolean;
  /** Callback to refresh the data */
  onRefresh?: () => void;
  /** Override: force show as stale */
  forceStale?: boolean;
  /** Compact mode - shows just an icon */
  compact?: boolean;
}

const DEFAULT_MAX_AGE = 30 * 1000; // 30 seconds

export default function StaleDataIndicator({
  lastFetchedAt,
  maxAge = DEFAULT_MAX_AGE,
  isRefreshing = false,
  onRefresh,
  forceStale = false,
  compact = false,
}: StaleDataIndicatorProps) {
  const [currentTime, setCurrentTime] = useState(lastFetchedAt ?? 0);

  useEffect(() => {
    if (!lastFetchedAt) return;

    setCurrentTime(Date.now());

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [lastFetchedAt]);

  if (!lastFetchedAt && !forceStale) return null;

  const age = currentTime - lastFetchedAt!;
  const isStale = forceStale || age > maxAge;

  if (compact) {
    return (
      <div className="inline-flex items-center">
        {isStale && !isRefreshing && (
          <span
            title="Data may be stale"
            className="inline-flex items-center text-yellow-500"
          >
            <Clock className="w-3 h-3" />
          </span>
        )}
        {isRefreshing && (
          <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
        )}
      </div>
    );
  }

  if (!isStale && !isRefreshing) return null;

  return (
    <div
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg ${
        isStale && !isRefreshing
          ? 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20'
          : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
      }`}
    >
      {isStale && !isRefreshing && (
        <>
          <AlertTriangle className="w-3 h-3" />
          <span>Data may be stale</span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="ml-1 underline hover:no-underline font-medium"
            >
              Refresh
            </button>
          )}
        </>
      )}
      {isRefreshing && (
        <>
          <RefreshCw className="w-3 h-3 animate-spin" />
          <span>Refreshing...</span>
        </>
      )}
    </div>
  );
}

/**
 * Hook to track staleness of data based on timestamp
 */
export function useStaleData(lastFetchedAt: number | undefined, maxAgeMs: number = DEFAULT_MAX_AGE) {
  const [currentTime, setCurrentTime] = useState(lastFetchedAt ?? 0);

  useEffect(() => {
    if (!lastFetchedAt) return;

    setCurrentTime(Date.now());

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 5000);

    return () => clearInterval(interval);
  }, [lastFetchedAt]);

  if (!lastFetchedAt) return { isStale: false, age: 0 };

  const age = currentTime - lastFetchedAt;
  return {
    isStale: age > maxAgeMs,
    age,
  };
}
