'use client';
import { createScopedLogger } from '@/app/lib/logger';
const log = createScopedLogger('page');

import Link from "next/link";
import Navbar from '@/components/Navbar';
import BettingSection from '@/components/BettingSection';
import ClaimWinningsButton from "../../../components/ClaimWinningsButton";
import SettlementClaimCard from "@/components/SettlementClaimCard";
import SettledPoolSummary from "../../components/SettledPoolSummary";
import { useWallet } from '@/components/WalletAdapterProvider';
import { useEffect, useState, useCallback, useRef } from "react";
import { useUserActivity } from "../../hooks/useUserActivity";
import { predinexReadApi } from "../../lib/adapters/predinex-read-api";
import type { Pool } from "../../lib/adapters/types";
import { secondsUntil } from "../../lib/countdown-utils";
import CountdownTimer from '@/components/CountdownTimer';
import DisputeHistoryTimeline from "../../components/DisputeHistoryTimeline";
import { useDisputeHistory } from "../../lib/hooks/useDisputeHistory";
import PoolActivityTimeline from "../../components/PoolActivityTimeline";
import { TrendingUp, Users, Clock, RefreshCw, AlertCircle, Star, StarOff, Info, ArrowLeft } from "lucide-react";
import { use } from "react";
import ShareButton from "../../../components/ShareButton";
import { TruncatedAddress } from "../../../components/TruncatedAddress";
import { usePoolFavorites } from "../../lib/hooks/usePoolFavorites";
import { useTransactionToast } from '@/lib/hooks/useTransactionToast';
import { parsePoolId } from '@/app/lib/market-types';
import DepthChart from '@/components/DepthChart';
import SettlementStatusBadge from '@/components/SettlementStatusBadge';
import { formatMarketDeadline } from '@/app/lib/formatting';
import {
  formatOdds,
  formatPayout,
  formatTokenUnits,
  stroopsToUnits,
} from "../../lib/formatting";
import { useI18n } from "../../lib/i18n";
import Tooltip from "../../../components/ui/Tooltip";
import { readMarketDetail, writeMarketDetail } from "../../lib/market-detail-cache";
import { classifyConnectivityIssue, getConnectivityMessage } from "../../lib/network-errors";
import { DEFAULT_MARKETS_HREF, getLastMarketsHref } from "../../lib/market-nav";

/**
 * #1589 — turn a raw RPC/fetch failure into a message the user can act on.
 * Connectivity problems get the shared offline/timeout/network copy; anything
 * else keeps the underlying message so it is still diagnosable.
 */
function describeLoadError(error: unknown, actionLabel: string): string {
    const issue = classifyConnectivityIssue(error);
    if (issue !== 'unknown') return getConnectivityMessage(issue, actionLabel);
    if (error instanceof Error && error.message) return error.message;
    return getConnectivityMessage('unknown', actionLabel);
}

