'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Plus,
  TrendingUp,
  X,
  CheckCircle,
  Award,
  AlertCircle,
  Clock,
  ExternalLink,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { TruncatedAddress } from '../../components/TruncatedAddress';
import { usePoolActivity } from '../hooks/usePoolActivity';
import {
  POOL_ACTIVITY_EVENT_META,
  POOL_ACTIVITY_EVENT_ACCENT,
  formatTimeAgo,
  formatAbsoluteTime,
  formatAmount,
  microSTXToSTX,
  type PoolActivityEventType,
  type PoolActivityEvent,
} from '../lib/pool-activity';

interface PoolActivityTimelineProps {
  poolId: number;
  outcomeLabels?: [string, string];
  maxInitialEvents?: number;
}

const EVENT_ICON: Record<PoolActivityEventType, React.ComponentType<{ className?: string }>> = {
  'pool-created': Plus,
  'bet-placed': TrendingUp,
  'bet-cancelled': X,
  'pool-settled': CheckCircle,
  'claim-processed': Award,
  'dispute-filed': AlertCircle,
  'duration-extended': Clock,
};

/**
 * Loading skeleton for activity timeline
 */
function PoolActivitySkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading pool activity">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="relative pl-8 pb-6 border-l border-border/50"
          aria-hidden="true"
        >
          {/* Timeline dot skeleton */}
          <div className="absolute -left-[17px] top-0 w-6 h-6 rounded-full border border-border/50 bg-muted/40 animate-pulse" />

          {/* Event content skeleton */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="h-4 w-32 bg-muted/60 rounded animate-pulse" />
              <div className="h-3 w-24 bg-muted/40 rounded animate-pulse" />
            </div>
            <div className="h-3 w-48 bg-muted/40 rounded animate-pulse" />
            <div className="h-3 w-40 bg-muted/40 rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state for pools with no activity
 */
function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center mx-auto mb-4">
        <Clock className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium mb-1">No Activity Yet</p>
      <p className="text-sm text-muted-foreground">
        Pool activity will appear here as events occur.
      </p>
    </div>
  );
}

/**
 * Individual activity event item
 */
function PoolActivityItem({
  event,
  outcomeLabels,
}: {
  event: PoolActivityEvent;
  outcomeLabels?: [string, string];
}) {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const Icon = EVENT_ICON[event.type];
  const meta = POOL_ACTIVITY_EVENT_META[event.type];
  const accentColor = POOL_ACTIVITY_EVENT_ACCENT[event.type];

  // Update relative time every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const relativeTime = formatTimeAgo(event.timestamp, nowSeconds);
  const absoluteTime = formatAbsoluteTime(event.timestamp);

  const statusClass = {
    success: 'bg-green-500/10 border-green-500/20',
    pending: 'bg-yellow-500/10 border-yellow-500/20',
    failed: 'bg-red-500/10 border-red-500/20',
  }[event.status];

  const statusIconClass = {
    success: 'text-green-500',
    pending: 'text-yellow-500',
    failed: 'text-red-500',
  }[event.status];

  return (
    <li className="relative pb-6 border-l border-border/50 pl-8">
      {/* Timeline dot */}
      <span
        className="absolute -left-[17px] top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card"
        aria-hidden="true"
      >
        <Icon className={`h-3.5 w-3.5 ${accentColor}`} />
      </span>

      {/* Event card */}
      <div className={`rounded-lg border p-4 ${statusClass}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              {meta.label}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
          </div>
          <time
            className="text-xs text-muted-foreground whitespace-nowrap"
            dateTime={new Date(event.timestamp * 1000).toISOString()}
            title={absoluteTime}
          >
            {relativeTime}
          </time>
        </div>

        {/* Details */}
        <div className="space-y-2 text-xs text-muted-foreground mt-3 pt-3 border-t border-border/30">
          {/* Actor */}
          <div className="flex items-center justify-between">
            <span>By</span>
            <TruncatedAddress address={event.actor} className="font-mono text-foreground/70" />
          </div>

          {/* Amount (if applicable) */}
          {event.amount !== undefined && (
            <div className="flex items-center justify-between">
              <span>Amount</span>
              <span className="text-foreground/70">{formatAmount(event.amount)} STX</span>
            </div>
          )}

          {/* Outcome (if applicable) */}
          {event.outcome !== undefined && outcomeLabels && (
            <div className="flex items-center justify-between">
              <span>Outcome</span>
              <span className="text-foreground/70 font-medium">
                {outcomeLabels[event.outcome] || `Outcome ${event.outcome}`}
              </span>
            </div>
          )}

          {/* Explorer link */}
          {event.explorerUrl && (
            <div className="pt-2 border-t border-border/30">
              <a
                href={event.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
                aria-label={`View transaction ${event.txHash} on explorer`}
              >
                View transaction
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Pool activity timeline component
 *
 * Displays chronological pool events with:
 * - Event type, timestamp (relative + absolute), actor address
 * - Amount and outcome (when applicable)
 * - Loading skeleton and empty state
 * - Infinite scroll support (max 100 events)
 */
export default function PoolActivityTimeline({
  poolId,
  outcomeLabels,
  maxInitialEvents = 100,
}: PoolActivityTimelineProps) {
  const { events, isLoading, error, hasMore, loadMore } = usePoolActivity(poolId);
  const [displayedCount, setDisplayedCount] = useState(maxInitialEvents);

  const displayedEvents = useMemo(() => {
    return events.slice(0, displayedCount);
  }, [events, displayedCount]);

  const handleLoadMore = () => {
    setDisplayedCount((prev) => Math.min(prev + 20, maxInitialEvents));
    loadMore();
  };

  return (
    <section className="mt-8" aria-label="Pool activity timeline">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-6">
        <Clock className="w-5 h-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Activity Timeline</h2>
        {events.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div
          className="flex items-center gap-2 p-4 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-sm mb-4"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading && events.length === 0 ? (
        <PoolActivitySkeleton />
      ) : /* Empty state */
      events.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Timeline */}
          <ol className="relative space-y-0">
            {displayedEvents.map((event, index) => (
              <PoolActivityItem
                key={`${event.id}-${index}`}
                event={event}
                outcomeLabels={outcomeLabels}
              />
            ))}
          </ol>

          {/* Load more button */}
          {displayedCount < events.length && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-muted/50 text-sm font-medium transition-colors"
                aria-label={`Load more events (${events.length - displayedCount} remaining)`}
              >
                Load more
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Pagination info */}
          {events.length >= maxInitialEvents && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              Showing {displayedCount} of {Math.min(events.length, maxInitialEvents)} events
            </div>
          )}
        </>
      )}
    </section>
  );
}
