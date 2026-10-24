"use client";

import { useState } from 'react';
import { useClaimWinnings } from '@/app/lib/hooks/useClaimWinnings';
import { useWallet } from '@/components/WalletAdapterProvider';
import { Loader2, Coins } from 'lucide-react';
import { useI18n } from '@/app/lib/i18n';
import { TransactionFeeModal } from '@/components/TransactionFeeModal';

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
    const { t } = useI18n();
    const [isPending, setIsPending] = useState(false);
    const { address, isConnected } = useWallet();
    // The claim pauses after simulation until the fee prompt is answered, so
    // this component must render the fee modal itself. Without it the claim
    // waited forever on the market and pool detail pages.
    const { claim, claimTransactions, feePrompt, setFeePrompt, stage, setStage } =
        useClaimWinnings(userAddress ?? address);

    // The hook reports failures through its state (and a toast) rather than
    // throwing. A user cancel is not an error worth repeating inline.
    const claimState = claimTransactions.get(poolId);
    const error =
        !isPending &&
        claimState?.status === 'failed' &&
        claimState.error !== 'Transaction cancelled by user'
            ? claimState.error ?? 'Failed to claim'
            : null;

    const handleClaim = async () => {
        if (!isConnected) return;

        setIsPending(true);
        try {
            await claim(poolId, onClaimSuccess);
        } finally {
            setIsPending(false);
        }
    };

    if (!isSettled || !userHasWinnings) return null;

    return (
        <div className="flex flex-col gap-2">
            <button
                onClick={handleClaim}
                disabled={isPending}
                aria-busy={isPending}
                aria-label={isPending ? 'Claiming winnings, please wait' : 'Claim your winnings'}
                className="flex items-center justify-center gap-2 px-6 py-2 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-white font-bold rounded-xl shadow-lg shadow-yellow-900/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed group focus:outline-none focus:ring-2 focus:ring-yellow-400/50"
            >
                {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                    <Coins className="w-4 h-4 group-hover:rotate-12 transition-transform" aria-hidden="true" />
                )}
                {isPending ? t('claim.processing') : t('claim.button')}
            </button>
            {error && (
                <p role="alert" className="text-red-400 text-xs text-center font-medium">
                    {error}
                </p>
            )}
            <TransactionFeeModal
                isOpen={!!feePrompt}
                actionName="Claim Winnings"
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
        </div>
    );
}
