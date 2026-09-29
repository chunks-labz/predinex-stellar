'use client';

import { memo, useState, useEffect } from 'react';
import Link from 'next/link';
import {
    Trophy, Target, PlusCircle, Zap,
    ExternalLink, RefreshCw, TrendingUp, Clock
} from 'lucide-react';
import type { ActivityItem } from '../lib/adapters/types';
import { stroopsToUnits, TOKEN_SYMBOL } from '@/app/lib/formatting';

// --- Helpers ---

function timeAgo(timestamp: number, nowSeconds: number): string {
    const seconds = nowSeconds - timestamp;
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
}

function formatMicroSTX(micro: number): string {
    return stroopsToUnits(micro).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
    });
}

const TYPE_CONFIG = {
    'bet-placed': {
        icon: Target,
        label: 'Bet Placed',
        color: 'text-primary',
        bg: 'bg-primary/10',
        border: 'border-primary/20',
    },
    'winnings-claimed': {
        icon: Trophy,
        label: 'Winnings Claimed',
        color: 'text-green-400',
        bg: 'bg-green-400/10',
        border: 'border-green-400/20',
    },
    'pool-created': {
        icon: PlusCircle,
        label: 'Pool Created',
        color: 'text-accent',
        bg: 'bg-accent/10',
        border: 'border-accent/20',
    },
    'contract-call': {
        icon: Zap,
        label: 'Contract Call',
        color: 'text-yellow-400',
        bg: 'bg-yellow-400/10',
        border: 'border-yellow-400/20',
    },
};

const STATUS_STYLES = {
    success: 'bg-green-500/20 text-green-400 border-green-500/30',
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

// --- Loading Skeleton ---

function ActivitySkeleton() {
    return (
        <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-4 p-5 rounded-2xl border border-border/50 bg-card/20 animate-pulse"
                >
                    <div className="w-12 h-12 rounded-xl bg-muted/60" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-32 bg-muted/60 rounded" />
                        <div className="h-3 w-48 bg-muted/40 rounded" />
                    </div>
                    <div className="h-4 w-20 bg-muted/40 rounded" />
                </div>
            ))}
        </div>
    );
}

// --- Empty State ---

function EmptyState() {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
                <TrendingUp className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">No Activity Yet</h3>
            <p className="text-muted-foreground max-w-sm mb-6">
                Your on-chain activity with Predinex will appear here once you start predicting.
            </p>
            <Link
                href="/markets"
                className="px-6 py-3 bg-primary text-white font-bold rounded-xl hover:bg-primary/90 transition-all hover:scale-105 active:scale-95"
            >
                Explore Markets
            </Link>
        </div>
    );
}

// --- Activity Row ---

const ActivityRow = memo(function ActivityRow({ item, nowSeconds }: { item: ActivityItem; nowSeconds: number }) {
    const config = TYPE_CONFIG[item.type];
    const Icon = config.icon;

    const getEventLabel = () => {
        if (!item.event) return null;

        switch (item.event.type) {
            case 'bet':
                return `Bet on ${item.event.outcome === 0 ? 'Outcome A' : 'Outcome B'}`;
            case 'pool-creation':
                return item.event.poolTitle || 'New Pool Created';
            case 'settlement':
                return `Settled: ${item.event.outcome === 0 ? 'Outcome A' : 'Outcome B'} won`;
            case 'claim':
                return `Claimed ${formatMicroSTX(item.event.winnerAmount || 0)} ${TOKEN_SYMBOL}`;
            default:
                return null;
        }
    };

    return (
        <div
            className={`group flex items-center gap-4 p-5 rounded-2xl border ${config.border} bg-card/30 backdrop-blur-sm hover:bg-card/60 transition-all hover:shadow-lg hover:shadow-black/10 relative overflow-hidden`}
            role="listitem"
        >
            {/* Type Icon */}
            <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${config.bg} border ${config.border} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <Icon className={`w-5 h-5 ${config.color}`} />
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm">{config.label}</span>
                    <span className={`text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border ${STATUS_STYLES[item.status]}`}>
                        {item.status}
                    </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {item.event && (
                        <span className="font-medium text-foreground/90">{getEventLabel()}</span>
                    )}
                    {!item.event && item.poolId !== undefined && (
                        <span className="font-medium">Pool #{item.poolId}</span>
                    )}
                    {item.amount !== undefined && !item.event?.winnerAmount && (
                        <span className="font-mono font-medium text-foreground/80">{formatMicroSTX(item.amount)} {TOKEN_SYMBOL}</span>
                    )}
                    <span className="font-mono text-xs">{item.txId.slice(0, 10)}…</span>
                </div>
            </div>

            {/* Time & Link */}
            <div className="flex-shrink-0 flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Clock className="w-3 h-3" />
                    <span>{timeAgo(item.timestamp, nowSeconds)}</span>
                </div>
                <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg bg-muted/40 hover:bg-primary hover:text-white transition-all opacity-0 group-hover:opacity-100"
                    aria-label="View on Stellar Explorer"
                    onClick={(e) => e.stopPropagation()}
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>

            {/* Hover gradient */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
        </div>
    );
});

// --- Main Component ---

interface ActivityFeedProps {
    activities: ActivityItem[];
    isLoading: boolean;
    error: string | null;
    onRefresh?: () => void;
    limit?: number;
    showHeader?: boolean;
}

const ActivityFeed = memo(function ActivityFeed({
    activities,
    isLoading,
    error,
    onRefresh,
    limit,
    showHeader = true,
}: ActivityFeedProps) {
    const displayItems = limit ? activities.slice(0, limit) : activities;

    // Effect-managed timer so render output is derived from state, not direct Date.now() calls
    const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const interval = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 30000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="w-full">
            {showHeader && (
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-2 h-6 bg-accent rounded-full" />
                        <h2 className="text-2xl font-black">Recent Activity</h2>
                    </div>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            disabled={isLoading}
                            className="p-2 rounded-xl bg-muted/50 hover:bg-muted border border-border text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
                            aria-label="Refresh activity"
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    )}
                </div>
            )}

            {error && (
                <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-sm mb-4">
                    {error}
                </div>
            )}

            {isLoading ? (
                <ActivitySkeleton />
            ) : displayItems.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="space-y-3" role="list" aria-label="Activity feed">
                    {displayItems.map((item) => (
                        <ActivityRow key={item.txId} item={item} nowSeconds={nowSeconds} />
                    ))}
                </div>
            )}

            {limit && activities.length > limit && (
                <div className="text-center mt-6">
                    <Link
                        href="/activity"
                        className="inline-flex items-center gap-2 text-primary font-bold hover:underline text-sm"
                    >
                        View All Activity
                        <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                </div>
            )}
        </div>
    );
});

export default ActivityFeed;
