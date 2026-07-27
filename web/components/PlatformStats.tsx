"use client";

import { useEffect, useState } from 'react';
import { predinexReadApi } from '@/app/lib/adapters/predinex-read-api';
import { BarChart3, Users, Layers, Activity, AlertCircle } from 'lucide-react';
import { createScopedLogger } from '@/app/lib/logger';
import Card from './ui/Card';

const log = createScopedLogger('PlatformStats');

export default function PlatformStats() {
    const [stats, setStats] = useState({
        totalVolume: 0,
        activeMarkets: 0,
        totalPools: 0,
        isLoaded: false
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchStats() {
            try {
                const volume = await predinexReadApi.getTotalVolume();
                const markets = await predinexReadApi.getMarkets('all');
                setStats({
                    totalVolume: volume,
                    activeMarkets: markets.filter(m => !m.settled).length,
                    totalPools: markets.length,
                    isLoaded: true
                });
            } catch (err) {
                log.error('Failed to fetch platform stats', err);
                setError('Failed to load platform stats');
                setStats(prev => ({ ...prev, isLoaded: true }));
            }
        }
        fetchStats();
    }, []);

    if (!stats.isLoaded) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 bg-card/20 animate-pulse rounded-2xl border border-border/50" />
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
            </div>
        );
    }

    const items = [
        { label: 'Total Volume', value: `${stats.totalVolume.toLocaleString()} XLM`, icon: Activity, color: 'text-primary' },
        { label: 'Active Markets', value: stats.activeMarkets, icon: Layers, color: 'text-accent' },
        { label: 'Total Pools', value: stats.totalPools, icon: BarChart3, color: 'text-purple-400' },
        { label: 'Community', value: '2.4k+', icon: Users, color: 'text-green-400' },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {items.map((item, i) => (
                <Card key={i} className="p-4 bg-card/40 backdrop-blur-md border-border/50 hover:border-primary/30 transition-all group overflow-hidden relative">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl bg-background/50 border border-border group-hover:scale-110 transition-transform`}>
                            <item.icon className={`w-5 h-5 ${item.color}`} />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">{item.label}</p>
                            <p className="text-xl font-black">{item.value}</p>
                        </div>
                    </div>
                    <div className={`absolute -bottom-2 -right-2 w-16 h-16 opacity-[0.03] group-hover:opacity-10 transition-opacity ${item.color}`}>
                        <item.icon className="w-full h-full" />
                    </div>
                </Card>
            ))}
        </div>
    );
}
