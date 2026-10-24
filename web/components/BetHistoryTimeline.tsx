/**
 * BetHistoryTimeline Component
 * 
 * Issue #1524: UX Improvement Iteration 4 - Visual bet history
 */

'use client';

import { TrendingUp, Check, X, Clock, DollarSign } from 'lucide-react';

interface Bet {
  id: string;
  poolId: number;
  poolTitle: string;
  outcome: string;
  amount: string;
  placedAt: number;
  status: 'pending' | 'won' | 'lost' | 'cancelled';
  payout?: string;
}

interface BetHistoryTimelineProps {
  bets: Bet[];
  maxItems?: number;
}

export function BetHistoryTimeline({
  bets,
  maxItems = 10,
}: BetHistoryTimelineProps) {
  const displayBets = bets.slice(0, maxItems);

  const getStatusIcon = (status: Bet['status']) => {
    switch (status) {
      case 'won':
        return <Check className="w-4 h-4 text-green-400" aria-hidden="true" />;
      case 'lost':
        return <X className="w-4 h-4 text-red-400" aria-hidden="true" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-400" aria-hidden="true" />;
      default:
        return <X className="w-4 h-4 text-gray-400" aria-hidden="true" />;
    }
  };

  const getStatusColor = (status: Bet['status']) => {
    switch (status) {
      case 'won':
        return 'border-green-400/50 bg-green-400/10';
      case 'lost':
        return 'border-red-400/50 bg-red-400/10';
      case 'pending':
        return 'border-yellow-400/50 bg-yellow-400/10';
      default:
        return 'border-gray-400/50 bg-gray-400/10';
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (displayBets.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
        <p>No betting history yet</p>
        <p className="text-sm mt-1">Your bet history will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <TrendingUp className="w-5 h-5" aria-hidden="true" />
        Bet History
      </h3>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-border/50" aria-hidden="true" />

        <div className="space-y-4">
          {displayBets.map((bet, index) => (
            <div key={bet.id} className="relative pl-14">
              {/* Timeline dot */}
              <div
                className={`absolute left-0 w-12 h-12 rounded-full border-2 ${getStatusColor(
                  bet.status
                )} flex items-center justify-center`}
              >
                {getStatusIcon(bet.status)}
              </div>

              {/* Bet card */}
              <div className="glass p-4 rounded-lg hover:border-primary/50 transition-all">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <h4 className="font-semibold line-clamp-1">{bet.poolTitle}</h4>
                    <p className="text-sm text-muted-foreground">
                      Pool #{bet.poolId}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded capitalize ${
                      bet.status === 'won'
                        ? 'bg-green-400/10 text-green-400'
                        : bet.status === 'lost'
                          ? 'bg-red-400/10 text-red-400'
                          : 'bg-yellow-400/10 text-yellow-400'
                    }`}
                  >
                    {bet.status}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Prediction</span>
                    <span className="font-medium truncate max-w-[150px]">
                      {bet.outcome}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Bet Amount</span>
                    <span className="font-semibold flex items-center gap-1">
                      <DollarSign className="w-3 h-3" aria-hidden="true" />
                      {bet.amount} XLM
                    </span>
                  </div>
                  {bet.payout && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Payout</span>
                      <span className="font-bold text-green-400 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" aria-hidden="true" />
                        {bet.payout} XLM
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {formatDate(bet.placedAt)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {bets.length > maxItems && (
        <button
          type="button"
          className="w-full py-2 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
        >
          View All Bets ({bets.length})
        </button>
      )}
    </div>
  );
}
