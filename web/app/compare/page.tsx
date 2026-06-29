'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, BarChart2, X, Eraser } from 'lucide-react';
import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { useMarketDiscovery } from '../lib/hooks/useMarketDiscovery';
import { usePoolComparison, POOL_COMPARISON_MAX } from '../lib/hooks/usePoolComparison';
import { formatSTXAmount } from '../lib/market-utils';
import { blocksToSeconds } from '../lib/countdown-utils';
import { formatDisplayAddress } from '../lib/address-display';
import CountdownTimer from '@/components/CountdownTimer';
import type { ProcessedMarket } from '../lib/market-types';

const COMPARISON_ROWS: Array<{
  label: string;
  render: (m: ProcessedMarket) => React.ReactNode;
}> = [
  {
    label: 'Question',
    render: (m) => (
      <Link
        href={`/markets/${m.poolId}`}
        className="font-semibold text-foreground hover:text-primary transition-colors line-clamp-3"
      >
        {m.title}
      </Link>
    ),
  },
  {
    label: 'Outcomes',
    render: (m) => (
      <div className="space-y-1">
        <div>
          <span className="text-green-400 font-medium">{m.outcomeA}</span>
          <span className="text-muted-foreground"> vs </span>
          <span className="text-red-400 font-medium">{m.outcomeB}</span>
        </div>
      </div>
    ),
  },
  {
    label: 'Current odds',
    render: (m) => (
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-green-400">{m.outcomeA}</span>
          <span className="font-mono">{m.oddsA}%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-red-400">{m.outcomeB}</span>
          <span className="font-mono">{m.oddsB}%</span>
        </div>
      </div>
    ),
  },
  {
    label: 'Volume',
    render: (m) => <span className="font-mono">{formatSTXAmount(m.totalVolume)}</span>,
  },
  {
    label: 'Participants',
    render: () => (
      <span
        className="text-muted-foreground"
        title="Participant count is not yet exposed by the contract read API"
      >
        —
      </span>
    ),
  },
  {
    label: 'End time',
    render: (m) => (
      <CountdownTimer
        secondsRemaining={m.status === 'expired' ? null : blocksToSeconds(m.timeRemaining)}
        settled={m.status === 'settled'}
        showIcon
      />
    ),
  },
  {
    label: 'Fee rate',
    render: () => (
      <span
        className="text-muted-foreground"
        title="Fee rate is not yet exposed by the contract read API"
      >
        —
      </span>
    ),
  },
  {
    label: 'Creator',
    render: (m) => (
      <span className="text-xs font-mono text-muted-foreground">
        {formatDisplayAddress(m.creator)}
      </span>
    ),
  },
  {
    label: 'Status',
    render: (m) => (
      <span className="capitalize text-sm">{m.status}</span>
    ),
  },
];

function CompareContent() {
  const { selected, count, remove, clear } = usePoolComparison();
  const { allMarkets, isLoading, error } = useMarketDiscovery();

  const comparedMarkets = useMemo(() => {
    if (selected.length === 0) return [];
    const byId = new Map(allMarkets.map((m) => [m.poolId, m]));
    return selected.map((id) => byId.get(id)).filter((m): m is ProcessedMarket => Boolean(m));
  }, [selected, allMarkets]);

  const missingIds = useMemo(() => {
    if (selected.length === 0) return [];
    const present = new Set(comparedMarkets.map((m) => m.poolId));
    return selected.filter((id) => !present.has(id));
  }, [selected, comparedMarkets]);

  if (count < 2) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BarChart2 className="w-12 h-12 mx-auto text-muted-foreground mb-6" />
          <h1 className="text-3xl font-bold mb-3">Compare prediction pools</h1>
          <p className="text-muted-foreground mb-6">
            {count === 0
              ? 'Tick the "Add to compare" checkbox on a market card to start a side-by-side comparison.'
              : 'Add at least one more pool to start comparing.'}{' '}
            You can compare up to {POOL_COMPARISON_MAX} pools at once.
          </p>
          <Link
            href="/markets"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:brightness-110 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            Browse markets
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />

      <div className="pt-32 pb-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Pool comparison</h1>
            <p className="text-muted-foreground text-sm">
              Comparing {count} pool{count === 1 ? '' : 's'} side-by-side.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/markets"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to markets
            </Link>
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted/40 transition-colors"
            >
              <Eraser className="w-4 h-4" />
              Clear all
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400"
          >
            Failed to refresh market data: {error}
          </div>
        )}

        {missingIds.length > 0 && !isLoading && (
          <div
            role="status"
            className="mb-6 rounded-xl border border-yellow-500/20 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300"
          >
            Some selected pools are no longer in the cached list (
            {missingIds.map((id) => `#${id}`).join(', ')}). Visit the markets page to refresh, or remove them below.
          </div>
        )}

        {/* Desktop / tablet table */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left">
            <thead className="bg-muted/30">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/30 px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Attribute
                </th>
                {comparedMarkets.map((m) => (
                  <th
                    key={m.poolId}
                    scope="col"
                    className="px-4 py-3 text-xs font-medium text-muted-foreground border-l border-border"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">#POOL-{m.poolId}</span>
                      <button
                        type="button"
                        onClick={() => remove(m.poolId)}
                        aria-label={`Remove pool #${m.poolId} from comparison`}
                        className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background/95 backdrop-blur px-4 py-3 text-sm font-medium text-muted-foreground align-top"
                  >
                    {row.label}
                  </th>
                  {comparedMarkets.map((m) => (
                    <td
                      key={m.poolId}
                      className="px-4 py-3 align-top text-sm border-l border-border"
                    >
                      {row.render(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile stacked view */}
        <div className="md:hidden space-y-4">
          {comparedMarkets.map((m) => (
            <div
              key={m.poolId}
              className="glass rounded-xl border border-border p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">
                  #POOL-{m.poolId}
                </span>
                <button
                  type="button"
                  onClick={() => remove(m.poolId)}
                  aria-label={`Remove pool #${m.poolId} from comparison`}
                  className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <dl className="space-y-2 text-sm">
                {COMPARISON_ROWS.map((row) => (
                  <div key={row.label} className="grid grid-cols-2 gap-2">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd>{row.render(m)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function ComparePage() {
  return (
    <RouteErrorBoundary routeName="Compare">
      <CompareContent />
    </RouteErrorBoundary>
  );
}
