'use client';

import { useState, useEffect, useCallback } from 'react';
import { getMarkets } from '../soroban-read-api';
import type { PlatformMetrics } from '../analytics/types';

interface AnalyticsData {
  metrics: PlatformMetrics | null;
  volumeHistory: { label: string; value: number }[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

function normalizeTimestamp(ts: unknown): number | null {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null;
  // Heuristic: treat seconds as milliseconds if small
  if (ts > 0 && ts < 1_000_000_000_000) {
    return ts * 1000;
  }
  if (ts > 1_000_000_000_000 && ts < 10_000_000_000_000) {
    return ts;
  }
  return null;
}

function getMarketCreatedAt(market: any): number | null {
  const candidates = [
    market?.createdAt,
    market?.created_at,
    market?.startTime,
    market?.start_time,
    market?.openTime,
    market?.open_time,
  ];
  for (const c of candidates) {
    const n = normalizeTimestamp(c);
    if (n !== null) return n;
  }
  return null;
}

function sumMarketVolume(market: any): number {
  const a = Number(market?.totalA ?? market?.total_a ?? 0);
  const b = Number(market?.totalB ?? market?.total_b ?? 0);
  const total = Number(market?.totalVolume ?? market?.total_volume);
  if (Number.isFinite(total) && total > 0) return total;
  return a + b;
}

export function useAnalytics(range: '7d' | '30d' | 'all' = '7d'): AnalyticsData {
  const [state, setState] = useState<AnalyticsData>({
    metrics: null,
    volumeHistory: [],
    isLoading: true,
    error: null,
    refetch: () => {},
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const markets = await getMarkets('all');
      const totalVolume = markets.reduce((sum, m) => sum + sumMarketVolume(m), 0);

      const activePools = markets.filter((m: any) => m.status === 'active').length;
      const settledPools = markets.filter((m: any) => m.status === 'settled').length;
      const expiredPools = markets.filter((m: any) => m.status === 'expired').length;

      const now = Date.now();
      const DAY = 86_400_000;
      const days = range === '30d' ? 30 : range === 'all' ? 90 : 7; // cap all to reasonable window

      const volumeHistory = Array.from({ length: days }, (_, i) => {
        const idx = days - 1 - i;
        const dayStart = now - idx * DAY;
        const dayEnd = dayStart + DAY;
        const label =
          days === 7
            ? new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short' })
            : new Date(dayStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        let dayVolume = 0;
        for (const market of markets) {
          const createdAt = getMarketCreatedAt(market);
          if (createdAt !== null && createdAt >= dayStart && createdAt < dayEnd) {
            dayVolume += sumMarketVolume(market);
          } else if (createdAt === null) {
            // Fallback: distribute unknowns to recent period only if no timestamps exist
            // Avoid putting everything on today
          }
        }
        // If we have no timestamped markets, fall back to proportional-ish distribution
        if (dayVolume === 0 && markets.length > 0) {
          const withTs = markets.filter((m) => getMarketCreatedAt(m) !== null);
          if (withTs.length === 0 && idx === days - 1) {
            dayVolume = totalVolume;
          }
        }
        return { label, value: dayVolume };
      });

      const dailyVolume = volumeHistory[volumeHistory.length - 1]?.value ?? 0;
      const weeklyVolume =
        range === '7d'
          ? volumeHistory.reduce((s, d) => s + d.value, 0)
          : volumeHistory.slice(-7).reduce((s, d) => s + d.value, 0);
      const monthlyVolume =
        range === '30d' || range === 'all'
          ? volumeHistory.slice(-30).reduce((s, d) => s + d.value, 0)
          : volumeHistory.reduce((s, d) => s + d.value, 0);

      const previousWeek = volumeHistory.slice(-14, -7).reduce((s, d) => s + d.value, 0);
      const currentWeek = weeklyVolume;
      const volumeGrowthRate =
        previousWeek > 0 ? ((currentWeek - previousWeek) / previousWeek) * 100 : currentWeek > 0 ? 100 : 0;

      const metrics: PlatformMetrics = {
        totalVolume,
        dailyVolume,
        weeklyVolume,
        monthlyVolume,
        totalPools: markets.length,
        activePools,
        settledPools,
        expiredPools,
        averagePoolSize: markets.length > 0 ? totalVolume / markets.length : 0,
        totalUsers: 0,
        activeUsers: 0,
        newUsers: 0,
        userRetentionRate: 0,
        averageSettlementTime: 0,
        disputeRate: 0,
        platformFees: totalVolume * 0.01,
        volumeGrowthRate,
        userGrowthRate: 0,
        poolGrowthRate: 0,
      };

      setState({ metrics, volumeHistory, isLoading: false, error: null, refetch: load });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load analytics',
        refetch: load,
      }));
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setState((prev) => ({ ...prev, refetch: load }));
  }, [load]);

  return state;
}
