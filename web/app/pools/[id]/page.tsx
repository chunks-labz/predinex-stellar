'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('PoolDetailPage');

import Link from "next/link";
import { use, useEffect, useState, useCallback } from "react";
import { useWallet } from '@/components/WalletAdapterProvider';
import { predinexReadApi } from "../../lib/adapters/predinex-read-api";
import type { Pool } from "../../lib/adapters/types";
import Navbar from '@/components/Navbar';
import CountdownTimer from '@/components/CountdownTimer';
import { fetchCurrentBlockHeightLive } from "../../lib/market-utils";
import { blocksToSeconds } from "../../lib/countdown-utils";
import ClaimWinningsButton from "../../../components/ClaimWinningsButton";
import { AlertCircle, RefreshCw, Users, TrendingUp, Clock, Wallet } from "lucide-react";
import { TruncatedAddress } from "../../../components/TruncatedAddress";

function LoadingSkeleton() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <Navbar />
            <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
                <div className="glass p-8 rounded-2xl border border-border animate-pulse">
                    <div className="h-6 bg-muted rounded w-24 mb-6" />
                    <div className="h-8 bg-muted rounded w-3/4 mb-3" />
                    <div className="h-4 bg-muted rounded w-full mb-8" />
                    <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="h-24 bg-muted rounded-lg" />
                        <div className="h-24 bg-muted rounded-lg" />
                        <div className="h-24 bg-muted rounded-lg" />
                    </div>
                    <div className="h-4 bg-muted rounded w-1/4 mb-2" />
                    <div className="h-4 bg-muted rounded-full w-full mb-8" />
                </div>
            </div>
        </div>
    );
}

