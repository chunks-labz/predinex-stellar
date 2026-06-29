'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Target, Trophy, Activity } from 'lucide-react';
import { UserPortfolio } from '@/app/lib/dashboard-types';
import { formatCurrency, formatPercentage, formatProfitLoss } from '@/app/lib/dashboard-utils';
import { selectPortfolioMetricCards } from '@/app/lib/dashboard-selectors';

interface PortfolioOverviewProps {
  portfolio: UserPortfolio;
  isLoading?: boolean;
}

export default function PortfolioOverview({ portfolio, isLoading = false }: PortfolioOverviewProps) {
  const profitLossData = useMemo(() => formatProfitLoss(portfolio.profitLoss), [portfolio.profitLoss]);
  const metrics = useMemo(() => selectPortfolioMetricCards(portfolio), [portfolio]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-muted/50 rounded w-48 animate-pulse"></div>
          <div className="h-4 bg-muted/50 rounded w-32 animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass p-6 rounded-xl animate-pulse">
              <div className="p-3 rounded-lg bg-muted/20 w-12 h-12 mb-4"></div>
              <div className="space-y-2">
                <div className="h-3 bg-muted/50 rounded w-24"></div>
                <div className="h-8 bg-muted/50 rounded w-32"></div>
                <div className="h-2 bg-muted/50 rounded w-28"></div>
              </div>
            </div>
          ))}
        </div>
        <div className="glass p-6 rounded-xl animate-pulse">
          <div className="h-6 bg-muted/50 rounded w-40 mb-4"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="h-8 bg-muted/50 rounded w-16 mb-2"></div>
                <div className="h-3 bg-muted/50 rounded w-20"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const renderedMetrics = useMemo(
    () =>
      metrics.map((metric) => {
        const icon =
          metric.title === 'Total Portfolio Value'
            ? DollarSign
            : metric.title === 'Active Bets'
              ? Activity
              : metric.title === 'Total Wagered'
                ? Target
                : metric.title === 'Total Winnings'
                  ? Trophy
                  : metric.title === 'Claimable Amount'
                    ? DollarSign
                    : metric.title === 'Profit/Loss'
                      ? profitLossData.isProfit
                        ? TrendingUp
                        : TrendingDown
                      : DollarSign;

        const color =
          metric.tone === 'blue'
            ? 'text-blue-500'
            : metric.tone === 'green'
              ? 'text-green-500'
              : metric.tone === 'purple'
                ? 'text-purple-500'
                : metric.tone === 'yellow'
                  ? 'text-yellow-500'
                  : metric.tone === 'red'
                    ? 'text-red-500'
                    : 'text-muted-foreground';

        const bgColor =
          metric.tone === 'blue'
            ? 'bg-blue-500/10'
            : metric.tone === 'green'
              ? 'bg-green-500/10'
              : metric.tone === 'purple'
                ? 'bg-purple-500/10'
                : metric.tone === 'yellow'
                  ? 'bg-yellow-500/10'
                  : metric.tone === 'red'
                    ? 'bg-red-500/10'
                    : 'bg-muted/10';

        return { ...metric, icon, color, bgColor };
      }),
    [metrics, profitLossData.isProfit],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Portfolio Overview</h2>
        <div className="text-sm text-muted-foreground">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {renderedMetrics.map((metric, index) => {
          const Icon = metric.icon;

          return (
            <div key={index} className="glass p-6 rounded-xl hover:border-primary/50 transition-all duration-200">
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-lg ${metric.bgColor}`}>
                  <Icon className={`w-6 h-6 ${metric.color}`} />
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">{metric.title}</p>
                <p className={`text-2xl font-bold ${metric.color}`}>{metric.value}</p>
                <p className="text-xs text-muted-foreground">{metric.subtitle}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass p-4 sm:p-6 rounded-xl">
        <h3 className="text-lg font-semibold mb-4 text-center sm:text-left">Performance Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-500">
              {formatPercentage(portfolio.winRate)}
            </div>
            <div className="text-sm text-muted-foreground">Win Rate</div>
          </div>

          <div className="text-center">
            <div className={`text-2xl font-bold ${profitLossData.isProfit ? 'text-green-500' : profitLossData.isBreakeven ? 'text-muted-foreground' : 'text-red-500'}`}>
              {portfolio.totalWagered > 0 ? formatPercentage((portfolio.profitLoss / portfolio.totalWagered) * 100) : '0%'}
            </div>
            <div className="text-sm text-muted-foreground">ROI</div>
          </div>

          <div className="text-center">
            <div className="text-2xl font-bold text-purple-500">
              {portfolio.totalBets > 0 ? formatCurrency(portfolio.totalWagered / portfolio.totalBets) : formatCurrency(0)}
            </div>
            <div className="text-sm text-muted-foreground">Avg Bet Size</div>
          </div>
        </div>
      </div>
    </div>
  );
}
