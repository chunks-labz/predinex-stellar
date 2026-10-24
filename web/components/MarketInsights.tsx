/**
 * MarketInsights Component
 * 
 * Issue #1525: UX Improvement - Market insights panel
 * Provides additional context and analytics for prediction markets
 */

'use client';

import { TrendingUp, Users, Activity, Clock, DollarSign, BarChart3 } from 'lucide-react';

interface MarketInsightsProps {
  totalVolume: string;
  participantCount: number;
  avgBetSize: string;
  timeActive: number; // in seconds
  volumeTrend: 'up' | 'down' | 'stable';
  popularOutcome: string;
  popularOutcomePercentage: number;
}

export function MarketInsights({
  totalVolume,
  participantCount,
  avgBetSize,
  timeActive,
  volumeTrend,
  popularOutcome,
  popularOutcomePercentage,
}: MarketInsightsProps) {
  const daysActive = Math.floor(timeActive / (24 * 60 * 60));
  const hoursActive = Math.floor((timeActive % (24 * 60 * 60)) / (60 * 60));

  const getTrendIcon = () => {
    switch (volumeTrend) {
      case 'up':
        return <TrendingUp className="w-4 h-4 text-green-400" aria-hidden="true" />;
      case 'down':
        return <TrendingUp className="w-4 h-4 text-red-400 rotate-180" aria-hidden="true" />;
      default:
        return <Activity className="w-4 h-4 text-yellow-400" aria-hidden="true" />;
    }
  };

  const getTrendText = () => {
    switch (volumeTrend) {
      case 'up':
        return 'Volume Trending Up';
      case 'down':
        return 'Volume Declining';
      default:
        return 'Stable Activity';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
        <BarChart3 className="w-5 h-5 text-primary" aria-hidden="true" />
        <h3 className="font-semibold text-lg">Market Insights</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Total Volume */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Total Volume</span>
          </div>
          <p className="text-lg font-bold">{totalVolume}</p>
        </div>

        {/* Participants */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Participants</span>
          </div>
          <p className="text-lg font-bold">{participantCount}</p>
        </div>

        {/* Average Bet */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Avg Bet</span>
          </div>
          <p className="text-lg font-bold">{avgBetSize}</p>
        </div>

        {/* Time Active */}
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Active For</span>
          </div>
          <p className="text-lg font-bold">
            {daysActive > 0 ? `${daysActive}d` : `${hoursActive}h`}
          </p>
        </div>
      </div>

      {/* Volume Trend */}
      <div className="p-3 rounded-lg bg-gradient-to-r from-primary/10 to-transparent border border-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <span className="text-sm font-medium">{getTrendText()}</span>
          </div>
        </div>
      </div>

      {/* Popular Outcome */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-primary" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">
            Crowd Prediction
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold truncate max-w-[150px]">
            {popularOutcome}
          </span>
          <span className="text-lg font-bold text-primary">
            {popularOutcomePercentage}%
          </span>
        </div>
        <div className="mt-2 h-2 bg-muted/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${popularOutcomePercentage}%` }}
            role="progressbar"
            aria-valuenow={popularOutcomePercentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${popularOutcome} has ${popularOutcomePercentage}% of bets`}
          />
        </div>
      </div>
    </div>
  );
}
