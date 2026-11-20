"use client";

/**
 * Issue #1601: Settlement status and claimable amounts card.
 *
 * Surfaces per-market settlement state and the user's claimable amount
 * on the market detail page using existing contract views and showing
 * a clear disabled/enabled claim action.
 */

import ClaimWinningsButton from "@/components/ClaimWinningsButton";
import { TrendingUp, Trophy, CheckCircle2, Lock, Info } from "lucide-react";
import type { Pool } from "@/app/lib/market-types";

interface SettlementClaimCardProps {
    pool: Pool;
    userBet: { amountA: number; amountB: number } | null;
    hasClaimedWinnings: boolean;
    userHasWinnings: boolean;
    stxAddress?: string | null;
    poolId: number;
    onClaimSuccess?: () => void;
}

export default function SettlementClaimCard({
    pool,
    userBet,
    hasClaimedWinnings,
    userHasWinnings,
    stxAddress,
    poolId,
    onClaimSuccess,
}: SettlementClaimCardProps) {
    const winningOutcomeName =
        pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB;
    const totalPool = pool.totalA + pool.totalB;

    // Calculate claimable amount using the pool's proportional payout model.
    // Payout = (user's stake on winning side / total stake on winning side) * total pool
    let claimableAmount = 0;
    if (pool.settled && pool.winningOutcome !== undefined && userBet) {
        const userWinningSide =
            pool.winningOutcome === 0 ? userBet.amountA : userBet.amountB;
        const winningSideTotal =
            pool.winningOutcome === 0 ? pool.totalA : pool.totalB;
        if (userWinningSide > 0 && winningSideTotal > 0) {
            claimableAmount = (userWinningSide / winningSideTotal) * totalPool;
        }
    }

    const hasUserPosition = userBet && (userBet.amountA > 0 || userBet.amountB > 0);
    const userWon = pool.settled && userHasWinnings;
    const userLost =
        pool.settled &&
        hasUserPosition &&
        !userWon &&
        !hasClaimedWinnings &&
        ((pool.winningOutcome === 0 && (userBet?.amountB ?? 0) > 0 && (userBet?.amountA ?? 0) === 0) ||
            (pool.winningOutcome === 1 && (userBet?.amountA ?? 0) > 0 && (userBet?.amountB ?? 0) === 0));

    return (
        <div className="mt-4 p-5 bg-muted/30 rounded-xl border border-border">
            {/* Settlement status header */}
            <div className="flex items-center gap-2 mb-4">
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                    pool.settled
                        ? "bg-green-500/10 text-green-500"
                        : "bg-yellow-500/10 text-yellow-500"
                }`}>
                    {pool.settled ? (
                        <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Settled
                        </>
                    ) : (
                        <>
                            <Lock className="w-3.5 h-3.5" />
                            Awaiting Settlement
                        </>
                    )}
                </div>
            </div>

            {/* Winning outcome */}
            {pool.settled && pool.winningOutcome !== undefined && (
                <div className="mb-4 p-4 bg-green-500/5 rounded-lg border border-green-500/10">
                    <div className="flex items-center gap-2 mb-1">
                        <Trophy className="w-4 h-4 text-yellow-500" />
                        <p className="text-sm font-semibold text-muted-foreground">Winning Outcome</p>
                    </div>
                    <p className="text-lg font-bold">{winningOutcomeName}</p>
                </div>
            )}

            {/* Claimable amount */}
            {pool.settled && hasUserPosition && (
                <div className="mb-4 space-y-3">
                    {/* User's position summary */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className={`p-3 rounded-lg ${
                            pool.winningOutcome === 0
                                ? "bg-green-500/10 border border-green-500/20"
                                : "bg-muted/50 border border-border/50"
                        }`}>
                            <p className="text-xs text-muted-foreground">{pool.outcomeA}</p>
                            <p className="text-sm font-bold">
                                {((userBet?.amountA ?? 0) / 1_000_000).toFixed(2)} XLM
                            </p>
                            {pool.settled && pool.winningOutcome === 0 && (
                                <p className="text-xs text-green-400 mt-1">Winner</p>
                            )}
                        </div>
                        <div className={`p-3 rounded-lg ${
                            pool.winningOutcome === 1
                                ? "bg-red-500/10 border border-red-500/20"
                                : "bg-muted/50 border border-border/50"
                        }`}>
                            <p className="text-xs text-muted-foreground">{pool.outcomeB}</p>
                            <p className="text-sm font-bold">
                                {((userBet?.amountB ?? 0) / 1_000_000).toFixed(2)} XLM
                            </p>
                            {pool.settled && pool.winningOutcome === 1 && (
                                <p className="text-xs text-red-400 mt-1">Winner</p>
                            )}
                        </div>
                    </div>

                    {/* Claimable amount display */}
                    {userWon && !hasClaimedWinnings && (
                        <div className="p-4 bg-gradient-to-r from-yellow-500/10 to-amber-600/10 rounded-lg border border-yellow-500/20">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="w-5 h-5 text-yellow-500" />
                                    <span className="text-sm font-medium text-muted-foreground">
                                        Claimable Amount
                                    </span>
                                </div>
                                <span className="text-2xl font-bold text-yellow-500">
                                    {(claimableAmount / 1_000_000).toFixed(4)} XLM
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Includes your stake and proportional share of the losing side's pool.
                            </p>
                        </div>
                    )}

                    {/* Already claimed */}
                    {hasClaimedWinnings && (
                        <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-primary" />
                            <p className="text-sm text-primary font-medium">
                                Winnings already claimed.
                            </p>
                        </div>
                    )}

                    {/* Lost bet */}
                    {userLost && (
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                            <div className="flex items-center gap-2">
                                <Info className="w-4 h-4 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    You bet on the losing outcome. No claimable amount.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* No wallet connected */}
                    {!stxAddress && (
                        <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                            <p className="text-sm text-muted-foreground">
                                Connect your wallet to view your claimable amount.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Claim button — disabled when no winnings or already claimed */}
            <ClaimWinningsButton
                poolId={poolId}
                isSettled={pool.settled}
                userHasWinnings={userHasWinnings}
                userAddress={stxAddress}
                onClaimSuccess={onClaimSuccess}
            />

            {/* Disabled state explanation */}
            {pool.settled && !userHasWinnings && !hasClaimedWinnings && (
                <p className="mt-2 text-xs text-muted-foreground text-center">
                    {hasUserPosition
                        ? "You bet on the losing outcome — nothing to claim."
                        : "You did not participate in this market — nothing to claim."}
                </p>
            )}
            {pool.settled && hasClaimedWinnings && (
                <p className="mt-2 text-xs text-muted-foreground text-center">
                    Claim action is disabled — winnings have already been claimed.
                </p>
            )}
        </div>
    );
}