export default function PoolDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const poolId = parseInt(id);

    const { address: stxAddress } = useWallet();

    const [pool, setPool] = useState<Pool | null>(null);
    const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userBet, setUserBet] = useState<{ amountA: number; amountB: number } | null>(null);

    const fetchPool = useCallback(async () => {
        try {
            const data = await predinexReadApi.getPool(poolId);
            setPool(data);
            setError(null);
            return data;
        } catch (e) {
            throw e;
        }
    }, [poolId]);

    const fetchUserBet = useCallback(async () => {
        if (!stxAddress) {
            setUserBet(null);
            return;
        }
        try {
            const bet = await predinexReadApi.getUserBet(poolId, stxAddress);
            setUserBet(bet);
        } catch {
            setUserBet(null);
        }
    }, [poolId, stxAddress]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            setError(null);
            try {
                await fetchPool();
                if (!cancelled) setIsLoading(false);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Failed to load pool');
                    setIsLoading(false);
                }
            }
        };
        load();
        return () => { cancelled = true; };
    }, [fetchPool]);

    useEffect(() => {
        fetchUserBet();
    }, [fetchUserBet]);

    useEffect(() => {
        let cancelled = false;
        fetchCurrentBlockHeightLive()
            .then(({ height }) => {
                if (!cancelled && height > 0) setCurrentBlockHeight(height);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Auto-refresh every 10 seconds.
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                await fetchPool();
                await fetchUserBet();
            } catch (e) {
                log.error('Auto-refresh failed:', e);
            }
        }, 10_000);
        return () => clearInterval(interval);
    }, [fetchPool, fetchUserBet]);

    // Loading skeleton.
    if (isLoading) return <LoadingSkeleton />;

    // Error state (no pool data).
    if (error && !pool) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <Navbar />
                <div className="pt-32 flex flex-col items-center justify-center min-h-[50vh] px-4">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                    <h2 className="text-xl font-semibold text-red-500 mb-2">Pool Not Found</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">{error}</p>
                    <Link
                        href="/markets"
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                        Back to Markets
                    </Link>
                </div>
            </main>
        );
    }

    // Pool not found state.
    if (!pool) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <Navbar />
                <div className="pt-32 flex flex-col items-center justify-center min-h-[50vh] px-4">
                    <AlertCircle className="w-12 h-12 text-yellow-500 mb-4" />
                    <h2 className="text-xl font-semibold mb-2">Pool Not Found</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">
                        Pool #{poolId} does not exist on-chain.
                    </p>
                    <Link
                        href="/markets"
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                        Back to Markets
                    </Link>
                </div>
            </main>
        );
    }

    const totalVolume = pool.totalA + pool.totalB;
    const oddsA = totalVolume > 0 ? ((pool.totalA / totalVolume) * 100).toFixed(1) : '50.0';
    const oddsB = totalVolume > 0 ? ((pool.totalB / totalVolume) * 100).toFixed(1) : '50.0';

    const userHasPosition = userBet && (userBet.amountA > 0 || userBet.amountB > 0);
    const userWonBet = pool.settled && userBet &&
        ((pool.winningOutcome === 0 && userBet.amountA > 0) ||
         (pool.winningOutcome === 1 && userBet.amountB > 0));

    return (
        <main className="min-h-screen bg-background text-foreground">
            <Navbar />

            <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
                <div className="glass p-8 rounded-2xl border border-border">
                    {/* Auto-refresh indicator */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                        <RefreshCw className="w-3 h-3" />
                        Updates every 10s &middot; Pool #{poolId}
                    </div>

                    {/* Header */}
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h1 className="text-3xl font-bold">{pool.title}</h1>
                            <p className="text-muted-foreground mt-1">{pool.description}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                            pool.settled ? 'bg-zinc-800 text-zinc-400' : 'bg-green-500/10 text-green-500'
                        }`}>
                            {pool.settled ? 'Settled' : pool.status === 'expired' ? 'Expired' : 'Active'}
                        </span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <TrendingUp className="w-5 h-5 mx-auto mb-2 text-primary" />
                            <p className="text-sm text-muted-foreground">Total Volume</p>
                            <p className="font-bold">{(totalVolume / 1_000_000).toLocaleString()} STX</p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <Users className="w-5 h-5 mx-auto mb-2 text-accent" />
                            <p className="text-sm text-muted-foreground">Creator</p>
                            <p className="font-mono text-xs truncate">
                                <TruncatedAddress address={pool.creator} />
                            </p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <Clock className="w-5 h-5 mx-auto mb-2 text-yellow-500" />
                            <p className="text-sm text-muted-foreground">Expires</p>
                            {currentBlockHeight !== null ? (
                                <CountdownTimer
                                    className="font-bold justify-center"
                                    secondsRemaining={blocksToSeconds(pool.expiry - currentBlockHeight)}
                                    settled={pool.settled}
                                />
                            ) : (
                                <p className="font-bold">Block {pool.expiry}</p>
                            )}
                        </div>
                    </div>

                    {/* Odds display */}
                    <div className="mb-8">
                        <p className="text-sm text-muted-foreground mb-2">Current Odds</p>
                        <div className="flex h-4 rounded-full overflow-hidden">
                            <div
                                className="bg-green-500 transition-all"
                                style={{ width: `${oddsA}%` }}
                            />
                            <div
                                className="bg-red-500 transition-all"
                                style={{ width: `${oddsB}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-2 text-sm">
                            <span className="text-green-400">{pool.outcomeA}: {oddsA}%</span>
                            <span className="text-red-400">{pool.outcomeB}: {oddsB}%</span>
                        </div>
                    </div>

                    {/* Pool Details */}
                    <div className="bg-muted/30 p-4 rounded-xl mb-8">
                        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                            <Wallet className="w-4 h-4" />
                            Pool Details
                        </h3>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span className="text-muted-foreground">Outcome A</span>
                                <p className="font-medium">{pool.outcomeA}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Outcome B</span>
                                <p className="font-medium">{pool.outcomeB}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Total A Bets</span>
                                <p className="font-medium">{(pool.totalA / 1_000_000).toLocaleString()} STX</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Total B Bets</span>
                                <p className="font-medium">{(pool.totalB / 1_000_000).toLocaleString()} STX</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Participants</span>
                                <p className="font-medium">{pool.participant_count ?? 'N/A'}</p>
                            </div>
                        </div>
                    </div>

                    {/* User bet position */}
                    {userHasPosition && (
                        <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-xl">
                            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                                <Wallet className="w-4 h-4" />
                                Your Position
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className={`p-3 rounded-lg ${userBet!.amountA > 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-muted/50'}`}>
                                    <p className="text-sm text-muted-foreground">{pool.outcomeA}</p>
                                    <p className="text-xl font-bold">{(userBet!.amountA / 1_000_000).toFixed(2)} STX</p>
                                </div>
                                <div className={`p-3 rounded-lg ${userBet!.amountB > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-muted/50'}`}>
                                    <p className="text-sm text-muted-foreground">{pool.outcomeB}</p>
                                    <p className="text-xl font-bold">{(userBet!.amountB / 1_000_000).toFixed(2)} STX</p>
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-primary/20 flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Total Staked</span>
                                <span className="font-bold">{((userBet!.amountA + userBet!.amountB) / 1_000_000).toFixed(2)} STX</span>
                            </div>
                            {pool.settled && userWonBet && (
                                <div className="mt-2 text-sm text-green-400">
                                    Winner: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Claim availability */}
                    {pool.settled && (
                        <div className="mt-6">
                            <div className="bg-muted/30 p-4 rounded-xl mb-4">
                                <h3 className="text-sm font-semibold mb-2">Claim Status</h3>
                                {pool.winningOutcome !== undefined ? (
                                    <p className="text-sm">
                                        Winning outcome: <strong>{pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}</strong>
                                    </p>
                                ) : (
                                    <p className="text-sm text-muted-foreground">Pool is settled but no winning outcome recorded.</p>
                                )}
                            </div>
                            {userWonBet && (
                                <ClaimWinningsButton
                                    poolId={poolId}
                                    isSettled={pool.settled}
                                    userHasWinnings={true}
                                    userAddress={stxAddress}
                                    onClaimSuccess={() => {
                                        fetchPool();
                                        fetchUserBet();
                                    }}
                                />
                            )}
                        </div>
                    )}

                    {pool.status === 'expired' && !pool.settled && (
                        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                            <p className="text-sm text-yellow-400">
                                This pool has expired and is awaiting settlement.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
