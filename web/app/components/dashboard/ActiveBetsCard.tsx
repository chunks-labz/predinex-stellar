'use client';

import Link from 'next/link';
import { Clock, TrendingUp, ExternalLink, Gift } from 'lucide-react';
import type { UserBet } from '../../lib/dashboard-types';
import type { ClaimTxState } from '../../lib/hooks/useClaimWinnings';
import { formatPercentage, formatCurrency } from '../../lib/dashboard-utils';
import ClaimAllButton from '../../../components/ClaimAllButton';

interface ActiveBetsCardProps {
  bets: UserBet[];
  claimTransactions: Map<number, ClaimTxState>;
  onClaim: (poolId: number) => void;
  userAddress?: string | null;
  onClaimAllSuccess?: () => void;
  isLoading?: boolean;
}

export default function ActiveBetsCard({
  bets,
  claimTransactions,
  onClaim,
  userAddress,
  onClaimAllSuccess,
  isLoading = false
}: ActiveBetsCardProps) {
  if (isLoading) {
    return (
      <div className="glass p-6 rounded-xl">
        <div className="h-6 bg-muted/50 rounded mb-4"></div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 bg-muted/30 rounded-lg animate-pulse">
              <div className="h-4 bg-muted/50 rounded mb-2"></div>
              <div className="h-3 bg-muted/50 rounded w-2/3 mb-2"></div>
              <div className="h-3 bg-muted/50 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activeBets = bets.filter(bet => bet.status === 'active');
  const claimableBets = bets.filter(bet => bet.claimStatus === 'unclaimed' && bet.claimableAmount && bet.claimableAmount > 0);

  return (
    <div className="space-y-6">
      {/* Active Bets Section */}
      <div className="glass p-6 rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Active Bets</h3>
          <span className="text-sm text-muted-foreground">
            {activeBets.length} active
          </span>
        </div>

        {activeBets.length === 0 ? (
          <div className="text-center py-8">
            <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-2">No active bets</p>
            <p className="text-sm text-muted-foreground">
              <Link href="/markets" className="text-primary hover:underline">
                Browse markets
              </Link> to place your first bet
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeBets.map((bet) => (
              <div key={`${bet.poolId}-${bet.outcomeChosen}`} className="p-4 bg-muted/30 rounded-lg hover:bg-muted/40 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <Link
                      href={`/markets/${bet.poolId}`}
                      className="font-medium hover:text-primary transition-colors flex items-center gap-2"
                    >
                      {bet.marketTitle}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    <p className="text-sm text-muted-foreground mt-1">
                      Betting on: <span className="font-medium text-foreground">{bet.outcomeName}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{formatCurrency(bet.amountBet)}</div>
                    <div className="text-xs text-muted-foreground">wagered</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Current Odds:</span>
                    <span className="ml-2 font-medium">{formatPercentage(bet.currentOdds)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Potential Win:</span>
                    <span className="ml-2 font-medium text-green-500">
                      +{formatCurrency(bet.potentialWinnings)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>Bet placed {new Date(bet.betTimestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claimable Winnings Section */}
      {claimableBets.length > 0 && (
        <div className="glass p-6 rounded-xl border-green-500/20">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-500" />
              <h3 className="text-lg font-semibold text-green-500">Claimable Winnings</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {claimableBets.length} ready to claim
              </span>
              <ClaimAllButton
                claimablePools={claimableBets.map((bet) => ({
                  poolId: bet.poolId,
                  marketTitle: bet.marketTitle,
                }))}
                userAddress={userAddress}
                onClaimSuccess={onClaimAllSuccess}
              />
            </div>
          </div>

          <div className="space-y-4">
            {claimableBets.map((bet) => {
              const claimTx = claimTransactions.get(bet.poolId);
              const isClaimPending = claimTx?.status === 'pending';
              const isClaimFailed = claimTx?.status === 'failed';

              return (
                <div key={`${bet.poolId}-${bet.outcomeChosen}`} className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <Link
                        href={`/markets/${bet.poolId}`}
                        className="font-medium hover:text-primary transition-colors flex items-center gap-2"
                      >
                        {bet.marketTitle}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                      <p className="text-sm text-muted-foreground mt-1">
                        Won betting on: <span className="font-medium text-green-500">{bet.outcomeName}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-500">
                        {formatCurrency(bet.claimableAmount || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">claimable</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Original bet: {formatCurrency(bet.amountBet)}
                    </div>

                    <button
                      onClick={() => onClaim(bet.poolId)}
                      disabled={isClaimPending}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                    >
                      {isClaimPending ? 'Claiming...' : 'Claim Winnings'}
                    </button>
                  </div>

                  {isClaimFailed && claimTx?.error && (
                    <div className="mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500">
                      Failed to claim: {claimTx.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-muted/30 rounded-lg">
            <div className="text-sm font-medium mb-1">Total Claimable</div>
            <div className="text-2xl font-bold text-green-500">
              {formatCurrency(claimableBets.reduce((sum, bet) => sum + (bet.claimableAmount || 0), 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
