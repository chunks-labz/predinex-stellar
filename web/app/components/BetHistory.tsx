'use client';

import Link from 'next/link';
import { Clock, CheckCircle2, XCircle } from 'lucide-react';
import type { Pool } from '../lib/adapters/types';
import { stroopsToUnits, TOKEN_SYMBOL } from '@/app/lib/formatting';

interface UserBet {
  pool: Pool;
  amountA: number;
  amountB: number;
  totalBet: number;
}

interface BetHistoryProps {
  bets: UserBet[];
}

export default function BetHistory({ bets }: BetHistoryProps) {
  if (bets.length === 0) {
    return (
      <div className="glass p-8 rounded-xl border border-border text-center">
        <Clock className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">
          No betting history yet. Place your first bet to get started!
        </p>
      </div>
    );
  }

  const getResultIcon = (bet: UserBet) => {
    if (!bet.pool.settled) return null;
    const won = (bet.pool.winningOutcome === 0 && bet.amountA > 0) ||
                (bet.pool.winningOutcome === 1 && bet.amountB > 0);
    return won ? (
      <CheckCircle2 className="w-5 h-5 text-green-400" />
    ) : (
      <XCircle className="w-5 h-5 text-red-400" />
    );
  };

  return (
    <div className="glass rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-6 py-4 text-left text-sm font-semibold">Pool</th>
              <th className="px-6 py-4 text-left text-sm font-semibold">Amount</th>
              <th className="px-6 py-4 text-left text-sm font-semibold">Outcome</th>
              <th className="px-6 py-4 text-left text-sm font-semibold">Status</th>
              <th className="px-6 py-4 text-left text-sm font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {bets.map((bet) => (
              <tr
                key={bet.pool.id}
                className="border-b border-border hover:bg-muted/50 transition-colors"
              >
                <td className="px-6 py-4">
                  <Link
                    href={`/markets/${bet.pool.id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {bet.pool.title.length > 40
                      ? `${bet.pool.title.slice(0, 40)}...`
                      : bet.pool.title}
                  </Link>
                </td>
                <td className="px-6 py-4 font-semibold">
                  {stroopsToUnits(bet.totalBet).toFixed(2)} {TOKEN_SYMBOL}
                </td>
                <td className="px-6 py-4">
                  {bet.amountA > 0 ? bet.pool.outcomeA : bet.pool.outcomeB}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      bet.pool.settled
                        ? 'bg-zinc-800 text-zinc-400'
                        : 'bg-green-500/10 text-green-500'
                    }`}
                  >
                    {bet.pool.settled ? 'Settled' : 'Active'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  {bet.pool.settled ? (
                    <div className="flex items-center gap-2">
                      {getResultIcon(bet)}
                      <span
                        className={
                          (bet.pool.winningOutcome === 0 && bet.amountA > 0) ||
                          (bet.pool.winningOutcome === 1 && bet.amountB > 0)
                            ? 'text-green-400 font-semibold'
                            : 'text-red-400 font-semibold'
                        }
                      >
                        {(bet.pool.winningOutcome === 0 && bet.amountA > 0) ||
                        (bet.pool.winningOutcome === 1 && bet.amountB > 0)
                          ? 'Won'
                          : 'Lost'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Pending</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

