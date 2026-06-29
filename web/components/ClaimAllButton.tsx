'use client';

import { Gift, Loader2 } from 'lucide-react';
import { useClaimAll, CLAIM_ALL_MAX_POOLS } from '@/app/lib/hooks/useClaimAll';
import { useWallet } from '@/components/WalletAdapterProvider';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';
import ClaimAllProgressModal from './ClaimAllProgressModal';

export interface ClaimablePool {
  poolId: number;
  marketTitle: string;
}

interface ClaimAllButtonProps {
  /** Settled pools the user has won and not yet claimed. */
  claimablePools: ClaimablePool[];
  userAddress?: string | null;
  onClaimSuccess?: () => void;
}

/**
 * "Claim All" entrypoint: batches up to 20 winning claims into a single
 * `claim_all_winnings` transaction and surfaces per-pool progress.
 *
 * Renders the button only when claims are available; otherwise shows a
 * "No claims available" empty state.
 */
export default function ClaimAllButton({
  claimablePools,
  userAddress,
  onClaimSuccess,
}: ClaimAllButtonProps) {
  const { address, isConnected } = useWallet();
  const { state, claimAll, reset, feePrompt, setFeePrompt, stage, setStage } = useClaimAll(
    userAddress ?? address
  );

  if (!claimablePools || claimablePools.length === 0) {
    return (
      <p data-testid="claim-all-empty" className="text-sm text-muted-foreground">
        No claims available
      </p>
    );
  }

  const poolIds = claimablePools.slice(0, CLAIM_ALL_MAX_POOLS).map((p) => p.poolId);
  const titles: Record<number, string> = Object.fromEntries(
    claimablePools.map((p) => [p.poolId, p.marketTitle])
  );
  const isClaiming = state.status === 'claiming';
  const modalOpen = state.status !== 'idle';

  const handleClaimAll = () => {
    if (!isConnected || isClaiming) return;
    void claimAll(poolIds, onClaimSuccess);
  };

  return (
    <>
      <button
        onClick={handleClaimAll}
        disabled={isClaiming || !isConnected}
        data-testid="claim-all-button"
        className="flex items-center justify-center gap-2 px-5 py-2 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isClaiming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
        {isClaiming
          ? 'Claiming…'
          : `Claim All (${Math.min(claimablePools.length, CLAIM_ALL_MAX_POOLS)})`}
      </button>

      <TransactionFeeModal
        isOpen={!!feePrompt}
        actionName="Claim All Winnings"
        feeStroops={feePrompt?.feeStroops || '0'}
        onConfirm={() => {
          feePrompt?.resolve(true);
          setFeePrompt(null);
        }}
        onCancel={() => {
          feePrompt?.resolve(false);
          setFeePrompt(null);
          setStage('idle');
        }}
        isConfirming={stage === 'signing' || stage === 'submitting' || stage === 'polling'}
      />

      <ClaimAllProgressModal
        isOpen={modalOpen && !feePrompt}
        state={state}
        titles={titles}
        onClose={() => {
          reset();
          if (state.status === 'success') onClaimSuccess?.();
        }}
      />
    </>
  );
}
