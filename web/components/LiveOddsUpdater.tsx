/**
 * LiveOddsUpdater Component
 * Issue #1532: UX Iteration 2 - Real-time odds updates
 */
'use client';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface LiveOddsUpdaterProps {
  outcomeA: string;
  outcomeB: string;
  oddsA: number;
  oddsB: number;
  previousOddsA?: number;
  previousOddsB?: number;
}

export function LiveOddsUpdater({
  outcomeA,
  outcomeB,
  oddsA,
  oddsB,
  previousOddsA,
  previousOddsB,
}: LiveOddsUpdaterProps) {
  const oddsAChanged = previousOddsA && previousOddsA !== oddsA;
  const oddsBChanged = previousOddsB && previousOddsB !== oddsB;
  const oddsAIncreased = oddsAChanged && oddsA > previousOddsA;
  const oddsBIncreased = oddsBChanged && oddsB > previousOddsB;

  return (
    <div className="p-4 rounded-lg bg-gradient-to-r from-primary/5 to-transparent border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-primary animate-pulse" />
        <h4 className="text-sm font-semibold">Live Odds</h4>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between p-2 rounded bg-muted/30">
          <span className="font-medium text-green-400">{outcomeA}</span>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{oddsA}%</span>
            {oddsAChanged && (
              <span className={oddsAIncreased ? 'text-green-400' : 'text-red-400'}>
                {oddsAIncreased ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between p-2 rounded bg-muted/30">
          <span className="font-medium text-red-400">{outcomeB}</span>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{oddsB}%</span>
            {oddsBChanged && (
              <span className={oddsBIncreased ? 'text-green-400' : 'text-red-400'}>
                {oddsBIncreased ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
