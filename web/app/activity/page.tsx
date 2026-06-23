'use client';

import { useState } from 'react';
import Navbar from '../components/Navbar';
import AuthGuard from '../components/AuthGuard';
import ActivityFeed from '../components/ActivityFeed';
import { useWallet } from '../components/WalletAdapterProvider';
import { useUserActivity } from '../hooks/useUserActivity';
import { Activity, Target, Trophy, TrendingUp } from 'lucide-react';

type FilterType = 'all' | 'bet-placed' | 'winnings-claimed' | 'pool-created';

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'bet-placed', label: 'Bets' },
    { value: 'winnings-claimed', label: 'Claims' },
    { value: 'pool-created', label: 'Pools' },
];

export default function ActivityPage() {
    const { address: stxAddress } = useWallet();
    const { activities, isLoading, error, refresh } = useUserActivity(stxAddress ?? undefined, 50);
    const [activeFilter, setActiveFilter] = useState<FilterType>('all');

    const filteredActivities = activeFilter === 'all'
        ? activities
        : activities.filter(a => a.type === activeFilter);

    // Compute stats
    const totalBets = activities.filter(a => a.type === 'bet-placed').length;
    const totalClaims = activities.filter(a => a.type === 'winnings-claimed').length;
    const successCount = activities.filter(a => a.status === 'success').length;
    const successRate = activities.length > 0 ? Math.round((successCount / activities.length) * 100) : 0;

    const stats = [
        { label: 'Total Bets', value: totalBets, icon: Target, color: 'text-primary' },
        { label: 'Winnings Claimed', value: totalClaims, icon: Trophy, color: 'text-green-400' },
        { label: 'Success Rate', value: `${successRate}%`, icon: TrendingUp, color: 'text-accent' },
        { label: 'Transactions', value: activities.length, icon: Activity, color: 'text-purple-400' },
    ];

    return (
        <main className="min-h-screen bg-background text-foreground">
            <Navbar />
            <AuthGuard>
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Page Header */}
                    <div className="glass-panel p-8 rounded-2xl mb-8">
                        <h1 className="text-4xl font-black mb-2 bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
                            Activity Feed
                        </h1>
                        <p className="text-muted-foreground">
                            Your on-chain prediction history on Stellar
                        </p>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                        {stats.map((stat, i) => (
                            <div
                                key={i}
                                className="p-5 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-md hover:border-primary/30 transition-all group relative overflow-hidden"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 rounded-xl bg-background/50 border border-border group-hover:scale-110 transition-transform">
                                        <stat.icon className={`w-4 h-4 ${stat.color}`} />
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{stat.label}</p>
                                        <p className="text-xl font-black">{isLoading ? '—' : stat.value}</p>
                                    </div>
                                </div>
                                <div className={`absolute -bottom-2 -right-2 w-12 h-12 opacity-[0.03] group-hover:opacity-10 transition-opacity ${stat.color}`}>
                                    <stat.icon className="w-full h-full" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Filter Controls */}
                    <div className="flex items-center gap-2 mb-6">
                        {FILTER_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() => setActiveFilter(opt.value)}
                                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${activeFilter === opt.value
                                        ? 'bg-primary text-white shadow-lg shadow-primary/20'
                                        : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-border'
                                    }`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Activity Feed */}
                    <div className="p-8 rounded-3xl border border-border bg-card/40 glass shadow-xl">
                        <ActivityFeed
                            activities={filteredActivities}
                            isLoading={isLoading}
                            error={error}
                            onRefresh={refresh}
                        />
                    </div>
                </div>
            </AuthGuard>
        </main>
    );
}
