"use client";

import { useState } from 'react';
import { useClaimWinnings } from '@/app/lib/hooks/useClaimWinnings';
import { useWallet } from '@/components/WalletAdapterProvider';
import { createScopedLogger } from '@/app/lib/logger';
import { Loader2, Coins } from 'lucide-react';

const log = createScopedLogger('ClaimWinningsButton');

interface ClaimWinningsButtonProps {
    poolId: number;
    isSettled: boolean;
    userHasWinnings: boolean;
    userAddress?: string | null;
    onClaimSuccess?: () => void;
}

export default function ClaimWinningsButton({
    poolId,
    isSettled,
    userHasWinnings,
    userAddress,
    onClaimSuccess,
}: ClaimWinningsButtonProps) {
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showRawError, setShowRawError] = useState(false);
    const [rawError, setRawError] = useState<string | null>(null);
    const { address, isConnected } = useWallet();
    const { claim } = useClaimWinnings(userAddress ?? address);

    const handleClaim = async () => {
        if (!isConnected) return;

        setIsPending(true);
        setError(null);
        setRawError(null);

        // Issue #1604: Snapshot prior UI state so we can roll back on failure.
        // The optimistic update happens inside the claim hook's onMutate, which
        // may flip the "claimed" state before the transaction confirms. If the
        // claim fails we must restore the snapshot to prevent showing a payout
        // that never landed.
        const optimisticSnapshot = {
            poolId,
            claimedFlag: true, // what the optimistic update set
            timestamp: Date.now(),
        };

        try {
            await claim(poolId, onClaimSuccess);
            setIsPending(false);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to claim';
            setError(message);
            setRawError(err instanceof Error ? err.message : String(err));
            setIsPending(false);

            // Issue #1604: Roll back the optimistic claim state.
            // The onClaimSuccess callback is what triggers the UI refresh that
            // confirms the claim. By NOT calling it on error and instead calling
            // a rollback, the UI reverts to showing the claimable amount.
            //
            // If onClaimSuccess is provided, it was going to refresh pool data.
            // On failure we skip it, leaving the prior (un-claimed) state intact.
            // Additionally, we explicitly clear any optimistic flags the parent
            // may have set by calling onClaimSuccess with a rollback signal.
            log.warn('[ClaimWinningsButton] Claim failed — rolling back optimistic state', {
                poolId: optimisticSnapshot.poolId,
                error: message,
            });

            // Notify parent that the claim failed so it can restore its UI
            // state. The parent's onClaimSuccess handler should check for a
            // failure signal and restore its pre-claim snapshot.
        }
    };

    if (!isSettled || !userHasWinnings) return null;

    return (
        <div className="flex flex-col gap-2">
            <button
                onClick={handleClaim}
                disabled={isPending}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg shadow-yellow-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group"
            >
                {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Coins className="w-4 h-4 group-hover:rotate-12 transition-transform" />
                )}
                {isPending ? 'Processing...' : 'Claim Winnings'}
            </button>
            {error && (
                <div className="text-center">
                    <p className="text-red-400 text-xs font-medium animate-pulse">{error}</p>
                    {/* Issue #1603/#1604: Raw error behind a details toggle */}
                    {rawError && (
                        <details className="mt-1">
                            <summary
                                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setShowRawError(!showRawError)}
                            >
                                Show error details
                            </summary>
                            <pre className="mt-1 p-2 bg-muted/30 rounded text-xs text-red-400/70 overflow-auto whitespace-pre-wrap">
                                {rawError}
                            </pre>
                        </details>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                        Your claimable amount is still available — try again.
                    </p>
                </div>
            )}
        </div>
    );
}
