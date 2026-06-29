import { BarChart3, Calendar, DollarSign, Target, Trophy, TrendingUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlatformMetrics, UserPortfolio } from './dashboard-types';
import { formatCurrency, formatPercentage, formatProfitLoss } from './dashboard-utils';

export interface PortfolioMetricCard {
  title: string;
  value: string;
  subtitle: string;
  tone: 'blue' | 'green' | 'yellow' | 'red' | 'muted' | 'purple';
}

export interface PlatformMetricCard {
  title: string;
  value: string;
  subtitle: string;
  tone: 'blue' | 'green' | 'purple' | 'yellow' | 'orange';
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

export interface PlatformDistributionItem {
  label: string;
  value: number;
  percentage: number;
  tone: 'green' | 'blue' | 'red';
}

export function selectPortfolioMetricCards(portfolio: UserPortfolio): PortfolioMetricCard[] {
  const profitLoss = formatProfitLoss(portfolio.profitLoss);

  return [
    {
      title: 'Total Portfolio Value',
      value: formatCurrency(portfolio.totalWagered + portfolio.profitLoss),
      subtitle: `${portfolio.totalBets} total bets`,
      tone: 'blue',
    },
    {
      title: 'Active Bets',
      value: portfolio.activeBets.toString(),
      subtitle: formatCurrency(
        portfolio.totalBets > 0 ? portfolio.totalWagered - (portfolio.totalBets - portfolio.activeBets) * (portfolio.totalWagered / portfolio.totalBets) : 0,
      ),
      tone: 'green',
    },
    {
      title: 'Total Wagered',
      value: formatCurrency(portfolio.totalWagered),
      subtitle: `Avg: ${formatCurrency(portfolio.totalBets > 0 ? portfolio.totalWagered / portfolio.totalBets : 0)} per bet`,
      tone: 'purple',
    },
    {
      title: 'Total Winnings',
      value: formatCurrency(portfolio.totalWinnings),
      subtitle: `${formatPercentage(portfolio.winRate)} win rate`,
      tone: 'yellow',
    },
    {
      title: 'Claimable Amount',
      value: formatCurrency(portfolio.totalClaimable),
      subtitle: portfolio.totalClaimable > 0 ? 'Ready to claim' : 'No pending claims',
      tone: portfolio.totalClaimable > 0 ? 'green' : 'muted',
    },
    {
      title: 'Profit/Loss',
      value: profitLoss.formatted,
      subtitle: profitLoss.isBreakeven ? 'Break even' : profitLoss.isProfit ? 'Profitable' : 'In loss',
      tone: profitLoss.isBreakeven ? 'muted' : profitLoss.isProfit ? 'green' : 'red',
    },
  ];
}

export function selectPlatformMetricCards(metrics: PlatformMetrics) {
  return [
    {
      title: 'Total Markets',
      value: metrics.totalPools.toString(),
      subtitle: `${metrics.activePools} currently active`,
      tone: 'blue' as const,
      icon: Target,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Total Volume',
      value: formatCurrency(metrics.totalVolume),
      subtitle: `Avg: ${formatCurrency(metrics.averageMarketSize)} per market`,
      tone: 'green' as const,
      icon: DollarSign,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      title: 'Active Users',
      value: metrics.totalUsers.toString(),
      subtitle: `${metrics.totalBets} total bets placed`,
      tone: 'purple' as const,
      icon: Users,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      title: 'Total Winnings',
      value: formatCurrency(metrics.totalWinnings),
      subtitle: `${formatPercentage((metrics.totalWinnings / Math.max(metrics.totalVolume, 1)) * 100)} of volume`,
      tone: 'yellow' as const,
      icon: Trophy,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
    },
  ];
}

export function selectMarketDistribution(metrics: PlatformMetrics): PlatformDistributionItem[] {
  const totalPools = Math.max(metrics.totalPools, 1);

  return [
    { label: 'Active', value: metrics.activePools, percentage: (metrics.activePools / totalPools) * 100, tone: 'green' },
    { label: 'Settled', value: metrics.settledPools, percentage: (metrics.settledPools / totalPools) * 100, tone: 'blue' },
    { label: 'Expired', value: metrics.expiredPools, percentage: (metrics.expiredPools / totalPools) * 100, tone: 'red' },
  ];
}

export function selectVolumeMetrics(metrics: PlatformMetrics) {
  return [
    { label: 'Daily', value: metrics.dailyVolume, icon: Calendar },
    { label: 'Weekly', value: metrics.weeklyVolume, icon: BarChart3 },
    { label: 'Monthly', value: metrics.monthlyVolume, icon: TrendingUp },
  ];
}
