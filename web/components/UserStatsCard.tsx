/**
 * UserStatsCard Component
 * Issue #1532: UX Iteration 2 - User statistics display
 */
'use client';
import { Trophy, Target, TrendingUp, DollarSign } from 'lucide-react';

interface UserStatsCardProps {
  totalBets: number;
  winRate: number;
  totalWinnings: string;
  rank?: number;
}

export function UserStatsCard({ totalBets, winRate, totalWinnings, rank }: UserStatsCardProps) {
  return (
    <div className="glass p-6 rounded-xl">
      <h3 className="text-lg font-bold mb-4">Your Stats</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground text-xs">
            <Target className="w-3 h-3" />
            <span>Total Bets</span>
          </div>
          <p className="text-xl font-bold">{totalBets}</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground text-xs">
            <TrendingUp className="w-3 h-3" />
            <span>Win Rate</span>
          </div>
          <p className="text-xl font-bold text-green-400">{winRate}%</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1 text-muted-foreground text-xs">
            <DollarSign className="w-3 h-3" />
            <span>Winnings</span>
          </div>
          <p className="text-xl font-bold text-primary">{totalWinnings}</p>
        </div>
        {rank && (
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2 mb-1 text-muted-foreground text-xs">
              <Trophy className="w-3 h-3" />
              <span>Rank</span>
            </div>
            <p className="text-xl font-bold text-yellow-400">#{rank}</p>
          </div>
        )}
      </div>
    </div>
  );
}
