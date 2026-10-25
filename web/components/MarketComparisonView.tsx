/**
 * MarketComparisonView Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Side-by-side market comparison
 */

'use client';

import { X, TrendingUp, Users, Clock, DollarSign, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface Market {
  id: number;
  title: string;
  outcomeA: string;
  outcomeB: string;
  oddsA: number;
  oddsB: number;
  totalVolume: string;
  participants: number;
  timeRemaining: string;
  status: string;
}

interface MarketComparisonViewProps {
  markets: Market[];
  onRemove: (id: number) => void;
  onClear: () => void;
}

export function MarketComparisonView({
  markets,
  onRemove,
  onClear,
}: MarketComparisonViewProps) {
  if (markets.length === 0) {
    return null;
  }

  return (
    <div className="glass p-6 rounded-xl border">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Compare Markets</h2>
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {markets.map((market) => (
          <div key={market.id} className="relative p-4 rounded-lg bg-muted/30 border border-border/50">
            <button
              type="button"
              onClick={() => onRemove(market.id)}
              className="absolute top-2 right-2 p-1 rounded hover:bg-muted/50 transition-colors"
              aria-label={`Remove market ${market.id} from comparison`}
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="font-semibold mb-3 pr-6 line-clamp-2">{market.title}</h3>

            <div className="space-y-3">
              {/* Outcomes */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-green-400 truncate">{market.outcomeA}</span>
                  <span className="font-semibold">{market.oddsA}%</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-red-400 truncate">{market.outcomeB}</span>
                  <span className="font-semibold">{market.oddsB}%</span>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-2 text-sm text-muted-foreground pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" aria-hidden="true" />
                    Volume
                  </span>
                  <span className="font-medium">{market.totalVolume}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" aria-hidden="true" />
                    Participants
                  </span>
                  <span className="font-medium">{market.participants}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    Time Left
                  </span>
                  <span className="font-medium">{market.timeRemaining}</span>
                </div>
              </div>

              {/* View Link */}
              <Link
                href={`/markets/${market.id}`}
                className="flex items-center justify-center gap-2 w-full mt-3 px-3 py-2 text-sm font-medium rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
              >
                View Market
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison Summary */}
      {markets.length >= 2 && (
        <div className="mt-6 p-4 rounded-lg bg-gradient-to-r from-primary/10 to-transparent border border-primary/20">
          <h4 className="font-semibold mb-2 text-sm">Quick Comparison</h4>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground block mb-1">Highest Volume</span>
              <span className="font-semibold">
                {markets.reduce((max, m) => 
                  parseFloat(m.totalVolume) > parseFloat(max.totalVolume) ? m : max
                ).title.substring(0, 20)}...
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1">Most Participants</span>
              <span className="font-semibold">
                {markets.reduce((max, m) => m.participants > max.participants ? m : max)
                  .title.substring(0, 20)}...
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block mb-1">Ending Soonest</span>
              <span className="font-semibold">
                {markets[0].title.substring(0, 20)}...
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
