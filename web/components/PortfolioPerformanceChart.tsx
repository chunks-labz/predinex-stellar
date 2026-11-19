/**
 * PortfolioPerformanceChart Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Portfolio performance visualization
 */

'use client';

import { TrendingUp, TrendingDown, DollarSign, Percent } from 'lucide-react';
import { useMemo } from 'react';

interface PerformanceData {
  totalBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  totalWagered: string;
  totalWinnings: string;
  netProfit: string;
  winRate: number;
  roi: number;
}

interface PortfolioPerformanceChartProps {
  data: PerformanceData;
}

export function PortfolioPerformanceChart({
  data,
}: PortfolioPerformanceChartProps) {
  const stats = useMemo(() => {
    const isProfit = parseFloat(data.netProfit) >= 0;
    const profitPercent = data.roi;

    return {
      isProfit,
      profitPercent,
      winRateColor:
        data.winRate >= 70
          ? 'text-green-400'
          : data.winRate >= 50
            ? 'text-yellow-400'
            : 'text-red-400',
    };
  }, [data]);

  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Portfolio Performance</h2>
        <div
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg ${
            stats.isProfit
              ? 'bg-green-400/10 text-green-400'
              : 'bg-red-400/10 text-red-400'
          }`}
        >
          {stats.isProfit ? (
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <TrendingDown className="w-4 h-4" aria-hidden="true" />
          )}
          <span className="font-semibold">
            {stats.isProfit ? '+' : ''}
            {stats.profitPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm">Total Wagered</span>
          </div>
          <p className="text-2xl font-bold">{data.totalWagered} XLM</p>
        </div>

        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <DollarSign className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm">Total Winnings</span>
          </div>
          <p className="text-2xl font-bold text-green-400">
            {data.totalWinnings} XLM
          </p>
        </div>

        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <TrendingUp className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm">Net Profit</span>
          </div>
          <p
            className={`text-2xl font-bold ${
              stats.isProfit ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {stats.isProfit ? '+' : ''}
            {data.netProfit} XLM
          </p>
        </div>

        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-2 text-muted-foreground">
            <Percent className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm">Win Rate</span>
          </div>
          <p className={`text-2xl font-bold ${stats.winRateColor}`}>
            {data.winRate.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Bet Distribution */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Bet Distribution
        </h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Won</span>
            <span className="font-semibold text-green-400">
              {data.wonBets} ({((data.wonBets / data.totalBets) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Lost</span>
            <span className="font-semibold text-red-400">
              {data.lostBets} ({((data.lostBets / data.totalBets) * 100).toFixed(0)}%)
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Pending</span>
            <span className="font-semibold text-yellow-400">
              {data.pendingBets} ({((data.pendingBets / data.totalBets) * 100).toFixed(0)}%)
            </span>
          </div>
        </div>

        {/* Visual Bar */}
        <div className="h-4 bg-muted/30 rounded-full overflow-hidden flex">
          <div
            className="bg-green-400 transition-all duration-300"
            style={{ width: `${(data.wonBets / data.totalBets) * 100}%` }}
            role="progressbar"
            aria-valuenow={(data.wonBets / data.totalBets) * 100}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Won bets: ${data.wonBets}`}
          />
          <div
            className="bg-red-400 transition-all duration-300"
            style={{ width: `${(data.lostBets / data.totalBets) * 100}%` }}
            role="progressbar"
            aria-valuenow={(data.lostBets / data.totalBets) * 100}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Lost bets: ${data.lostBets}`}
          />
          <div
            className="bg-yellow-400 transition-all duration-300"
            style={{ width: `${(data.pendingBets / data.totalBets) * 100}%` }}
            role="progressbar"
            aria-valuenow={(data.pendingBets / data.totalBets) * 100}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Pending bets: ${data.pendingBets}`}
          />
        </div>
      </div>
    </div>
  );
}
