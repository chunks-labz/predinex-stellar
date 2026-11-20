'use client';

import Link from 'next/link';
import { AlertCircle, ExternalLink } from 'lucide-react';
import type { Pool } from '../lib/adapters/types';
import { stroopsToUnits, TOKEN_SYMBOL } from '@/app/lib/formatting';

interface UserBet {
  pool: Pool;
  amountA: number;
  amountB: number;
  totalBet: number;
}

interface ActiveBetsProps {
  bets: UserBet[];
}

export default function ActiveBets({ bets }: ActiveBetsProps) {
  if (bets.length === 0) {
    return (
      <div className="glass p-8 rounded-xl border border-border text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground mb-4">
          No active bets. Start betting to see them here!
        </p>
        <Link
          href="/markets"
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          Explore markets <ExternalLink className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {bets.map((bet) => (
        <Link key={bet.pool.id} href={`/markets/${bet.pool.id}`}>
          <div className="glass p-6 rounded-xl hover:border-primary/50 transition-all cursor-pointer group h-full hover:shadow-lg">
            <div className="flex justify-between items-start mb-4">
              <span className="text-xs font-mono text-muted-foreground">
                #POOL-{bet.pool.id}
              </span>
              <span className="px-2 py-1 rounded bg-green-500/10 text-green-500 text-xs font-medium animate-pulse">
                Active
              </span>
            </div>

            <h3 className="text-lg font-bold mb-3 group-hover:text-primary transition-colors line-clamp-2">
              {bet.pool.title}
            </h3>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Your Bet:</span>
                <span className="font-semibold text-lg">
                  {stroopsToUnits(bet.totalBet).toFixed(2)} {TOKEN_SYMBOL}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="text-muted-foreground">Betting On:</span>
                <span className="font-semibold">
                  {bet.amountA > 0 ? bet.pool.outcomeA : bet.pool.outcomeB}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
                <span>Pool Total:</span>
                <span>
                  {stroopsToUnits(bet.pool.totalA + bet.pool.totalB).toFixed(2)} {TOKEN_SYMBOL}
                </span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

