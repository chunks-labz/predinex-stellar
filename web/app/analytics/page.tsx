'use client';

import { useState, useMemo } from 'react';
import Navbar from '@/components/Navbar';
import RouteErrorBoundary from '../../components/RouteErrorBoundary';
import Card from '../../components/ui/Card';
import { useAnalytics } from '../lib/hooks/useAnalytics';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import {
  BarChart3,
  Layers,
  TrendingUp,
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
  Users,
  Target,
  Activity,
  Filter,
} from 'lucide-react';

type TimeRange = '7d' | '30d' | 'all';

const COLORS = ['#6366f1', '#22d3ee', '#f472b6', '#facc15', '#34d399'];

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-card/20 animate-pulse rounded-2xl border border-border/50 ${className}`} />;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  trend?: { value: number; isPositive: boolean };
}) {
  return (
    <Card className="p-5 bg-card/40 backdrop-blur-md border-border/50 hover:border-primary/30 transition-all group overflow-hidden relative">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-background/50 border border-border group-hover:scale-110 transition-transform">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{label}</p>
          <p className="text-xl font-black truncate">{value}</p>
        </div>
        {trend && (
          <div className={`text-xs font-medium ${trend.isPositive ? 'text-green-500' : 'text-red-500'}`}>
            {trend.isPositive ? '+' : ''}{trend.value}%
          </div>
        )}
      </div>
      <div className={`absolute -bottom-2 -right-2 w-16 h-16 opacity-[0.03] group-hover:opacity-10 transition-opacity ${color}`}>
        <Icon className="w-full h-full" />
      </div>
    </Card>
  );
}

function TimeRangeFilter({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (v: TimeRange) => void;
}) {
  const options: { label: string; value: TimeRange }[] = [
    { label: '7 Days', value: '7d' },
    { label: '30 Days', value: '30d' },
    { label: 'All Time', value: 'all' },
  ];

  return (
    <div className="flex items-center gap-2">
      <Filter className="w-4 h-4 text-muted-foreground" />
      <div className="flex rounded-xl border border-border/50 overflow-hidden">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card/40 text-muted-foreground hover:text-foreground hover:bg-card/60'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function VolumeBarChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            color: 'hsl(var(--foreground))',
          }}
          formatter={(value: number) => [`${value.toLocaleString()} STX`, 'Volume']}
        />
        <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function OutcomePieChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={5}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            color: 'hsl(var(--foreground))',
          }}
          formatter={(value: number) => [value.toLocaleString(), 'Count']}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ProfitLineChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <defs>
          <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            color: 'hsl(var(--foreground))',
          }}
          formatter={(value: number) => [`${value.toLocaleString()} STX`, 'Profit/Loss']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#34d399"
          fillOpacity={1}
          fill="url(#profitGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PoolBreakdownChart({
  active,
  settled,
  expired,
}: {
  active: number;
  settled: number;
  expired: number;
}) {
  const data = [
    { name: 'Active', value: active },
    { name: 'Settled', value: settled },
    { name: 'Expired', value: expired },
  ];

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={5}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
        >
          <Cell fill="#34d399" />
          <Cell fill="#6366f1" />
          <Cell fill="#facc15" />
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            color: 'hsl(var(--foreground))',
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function AnalyticsContent() {
  const { metrics, volumeHistory, isLoading, error } = useAnalytics();
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');

  const filteredVolumeHistory = useMemo(() => {
    if (!volumeHistory.length) return [];
    switch (timeRange) {
      case '7d':
        return volumeHistory.slice(-7);
      case '30d':
        return volumeHistory.slice(-30);
      default:
        return volumeHistory;
    }
  }, [volumeHistory, timeRange]);

  const poolBreakdownData = useMemo(() => {
    if (!metrics) return [];
    return [
      { name: 'Active', value: metrics.activePools },
      { name: 'Settled', value: metrics.settledPools },
      { name: 'Expired', value: metrics.expiredPools },
    ];
  }, [metrics]);

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Analytics
            </h1>
            <p className="text-muted-foreground">Platform-wide statistics and trends</p>
          </div>
          <TimeRangeFilter value={timeRange} onChange={setTimeRange} />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* KPI grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : metrics ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Total Volume"
              value={`${metrics.totalVolume.toLocaleString()} STX`}
              icon={DollarSign}
              color="text-primary"
            />
            <StatCard
              label="Daily Volume"
              value={`${metrics.dailyVolume.toLocaleString()} STX`}
              icon={TrendingUp}
              color="text-accent"
              trend={{ value: 12, isPositive: true }}
            />
            <StatCard
              label="Total Pools"
              value={metrics.totalPools}
              icon={BarChart3}
              color="text-purple-400"
            />
            <StatCard
              label="Active Pools"
              value={metrics.activePools}
              icon={Layers}
              color="text-green-400"
            />
            <StatCard
              label="Settled Pools"
              value={metrics.settledPools}
              icon={CheckCircle}
              color="text-blue-400"
            />
            <StatCard
              label="Expired Pools"
              value={metrics.expiredPools}
              icon={Clock}
              color="text-yellow-400"
            />
            <StatCard
              label="Avg Pool Size"
              value={`${Math.round(metrics.averagePoolSize).toLocaleString()} STX`}
              icon={Target}
              color="text-pink-400"
            />
            <StatCard
              label="Platform Fees"
              value={`${Math.round(metrics.platformFees).toLocaleString()} STX`}
              icon={Activity}
              color="text-orange-400"
            />
          </div>
        ) : null}

        {/* Charts grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Volume chart */}
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-primary rounded-full" />
              Volume Over Time
            </h2>
            {isLoading ? (
              <Skeleton className="h-[300px]" />
            ) : (
              <VolumeBarChart data={filteredVolumeHistory} />
            )}
          </Card>

          {/* Pool breakdown */}
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-accent rounded-full" />
              Pool Status Distribution
            </h2>
            {isLoading ? (
              <Skeleton className="h-[300px]" />
            ) : metrics ? (
              <PoolBreakdownChart
                active={metrics.activePools}
                settled={metrics.settledPools}
                expired={metrics.expiredPools}
              />
            ) : null}
          </Card>
        </div>

        {/* Bottom section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pool status bars */}
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-green-500 rounded-full" />
              Pool Status
            </h2>
            {!isLoading && metrics && (
              <div className="space-y-4">
                {[
                  { label: 'Active', value: metrics.activePools, color: 'bg-green-500', total: metrics.totalPools },
                  { label: 'Settled', value: metrics.settledPools, color: 'bg-blue-500', total: metrics.totalPools },
                  { label: 'Expired', value: metrics.expiredPools, color: 'bg-yellow-500', total: metrics.totalPools },
                ].map(({ label, value, color, total }) => {
                  const pct = total > 0 ? (value / total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-bold">
                          {value}{' '}
                          <span className="text-muted-foreground font-normal">
                            ({pct.toFixed(1)}%)
                          </span>
                        </span>
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
            )}
          </Card>

          {/* Quick stats */}
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-purple-500 rounded-full" />
              Quick Stats
            </h2>
            {!isLoading && metrics && (
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Weekly Volume</span>
                  <span className="font-bold">{metrics.weeklyVolume.toLocaleString()} STX</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Monthly Volume</span>
                  <span className="font-bold">{metrics.monthlyVolume.toLocaleString()} STX</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Avg Settlement Time</span>
                  <span className="font-bold">{metrics.averageSettlementTime}h</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Dispute Rate</span>
                  <span className="font-bold">{metrics.disputeRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground text-sm">User Retention</span>
                  <span className="font-bold">{metrics.userRetentionRate.toFixed(1)}%</span>
                </div>
              </div>
            )}
          </Card>

          {/* Growth metrics */}
          <Card className="p-6 bg-card/40 backdrop-blur-md border-border/50">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-5 bg-pink-500 rounded-full" />
              Growth Metrics
            </h2>
            {!isLoading && metrics && (
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Volume Growth</span>
                  <span className={`font-bold ${metrics.volumeGrowthRate >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {metrics.volumeGrowthRate >= 0 ? '+' : ''}{metrics.volumeGrowthRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">User Growth</span>
                  <span className={`font-bold ${metrics.userGrowthRate >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {metrics.userGrowthRate >= 0 ? '+' : ''}{metrics.userGrowthRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Pool Growth</span>
                  <span className={`font-bold ${metrics.poolGrowthRate >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {metrics.poolGrowthRate >= 0 ? '+' : ''}{metrics.poolGrowthRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/30">
                  <span className="text-muted-foreground text-sm">Total Users</span>
                  <span className="font-bold">{metrics.totalUsers}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground text-sm">Active Users</span>
                  <span className="font-bold">{metrics.activeUsers}</span>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Empty state */}
        {!isLoading && !metrics && (
          <Card className="p-12 text-center bg-card/40 backdrop-blur-md border-border/50">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Analytics Data</h3>
            <p className="text-muted-foreground">
              Analytics data will appear here once pools are created and bets are placed.
            </p>
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
