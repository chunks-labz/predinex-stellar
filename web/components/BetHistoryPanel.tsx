/**
 * BetHistoryPanel Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - User bet history panel
 * Displays user's betting history with filtering and stats
 */

'use client';

import { History, TrendingUp, TrendingDown, Clock, DollarSign, Award } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';

interface Bet {
  id: string;
  poolId: number;
  poolTitle: string;
  outcome: string;
  amount: string;
  placedAt: number;
  status: 'pending' | 'won' | 'lost' | 'claimed';
  winnings?: string;
}

interface BetHistoryPanelProps {
  userAddress: string;
}

export function BetHistoryPanel({ userAddress }: BetHistoryPanelProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'won' | 'lost'>('all');
  const [isLoading, setIsLoading] = useState(false);

  // Mock data - replace with actual API call
  const mockBets: Bet[] = [
    {
      id: '1',
      poolId: 123,
      poolTitle: 'Will Bitcoin reach $100k by end of year?',
      outcome: 'Yes',
      amount: '50',
      placedAt: Date.now() - 86400000,
      status: 'pending',
    },
    {
      id: '2',
      poolId: 124,
      poolTitle: 'Super Bowl Winner 2024',
      outcome: 'Team A',
      amount: '100',
      placedAt: Date.now() - 172800000,
      status: 'won',
      winnings: '180',
    },
    {
      id: '3',
      poolId: 125,
      poolTitle: 'Will ETH flip BTC?',
      outcome: 'No',
      amount: '25',
      placedAt: Date.now() - 259200000,
      status: 'lost',
    },
  ];

  const filteredBets = filter === 'all' 
    ? mockBets 
    : mockBets.filter(bet => bet.status === filter);

  const stats = {
    totalBets: mockBets.length,
    activeBets: mockBets.filter(b => b.status === 'pending').length,
    wonBets: mockBets.filter(b => b.status === 'won').length,
    lostBets: mockBets.filter(b => b.status === 'lost').length,
    totalWagered: mockBets.reduce((sum, b) => sum + parseFloat(b.amount), 0),
    totalWinnings: mockBets
      .filter(b => b.winnings)
      .reduce((sum, b) => sum + parseFloat(b.winnings!), 0),
  };

  const winRate = stats.totalBets > 0 
    ? ((stats.wonBets / (stats.wonBets + stats.lostBets)) * 100).toFixed(1)
    : '0';

  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'Recently';
  };

  const getStatusBadge = (status: Bet['status']) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 rounded text-xs bg-yellow-500/10 text-yellow-500">Pending</span>;
      case 'won':
        return <span className="px-2 py-1 rounded text-xs bg-green-500/10 text-green-500">Won</span>;
      case 'lost':
        return <span className="px-2 py-1 rounded text-xs bg-red-500/10 text-red-500">Lost</span>;
      case 'claimed':
        return <span className="px-2 py-1 rounded text-xs bg-blue-500/10 text-blue-500">Claimed</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <History className="w-6 h-6 text-primary" aria-hidden="true" />
        <h2 className="text-2xl font-bold">Your Bet History</h2>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Total Wagered</span>
          </div>
          <p className="text-xl font-bold">{stats.totalWagered.toFixed(2)} XLM</p>
        </div>

        <div className="glass p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Total Winnings</span>
          </div>
          <p className="text-xl font-bold text-green-400">{stats.totalWinnings.toFixed(2)} XLM</p>
        </div>

        <div className="glass p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Award className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Win Rate</span>
          </div>
          <p className="text-xl font-bold">{winRate}%</p>
        </div>

        <div className="glass p-4 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="text-xs text-muted-foreground">Active Bets</span>
          </div>
          <p className="text-xl font-bold">{stats.activeBets}</p>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'pending', 'won', 'lost'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/30 hover:bg-muted/50'
            }`}
            aria-pressed={filter === f}
          >
            {f === 'all' ? 'All Bets' : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== 'all' && (
              <span className="ml-1 text-xs opacity-70">
                ({f === 'pending' ? stats.activeBets : f === 'won' ? stats.wonBets : stats.lostBets})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bet List */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass p-4 rounded-lg animate-pulse">
              <div className="h-4 bg-muted/50 rounded w-3/4 mb-3" />
              <div className="h-3 bg-muted/50 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredBets.length === 0 ? (
        <div className="glass p-8 rounded-lg text-center">
          <History className="w-12 h-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
          <p className="text-muted-foreground">
            No {filter !== 'all' ? filter : ''} bets found
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBets.map((bet) => (
            <Link
              key={bet.id}
              href={`/markets/${bet.poolId}`}
              className="glass p-4 rounded-lg hover:border-primary/50 transition-all block group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono text-muted-foreground">
                      #POOL-{bet.poolId}
                    </span>
                    {getStatusBadge(bet.status)}
                  </div>
                  <h4 className="font-semibold mb-1 group-hover:text-primary transition-colors line-clamp-1">
                    {bet.poolTitle}
                  </h4>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="font-medium text-primary">{bet.outcome}</span>
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" aria-hidden="true" />
                      {bet.amount} XLM
                    </span>
                    {bet.winnings && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-green-400">
                          <TrendingUp className="w-3 h-3" aria-hidden="true" />
                          Won {bet.winnings} XLM
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {getTimeAgo(bet.placedAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
