'use client';

import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import Card from '../../components/ui/Card';
import { useAnalytics } from '../lib/hooks/useAnalytics';
import {
  BarChart3,
  Layers,
  TrendingUp,
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-card/20 animate-pulse rounded-2xl border border-border/50 ${className}`} />;
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className="p-5 bg-card/40 backdrop-blur-md border-border/50 hover:border-primary/30 transition-all group overflow-hidden relative">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-background/50 border border-border group-hover:scale-110 transition-transform">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{label}</p>
          <p className="text-xl font-black">{value}</p>
        </div>
      </div>
      <div className={`absolute -bottom-2 -right-2 w-16 h-16 opacity-[0.03] group-hover:opacity-10 transition-opacity ${color}`}>
        <Icon className="w-full h-full" />
      </div>
    </Card>
  );
}

// ─── Mini bar chart ──────────────────────────────────────────────────────────

function VolumeChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-32" role="img" aria-label="7-day volume chart">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-primary/60 rounded-t-md transition-all duration-500 hover:bg-primary"
            style={{ height: `${Math.max((d.value / max) * 100, 4)}%` }}
            title={`${d.label}: ${d.value.toLocaleString()} STX`}
          />
          <span className="text-[10px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function AnalyticsContent() {
  const { metrics, volumeHistory, isLoading, error } = useAnalytics();

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
          Analytics
        </h1>
        <p className="text-muted-foreground mb-8">Platform-wide statistics and trends</p>

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* KPI grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Volume" value={`${metrics.totalVolume.toLocaleString()} STX`} icon={DollarSign} color="text-primary" />
            <StatCard label="Daily Volume" value={`${metrics.dailyVolume.toLocaleString()} STX`} icon={TrendingUp} color="text-accent" />
            <StatCard label="Total Pools" value={metrics.totalPools} icon={BarChart3} color="text-purple-400" />
            <StatCard label="Active Pools" value={metrics.activePools} icon={Layers} color="text-green-400" />
            <StatCard label="Settled Pools" value={metrics.settledPools} icon={CheckCircle} color="text-blue-400" />
            <StatCard label="Expired Pools" value={metrics.expiredPools} icon={Clock} color="text-yellow-400" />
            <StatCard label="Avg Pool Size" value={`${Math.round(metrics.averagePoolSize).toLocaleString()} STX`} icon={BarChart3} color="text-pink-400" />
            <StatCard label="Platform Fees" value={`${Math.round(metrics.platformFees).toLocaleString()} STX`} icon={DollarSign} color="text-orange-400" />
          </div>
        ) : null}

        {/* Volume chart */}
        <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50 mb-8">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <div className="w-2 h-5 bg-primary rounded-full" />
            7-Day Volume
          </h2>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <VolumeChart data={volumeHistory} />
          )}
        </Card>

        {/* Pool breakdown */}
        {!isLoading && metrics && (
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-accent rounded-full" />
              Pool Breakdown
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Active', value: metrics.activePools, color: 'bg-green-500' },
                { label: 'Settled', value: metrics.settledPools, color: 'bg-blue-500' },
                { label: 'Expired', value: metrics.expiredPools, color: 'bg-yellow-500' },
              ].map(({ label, value, color }) => {
                const pct = metrics.totalPools > 0 ? (value / metrics.totalPools) * 100 : 0;
                return (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-bold">{value} <span className="text-muted-foreground font-normal">({pct.toFixed(1)}%)</span></span>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full transition-all duration-700`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function AnalyticsPage() {
  return (
    <RouteErrorBoundary routeName="Analytics">
      <AnalyticsContent />
    </RouteErrorBoundary>
  );
}
