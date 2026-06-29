'use client';

import { Snowflake, Gavel, Unlock, CheckCircle, ShieldCheck, ExternalLink, AlertCircle } from 'lucide-react';
import { TruncatedAddress } from '../../components/TruncatedAddress';
import {
  DISPUTE_EVENT_META,
  type DisputeEventType,
  type DisputeTimelineEvent,
} from '../lib/dispute-history';

interface DisputeHistoryTimelineProps {
  events: DisputeTimelineEvent[];
  isLoading?: boolean;
  error?: string | null;
}

const EVENT_ICON: Record<DisputeEventType, typeof Snowflake> = {
  frozen: Snowflake,
  disputed: Gavel,
  unfrozen: Unlock,
  resolved: CheckCircle,
};

const EVENT_ACCENT: Record<DisputeEventType, string> = {
  frozen: 'text-sky-400',
  disputed: 'text-amber-500',
  unfrozen: 'text-green-500',
  resolved: 'text-green-500',
};

function formatTimestamp(timestamp: number): string {
  if (!timestamp) return 'Unknown time';
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Renders a pool's dispute-lifecycle timeline (frozen / disputed / unfrozen /
 * resolved) with timestamps, the triggering address, and explorer links. Shows
 * an empty state for pools that have never been disputed.
 */
export default function DisputeHistoryTimeline({
  events,
  isLoading = false,
  error = null,
}: DisputeHistoryTimelineProps) {
  return (
    <section className="mt-8" aria-label="Dispute history">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="w-5 h-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Dispute History</h2>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading dispute history…
        </p>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-red-500" role="alert">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No disputes on record</p>
          <p className="text-sm text-muted-foreground">
            This pool has never been frozen or disputed.
          </p>
        </div>
      ) : (
        <ol className="relative border-l border-border pl-6 space-y-6">
          {events.map((event, index) => {
            const Icon = EVENT_ICON[event.type];
            const meta = DISPUTE_EVENT_META[event.type];
            return (
              <li key={`${event.txHash}-${event.type}-${index}`} className="relative">
                <span
                  className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card"
                  aria-hidden="true"
                >
                  <Icon className={`h-3.5 w-3.5 ${EVENT_ACCENT[event.type]}`} />
                </span>
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">{meta.label}</h3>
                    <time className="text-xs text-muted-foreground" dateTime={event.timestamp ? new Date(event.timestamp * 1000).toISOString() : undefined}>
                      {formatTimestamp(event.timestamp)}
                    </time>
                  </div>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {event.actor && (
                      <span className="text-muted-foreground">
                        By{' '}
                        <TruncatedAddress address={event.actor} className="font-mono text-foreground/80" />
                      </span>
                    )}
                    {event.explorerUrl && (
                      <a
                        href={event.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        View on explorer
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
