'use client';

import { useMemo, useState } from 'react';
import Navbar from '@/components/Navbar';
import AuthGuard from '@/components/AuthGuard';
import ActivityFeed from '../components/ActivityFeed';
import ActivityExportButton from '../components/ActivityExportButton';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import { useWallet } from '@/components/WalletAdapterProvider';
import { useUserActivity } from '../hooks/useUserActivity';
import { Activity, ChevronLeft, ChevronRight, Target, Trophy, TrendingUp } from 'lucide-react';

type FilterType = 'all' | 'bet-placed' | 'winnings-claimed' | 'pool-created' | 'contract-call';

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bet-placed', label: 'Bets' },
  { value: 'winnings-claimed', label: 'Claims' },
  { value: 'pool-created', label: 'Pools' },
  { value: 'contract-call', label: 'Contract Calls' },
];

const PAGE_SIZE = 10;

function toDateInput(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export default function ActivityPage() {
  const { address: stxAddress } = useWallet();
  const { activities, isLoading, error, refresh } = useUserActivity(stxAddress ?? undefined, 100);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);

  const filteredActivities = useMemo(() => {
    return activities.filter((activityItem) => {
      const matchesType = activeFilter === 'all' || activityItem.type === activeFilter;
      const activityDate = toDateInput(activityItem.timestamp);
      const matchesFrom = !fromDate || activityDate >= fromDate;
      const matchesTo = !toDate || activityDate <= toDate;
      return matchesType && matchesFrom && matchesTo;
    });
  }, [activeFilter, activities, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filteredActivities.length / PAGE_SIZE));
  const paginatedActivities = filteredActivities.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalBets = activities.filter((item) => item.type === 'bet-placed').length;
  const totalClaims = activities.filter((item) => item.type === 'winnings-claimed').length;
  const successCount = activities.filter((item) => item.status === 'success').length;
  const successRate = activities.length > 0 ? Math.round((successCount / activities.length) * 100) : 0;

  const stats = [
    { label: 'Total Bets', value: totalBets, icon: Target, color: 'text-primary' },
    { label: 'Winnings Claimed', value: totalClaims, icon: Trophy, color: 'text-green-400' },
    { label: 'Success Rate', value: `${successRate}%`, icon: TrendingUp, color: 'text-accent' },
    { label: 'Transactions', value: activities.length, icon: Activity, color: 'text-purple-400' },
  ];

  const resetPage = () => setPage(1);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <RouteErrorBoundary routeName="Activity">
      <AuthGuard>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="glass-panel p-8 rounded-2xl mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
                Transaction History
              </h1>
              <p className="text-muted-foreground">
                Review Type, Pool, Amount, Date, Status, and Stellar Explorer links for your on-chain activity.
              </p>
            </div>
            <ActivityExportButton
              activities={filteredActivities}
              fromDate={fromDate}
              toDate={toDate}
              disabled={isLoading || filteredActivities.length === 0}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {stats.map((stat) => (
              <div key={stat.label} className="p-5 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md hover:border-primary/30 transition-all group relative overflow-hidden">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-background/50 border border-border group-hover:scale-110 transition-transform">
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{stat.label}</p>
                    <p className="text-xl font-black">{isLoading ? '—' : stat.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <section className="mb-6 grid gap-4 rounded-2xl border border-border bg-card/40 p-4 lg:grid-cols-[1fr_180px_180px]" aria-label="Activity filters">
            <div>
              <label className="mb-2 block text-sm font-bold" htmlFor="transaction-type-filter">Transaction type</label>
              <select
                id="transaction-type-filter"
                value={activeFilter}
                onChange={(event) => { setActiveFilter(event.target.value as FilterType); resetPage(); }}
                className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold" htmlFor="activity-from-date">From</label>
              <input id="activity-from-date" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); resetPage(); }} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-bold" htmlFor="activity-to-date">To</label>
              <input id="activity-to-date" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); resetPage(); }} className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          </section>

          <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
            <ActivityFeed activities={paginatedActivities} isLoading={isLoading} error={error} onRefresh={refresh} />
          </div>

          {!isLoading && !error && filteredActivities.length > 0 && (
            <nav className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Activity pagination">
              <p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {filteredActivities.length} matching transaction{filteredActivities.length === 1 ? '' : 's'}</p>
              <div className="flex gap-2">
                <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button type="button" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </nav>
          )}
        </div>
      </AuthGuard>
      </RouteErrorBoundary>
    </main>
  );
}