export default function PoolDetails({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const poolId = parseInt(id);
    const { t } = useI18n();

    const { address: stxAddress } = useWallet();
    const { activities, refresh: refreshActivity } = useUserActivity(stxAddress ?? undefined, 50);
    const { isFavorite, toggleFavorite } = usePoolFavorites();
    const { showError } = useTransactionToast();
    const favorite = isFavorite(poolId);
    const {
        events: disputeEvents,
        isLoading: isLoadingDisputes,
        error: disputeError,
    } = useDisputeHistory(Number.isNaN(poolId) ? undefined : poolId);

    const [pool, setPool] = useState<Pool | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [userBet, setUserBet] = useState<{ amountA: number; amountB: number } | null>(null);
    const [backHref, setBackHref] = useState(DEFAULT_MARKETS_HREF);
    const isValidPoolId = parsePoolId(id) !== null;

    const snapshotRef = useRef<{ pool: Pool; userBet: { amountA: number; amountB: number } } | null>(null);
    const pendingBetsRef = useRef(0);
    const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isRefreshingRef = useRef(false);
    const rerunPendingRef = useRef(false);

    // Read after mount so server and client render the same href.
    useEffect(() => {
        setBackHref(getLastMarketsHref());
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (parsePoolId(poolId) === null) {
            // Malformed ID in the URL: skip the RPC and show the not-found state.
            setPool(null);
            setIsLoading(false);
            return () => { cancelled = true; };
        }
        const cacheAddress = stxAddress ?? undefined;
        const cached = readMarketDetail(poolId, cacheAddress);

        if (cached) {
            // Navigation cache hit: render the pool and position immediately
            // instead of repeating the RPC round-trip on every detail visit.
            setPool(cached.pool);
            setUserBet(cached.userBet);
            setIsLoading(false);
            setError(null);
            return () => { cancelled = true; };
        }

        const loadPool = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const [data, bet] = await Promise.all([
                    predinexReadApi.getPool(poolId),
                    stxAddress ? predinexReadApi.getUserBet(poolId, stxAddress) : Promise.resolve(null),
                ]);
                if (cancelled) return;
                setPool(data);
                setUserBet(bet);
                if (data) {
                    writeMarketDetail(poolId, cacheAddress, data, bet);
                }
            } catch (e) {
                if (cancelled) return;
                setError(describeLoadError(e, 'Loading this market'));
                log.error(`Failed to load pool ${poolId}:`, e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        loadPool();
        return () => { cancelled = true; };
    }, [poolId, stxAddress]);

    const refreshPoolData = useCallback(async () => {
        if (isRefreshingRef.current) {
            rerunPendingRef.current = true;
            return;
        }
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        setError(null);

        try {
            const [newPool, newBet] = await Promise.all([
                predinexReadApi.getPool(poolId),
                stxAddress ? predinexReadApi.getUserBet(poolId, stxAddress) : Promise.resolve(null)
            ]);

            if (pendingBetsRef.current > 0) {
                // Keep optimistic state; reconcile will retry
                return;
            }

            if (newPool) setPool(newPool);
            setUserBet(newBet);
            if (newPool) {
                writeMarketDetail(poolId, stxAddress ?? undefined, newPool, newBet);
            }
            if (stxAddress) {
                await refreshActivity();
            }
            snapshotRef.current = null;
            pendingBetsRef.current = 0;
            // Clear error if refresh succeeds
            setError(null);
        } catch (err) {
            const msg = describeLoadError(err, 'Refreshing this market');
            log.error("Failed to refresh pool data:", err);
            if (pendingBetsRef.current > 0 && snapshotRef.current) {
                setPool(snapshotRef.current.pool);
                setUserBet(snapshotRef.current.userBet);
                snapshotRef.current = null;
                pendingBetsRef.current = 0;
                showError('Bet could not be confirmed. Your position has been restored.');
                setError(null);
            } else {
                // Don't overwrite existing pool data on refresh error
                setError(msg);
            }
        } finally {
            isRefreshingRef.current = false;
            setIsRefreshing(false);
            if (rerunPendingRef.current) {
                rerunPendingRef.current = false;
                setTimeout(() => void refreshPoolData(), 0);
            }
        }
    }, [poolId, refreshActivity, stxAddress, showError]);

    const handleBetSuccess = (outcome: number, amountMicroSTX: number) => {
        const amount = amountMicroSTX;
        if (pool && userBet) {
            if (!snapshotRef.current) {
                snapshotRef.current = {
                    pool,
                    userBet: { amountA: userBet.amountA, amountB: userBet.amountB }
                };
            }
        }
        pendingBetsRef.current += 1;
        setPool(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                totalA: outcome === 0 ? prev.totalA + amount : prev.totalA,
                totalB: outcome === 1 ? prev.totalB + amount : prev.totalB,
            };
        });
        setUserBet(prev => {
            const base = prev || { amountA: 0, amountB: 0 };
            return {
                amountA: outcome === 0 ? base.amountA + amount : base.amountA,
                amountB: outcome === 1 ? base.amountB + amount : base.amountB,
            };
        });
        if (reconcileTimerRef.current) {
            clearTimeout(reconcileTimerRef.current);
        }
        reconcileTimerRef.current = setTimeout(() => {
            reconcileTimerRef.current = null;
            void refreshPoolData();
        }, 3000);
    };

    const hasClaimedWinnings = activities.some(
        (activity) => activity.type === 'winnings-claimed' && activity.poolId === poolId
    );
    const userWonBet = pool?.settled && userBet &&
        ((pool.winningOutcome === 0 && userBet.amountA > 0) ||
            (pool.winningOutcome === 1 && userBet.amountB > 0));
    const userHasWinnings = !!userWonBet && !hasClaimedWinnings;

    // #1590 — consistent way back to the (filtered) markets list from every state.
    const backLink = (
        <nav aria-label="Breadcrumb" className="mb-4">
            <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 rounded px-1 py-1 text-sm text-muted-foreground hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
            >
                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                Back to markets
            </Link>
        </nav>
    );



    // Loading state - skeleton shaped like the resolved pool detail layout
    if (isLoading) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <Navbar />
                <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6 animate-fade-in" role="status" aria-busy="true">
                    <span className="sr-only">Loading pool from Soroban…</span>
                    <div className="glass p-8 rounded-2xl border border-border animate-pulse" aria-hidden="true">
                        {/* Header */}
                        <div className="flex justify-between items-center mb-6">
                            <div className="h-4 w-24 bg-muted/50 rounded" />
                            <div className="h-6 w-20 bg-muted/50 rounded-full" />
                        </div>
                        {/* Title + description */}
                        <div className="h-8 w-3/4 bg-muted/60 rounded mb-3" />
                        <div className="h-4 w-full bg-muted/40 rounded mb-2" />
                        <div className="h-4 w-5/6 bg-muted/40 rounded mb-8" />
                        {/* Stat cards */}
                        <div className="grid grid-cols-3 gap-4 mb-8">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="bg-muted/40 p-4 rounded-lg h-24" />
                            ))}
                        </div>
                        {/* Odds bar */}
                        <div className="mb-8">
                            <div className="h-3 w-24 bg-muted/40 rounded mb-2" />
                            <div className="h-4 w-full bg-muted/50 rounded-full" />
                        </div>
                        {/* Betting section */}
                        <div className="h-40 w-full bg-muted/30 rounded-xl" />
                    </div>
                </div>
            </main>
        );
    }

    // Error state
    if (error && !pool) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <Navbar />
                <div className="pt-32 flex flex-col items-center justify-center min-h-[50vh] px-4" role="alert">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" aria-hidden="true" />
                    <h2 className="text-xl font-semibold text-red-500 mb-2">Failed to Load Market</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">{error}</p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={refreshPoolData}
                            disabled={isRefreshing}
                            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                            {isRefreshing ? 'Retrying...' : 'Try Again'}
                        </button>
                        <Link
                            href={backHref}
                            className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Back to markets
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    // Missing pool state
    if (!pool) {
        return (
            <main className="min-h-screen bg-background text-foreground">
                <Navbar />
                <div className="pt-32 flex flex-col items-center justify-center min-h-[50vh] px-4">
                    <AlertCircle className="w-12 h-12 text-yellow-500 mb-4" aria-hidden="true" />
                    <h2 className="text-xl font-semibold mb-2">Pool Not Found</h2>
                    <p className="text-muted-foreground text-center max-w-md mb-6">
                        {isValidPoolId
                            ? `Pool #${poolId} does not exist on the Soroban contract. It may have been removed or the ID may be incorrect.`
                            : `"${id}" is not a valid market ID. Check the link or browse the markets list.`}
                    </p>
                    <Link
                        href={backHref}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    >
                        Back to Markets
                    </Link>
                </div>
            </main>
        );
    }

    const totalVolume = pool.totalA + pool.totalB;
    const oddsAValue = totalVolume > 0 ? (pool.totalA / totalVolume) * 100 : 50;
    const oddsBValue = totalVolume > 0 ? (pool.totalB / totalVolume) * 100 : 50;
    const oddsA = formatOdds(oddsAValue);
    const oddsB = formatOdds(oddsBValue);

    return (
        <main className="min-h-screen bg-background text-foreground">
            <Navbar />

            <div className="pt-28 sm:pt-32 pb-24 sm:pb-20 max-w-3xl mx-auto px-4 sm:px-6 animate-fade-in">
                {backLink}
                {/* #1589 — refresh failures used to be stored but never shown. Keep
                    the last good data on screen and offer a retry. */}
                {error && (
                    <div
                        role="alert"
                        className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm"
                    >
                        <div className="flex items-start gap-2 flex-1">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                            <p className="text-red-400">
                                {error} The data below may be out of date.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={refreshPoolData}
                            disabled={isRefreshing}
                            className="inline-flex items-center justify-center gap-2 self-start sm:self-auto rounded-lg border border-red-500/30 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
                            {isRefreshing ? 'Retrying...' : 'Retry'}
                        </button>
                    </div>
                )}
                <div className="glass p-5 sm:p-8 rounded-2xl border border-border">
                    {/* Header */}
                    <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
                        <span className="text-xs font-mono text-muted-foreground">#POOL-{pool.id}</span>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <button
                                type="button"
                                aria-pressed={favorite}
                                aria-label={favorite ? `Unfavorite pool #${poolId}` : `Favorite pool #${poolId}`}
                                title={favorite ? 'Remove bookmark' : 'Bookmark pool'}
                                onClick={() => toggleFavorite(poolId)}
                                className={`p-2 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                    favorite
                                        ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/15'
                                        : 'bg-muted/30 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                }`}
                            >
                                {favorite ? (
                                    <Star className="w-4 h-4" fill="currentColor" strokeWidth={2} aria-hidden="true" />
                                ) : (
                                    <StarOff className="w-4 h-4" aria-hidden="true" />
                                )}
                            </button>
                            <ShareButton
                                url={`${typeof window !== 'undefined' ? window.location.origin : ''}/markets/${id}`}
                                title={pool.title}
                                text={`Check out this prediction market: ${pool.title}`}
                            />
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                                pool.settled ? 'bg-zinc-800 text-zinc-400'
                                    : pool.status === 'expired' ? 'bg-yellow-500/10 text-yellow-500'
                                    : pool.status === 'frozen' ? 'bg-blue-500/10 text-blue-500'
                                    : pool.status === 'disputed' ? 'bg-orange-500/10 text-orange-500'
                                    : 'bg-green-500/10 text-green-500'
                            }`}>
                                {pool.settled ? 'Settled'
                                    : pool.status === 'expired' ? 'Expired'
                                    : pool.status === 'frozen' ? 'Frozen'
                                    : pool.status === 'disputed' ? 'Disputed'
                                    : 'Active'}
                            </span>
                            {(pool.settled || pool.status === 'disputed') && (
                                <SettlementStatusBadge
                                    status={pool.status === 'disputed' ? 'disputed' : 'settled'}
                                    payoutStatus={pool.settlementStatus}
                                />
                            )}
                        </div>
                    </div>

                    <h1 className="text-2xl sm:text-3xl font-bold mb-3 break-words">{pool.title}</h1>
                    <p className="text-muted-foreground mb-2">{pool.description}</p>
                    <p className="text-sm text-muted-foreground mb-8" data-testid="resolution-info">
                        {pool.settled
                            ? `Resolved: ${pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB} won.`
                            : pool.status === 'disputed'
                                ? 'Resolution is under dispute and not final yet.'
                                : `Resolves to ${pool.outcomeA} or ${pool.outcomeB} after the market closes (${formatMarketDeadline(pool.expiry)}).`}
                    </p>

                    {/* Stats */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8">
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <TrendingUp className="w-5 h-5 mx-auto mb-2 text-primary" aria-hidden="true" />
                            <p className="text-sm text-muted-foreground">Total Volume</p>
                            <p className="font-bold">{formatTokenUnits(stroopsToUnits(totalVolume))}</p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <Users className="w-5 h-5 mx-auto mb-2 text-accent" aria-hidden="true" />
                            <p className="text-sm text-muted-foreground">Creator</p>
                            <p className="font-mono text-xs truncate">
                                <TruncatedAddress address={pool.creator} />
                            </p>
                        </div>
                        <div className="bg-muted/50 p-4 rounded-lg text-center">
                            <Clock className="w-5 h-5 mx-auto mb-2 text-yellow-500" aria-hidden="true" />
                            <p className="text-sm text-muted-foreground">Expires</p>
                            <CountdownTimer
                                className="font-bold justify-center"
                                secondsRemaining={secondsUntil(pool.expiry)}
                                settled={pool.settled}
                            />
                            <time
                                className="mt-1 block text-xs text-muted-foreground"
                                dateTime={
                                    Number.isFinite(pool.expiry) && pool.expiry > 0
                                        ? new Date(pool.expiry * 1000).toISOString()
                                        : undefined
                                }
                            >
                                {formatMarketDeadline(pool.expiry)}
                            </time>
                        </div>
                    </div>

                    {/* Odds Display */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm text-muted-foreground" id="odds-bar-label">{t('betting.currentOdds')}</p>
                            <Tooltip content={t('betting.sharesPayoutInfo')}>
                                <button
                                    type="button"
                                    aria-label={t('betting.sharesPayoutInfoLabel')}
                                    className="inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors"
                                >
                                    <Info className="w-4 h-4" aria-hidden="true" />
                                </button>
                            </Tooltip>
                        </div>
                        <div
                            className="flex h-4 rounded-full overflow-hidden"
                            role="progressbar"
                            aria-labelledby="odds-bar-label"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={oddsAValue}
                            aria-valuetext={`${pool.outcomeA}: ${oddsA}, ${pool.outcomeB}: ${oddsB}`}
                        >
                            <div
                                className="bg-green-500 transition-all"
                                style={{ width: `${oddsAValue}%` }}
                                aria-hidden="true"
                            />
                            <div
                                className="bg-red-500 transition-all"
                                style={{ width: `${oddsBValue}%` }}
                                aria-hidden="true"
                            />
                        </div>
                        <div className="flex justify-between gap-3 mt-2 text-sm">
                            <span className="text-green-400 min-w-0 break-words">{pool.outcomeA}: {oddsA}</span>
                            <span className="text-red-400 min-w-0 break-words text-right">{pool.outcomeB}: {oddsB}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">{t('betting.sharesPayoutHint')}</p>
                    </div>

                    {/* User Bet Summary Card */}
                    {userBet && (userBet.amountA > 0 || userBet.amountB > 0) && (
                        <div className="mb-8 p-4 bg-primary/10 border border-primary/20 rounded-xl">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h3 className="text-lg font-semibold">Your Position</h3>
                                <Link
                                    href="/dashboard"
                                    className="rounded text-sm text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    View portfolio
                                </Link>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className={`p-3 rounded-lg ${userBet.amountA > 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-muted/50'}`}>
                                    <p className="text-sm text-muted-foreground">{pool.outcomeA}</p>
                                    <p className="text-xl font-bold">{formatPayout(stroopsToUnits(userBet.amountA))}</p>
                                </div>
                                <div className={`p-3 rounded-lg ${userBet.amountB > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-muted/50'}`}>
                                    <p className="text-sm text-muted-foreground">{pool.outcomeB}</p>
                                    <p className="text-xl font-bold">{formatPayout(stroopsToUnits(userBet.amountB))}</p>
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-primary/20 flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Total Staked</span>
                                <span className="font-bold">{formatPayout(stroopsToUnits(userBet.amountA + userBet.amountB))}</span>
                            </div>
                            {pool.settled && userHasWinnings && (
                                <div className="mt-2 text-sm text-green-400">
                                    Winner: {pool.winningOutcome === 0 ? pool.outcomeA : pool.outcomeB}
                                </div>
                            )}
                            {pool.settled && hasClaimedWinnings && (
                                <div className="mt-2 text-sm text-primary" role="status">
                                    Winnings already claimed for this market.
                                </div>
                            )}
                        </div>
                    )}

                    {/* Betting UI / Settled Summary */}
                    {pool.settled ? (
                        <div className="mt-6">
                            <SettledPoolSummary pool={pool} />
                            {/* Issue #1601: Show settlement status and claimable amount */}
                            <SettlementClaimCard
                                pool={pool}
                                userBet={userBet}
                                hasClaimedWinnings={hasClaimedWinnings}
                                userHasWinnings={userHasWinnings}
                                stxAddress={stxAddress}
                                poolId={poolId}
                                onClaimSuccess={refreshPoolData}
                            />
                        </div>
                    ) : pool.status === 'expired' ? (
                        <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                            <p className="text-sm text-yellow-400">
                                Betting is closed. This pool has expired and is awaiting settlement.
                            </p>
                        </div>
                    ) : pool.status === 'frozen' ? (
                        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                            <p className="text-sm text-blue-400">
                                Betting is closed. This pool is frozen.
                            </p>
                        </div>
                    ) : pool.status === 'disputed' ? (
                        <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl">
                            <p className="text-sm text-orange-400">
                                Betting is paused. This pool is under dispute and awaiting resolution.
                            </p>
                        </div>
                    ) : (
                        <div className="relative">
                            {isRefreshing && (
                                <div className="absolute -top-6 right-0 flex items-center gap-2 text-xs text-primary animate-pulse" role="status">
                                    <div className="w-2 h-2 bg-primary rounded-full" aria-hidden="true" />
                                    Reconciling on-chain data...
                                </div>
                            )}
                            <BettingSection
                                pool={pool}
                                poolId={poolId}
                                onBetSuccess={handleBetSuccess}
                            />
                        </div>
                    )}

                    <DisputeHistoryTimeline
                        events={disputeEvents}
                        isLoading={isLoadingDisputes}
                        error={disputeError}
                    />

                    <PoolActivityTimeline
                        poolId={poolId}
                        outcomeLabels={[pool.outcomeA, pool.outcomeB]}
                        maxInitialEvents={100}
                    />
                </div>
            </div>
        </main>
    );
}



