"use client";

import { useState } from 'react';
import { useClaimWinnings } from '@/app/lib/hooks/useClaimWinnings';
import { useWallet } from '@/components/WalletAdapterProvider';
import { Loader2, Coins } from 'lucide-react';

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
    const { address, isConnected } = useWallet();
    const { claim } = useClaimWinnings(userAddress ?? address);

    const handleClaim = async () => {
        if (!isConnected) return;

        setIsPending(true);
        setError(null);

        try {
            await claim(poolId, onClaimSuccess);
            setIsPending(false);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to claim';
            setError(message);
            setIsPending(false);
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
            {error && <p className="text-red-400 text-xs text-center font-medium animate-pulse">{error}</p>}
        </div>
    );
}
