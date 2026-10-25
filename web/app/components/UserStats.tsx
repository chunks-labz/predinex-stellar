'use client';

import { TrendingUp, Trophy, Clock, DollarSign, Target } from 'lucide-react';
import { stroopsToUnits, TOKEN_SYMBOL } from '@/app/lib/formatting';

interface UserStatsProps {
  totalBet: number;
  totalWinnings: number;
  activeBetsCount: number;
  settledBetsCount: number;
  winRate: number;
  totalPoolsParticipated: number;
}

export default function UserStats({
  totalBet,
  totalWinnings,
  activeBetsCount,
  settledBetsCount,
  winRate,
  totalPoolsParticipated,
}: UserStatsProps) {
  const stats = [
    {
      label: 'Total Bet',
      value: `${stroopsToUnits(totalBet).toFixed(2)} {TOKEN_SYMBOL}`,
      icon: DollarSign,
      color: 'text-blue-400',
    },
    {
      label: 'Total Winnings',
      value: `${stroopsToUnits(totalWinnings).toFixed(2)} {TOKEN_SYMBOL}`,
      icon: Trophy,
      color: 'text-green-400',
    },
    {
      label: 'Active Bets',
      value: activeBetsCount.toString(),
      icon: Clock,
      color: 'text-yellow-400',
    },
    {
      label: 'Settled Bets',
      value: settledBetsCount.toString(),
      icon: Target,
      color: 'text-purple-400',
    },
    {
      label: 'Win Rate',
      value: `${winRate.toFixed(1)}%`,
      icon: TrendingUp,
      color: 'text-accent',
    },
    {
      label: 'Pools Participated',
      value: totalPoolsParticipated.toString(),
      icon: TrendingUp,
      color: 'text-cyan-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-12">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <div key={index} className="glass p-6 rounded-xl border border-border hover:border-primary/50 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <Icon className={`w-5 h-5 ${stat.color}`} />
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
            <p className={`text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}

