'use client';

import { useState } from 'react';
import { Gift, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { UserBet } from '../../lib/dashboard-types';
import type { ClaimTxState } from '../../lib/hooks/useClaimWinnings';
import { formatCurrency } from '../../lib/dashboard-utils';
import { getNetworkConfig } from '../../lib/constants';
import TransactionReceipt, { TransactionReceiptData } from '@/components/TransactionReceipt';
import { Dialog } from '../../../components/ui/Dialog';

interface ClaimWinningsProps {
  claimableBets: UserBet[];
  claimTransactions: Map<number, ClaimTxState>;
  onClaim: (poolId: number) => void;
  onBatchClaim: (poolIds: number[]) => void;
  isLoading?: boolean;
}

export default function ClaimWinnings({ 
  claimableBets, 
  claimTransactions, 
  onClaim, 
  onBatchClaim, 
  isLoading = false 
}: ClaimWinningsProps) {
  const [selectedBets, setSelectedBets] = useState<Set<number>>(new Set());
  const [showBatchClaim, setShowBatchClaim] = useState(false);
  const [receiptData, setReceiptData] = useState<TransactionReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const totalClaimable = claimableBets.reduce((sum, bet) => sum + (bet.claimableAmount || 0), 0);
  const selectedClaimable = claimableBets
    .filter(bet => selectedBets.has(bet.poolId))
    .reduce((sum, bet) => sum + (bet.claimableAmount || 0), 0);

  const handleSelectBet = (poolId: number, selected: boolean) => {
    const newSelected = new Set(selectedBets);
    if (selected) {
      newSelected.add(poolId);
    } else {
      newSelected.delete(poolId);
    }
    setSelectedBets(newSelected);
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedBets(new Set(claimableBets.map(bet => bet.poolId)));
    } else {
      setSelectedBets(new Set());
    }
  };

  const handleViewReceipt = (bet: UserBet) => {
    const claimTx = claimTransactions.get(bet.poolId);
    if (!claimTx?.txId) return;

    const receipt: TransactionReceiptData = {
      txId: claimTx.txId,
      network: getNetworkConfig().network,
      marketId: bet.poolId,
      marketTitle: bet.marketTitle,
      type: 'claim',
      amount: bet.claimableAmount,
      outcome: bet.outcomeName,
      status: claimTx.status,
      error: claimTx.error,
      timestamp: bet.betTimestamp * 1000,
    };
    setReceiptData(receipt);
    setShowReceipt(true);
  };

  const handleBatchClaim = () => {
    const poolIds = Array.from(selectedBets);
    onBatchClaim(poolIds);
    setSelectedBets(new Set());
    setShowBatchClaim(false);
  };

  if (isLoading) {
    return (
      <div className="glass p-6 rounded-xl">
        <div className="h-6 bg-muted/50 rounded mb-4"></div>
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 bg-muted/30 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (claimableBets.length === 0) {
    return (
      <div className="glass p-6 rounded-xl">
        <div className="text-center py-8">
          <Gift className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Claimable Winnings</h3>
          <p className="text-muted-foreground mb-4">
            You don&apos;t have any winnings ready to claim at the moment.
          </p>
          <Link 
            href="/markets" 
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Browse Markets
            <ExternalLink className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/10 rounded-lg">
            <Gift className="w-6 h-6 text-green-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Claimable Winnings</h3>
            <p className="text-sm text-muted-foreground">
              {claimableBets.length} market{claimableBets.length !== 1 ? 's' : ''} ready to claim
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <div className="text-2xl font-bold text-green-500">
            {formatCurrency(totalClaimable)}
          </div>
          <div className="text-sm text-muted-foreground">Total Available</div>
        </div>
      </div>

      {/* Batch Actions */}
      {claimableBets.length > 1 && (
        <div className="glass p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedBets.size === claimableBets.length}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="rounded border-muted/50"
                />
                <span className="text-sm font-medium">Select All</span>
              </label>
              
              {selectedBets.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedBets.size} selected • {formatCurrency(selectedClaimable)}
                </span>
              )}
            </div>
            
            {selectedBets.size > 1 && (
              <button
                onClick={() => setShowBatchClaim(true)}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
              >
                Claim Selected ({selectedBets.size})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Claimable Bets List */}
      <div className="space-y-4">
        {claimableBets.map((bet) => {
          const claimTx = claimTransactions.get(bet.poolId);
          const isSelected = selectedBets.has(bet.poolId);
          const isPending = claimTx?.status === 'pending';
          const isSuccess = claimTx?.status === 'success';
          const isFailed = claimTx?.status === 'failed';
          
          return (
            <div 
              key={bet.poolId} 
              className={`glass p-6 rounded-xl transition-all duration-200 ${
                isSelected ? 'ring-2 ring-green-500/50 bg-green-500/5' : ''
              }`}
            >
              <div className="flex items-start gap-4">
                {/* Selection Checkbox */}
                {claimableBets.length > 1 && (
                  <label className="flex items-center mt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => handleSelectBet(bet.poolId, e.target.checked)}
                      className="rounded border-muted/50"
                    />
                  </label>
                )}
                
                {/* Bet Information */}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Link 
                        href={`/markets/${bet.poolId}`}
                        className="font-semibold hover:text-primary transition-colors flex items-center gap-2"
                      >
                        {bet.marketTitle}
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                      <p className="text-sm text-muted-foreground mt-1">
                        Won betting on: <span className="font-medium text-green-500">{bet.outcomeName}</span>
                      </p>
                    </div>
                    
                    <div className="text-right">
                      <div className="text-xl font-bold text-green-500">
                        {formatCurrency(bet.claimableAmount || 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        from {formatCurrency(bet.amountBet)} bet
                      </div>
                    </div>
                  </div>

                  {/* Transaction Status */}
                   {claimTx && (
                     <div className="mb-3">
                       {isPending && (
                         <div className="flex items-center gap-2 text-sm text-blue-500">
                           <RefreshCw className="w-4 h-4 animate-spin" />
                           <span>Processing claim transaction...</span>
                         </div>
                       )}
                       
                       {isSuccess && (
                         <div className="flex items-center gap-2 text-sm text-green-500">
                           <CheckCircle className="w-4 h-4" />
                           <span>Successfully claimed!</span>
                           {claimTx.txId && (
                             <a 
                               href={`https://explorer.stacks.co/txid/${claimTx.txId}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               className="underline hover:no-underline"
                             >
                               View transaction
                             </a>
                           )}
                           <button
                             onClick={() => handleViewReceipt(bet)}
                             className="text-xs underline hover:no-underline ml-2"
                           >
                             View Receipt
                           </button>
                         </div>
                       )}
                      
                      {isFailed && (
                        <div className="flex items-center gap-2 text-sm text-red-500">
                          <AlertCircle className="w-4 h-4" />
                          <span>Claim failed: {claimTx.error}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      Bet placed: {new Date(bet.betTimestamp * 1000).toLocaleDateString()}
                    </div>
                    
                    {!isSuccess && (
                      <button
                        onClick={() => onClaim(bet.poolId)}
                        disabled={isPending}
                        className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 
                                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                      >
                        {isPending ? 'Claiming...' : 'Claim Winnings'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Batch Claim Confirmation Modal */}
      <Dialog
        open={showBatchClaim}
        onClose={() => setShowBatchClaim(false)}
        title="Confirm Batch Claim"
        showCloseButton={false}
      >
        <p className="text-muted-foreground mb-6">
          You&apos;re about to claim winnings from {selectedBets.size} markets for a total of{' '}
          <span className="font-semibold text-green-500">{formatCurrency(selectedClaimable)}</span>.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => setShowBatchClaim(false)}
            className="flex-1 px-4 py-2 border border-muted/50 rounded-lg hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleBatchClaim}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
          >
            Claim All
          </button>
        </div>
      </Dialog>

      {/* Transaction Receipt Modal */}
      {receiptData && (
        <TransactionReceipt
          receipt={receiptData}
          isOpen={showReceipt}
          onClose={() => {
            setShowReceipt(false);
            setReceiptData(null);
          }}
        />
      )}
    </div>
  );
}
