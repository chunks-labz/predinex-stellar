'use client';

import { useState, useEffect } from 'react';
import { getMarkets, getTotalVolume } from '../stacks-api';
import type { PlatformMetrics } from '../analytics/types';

interface AnalyticsData {
  metrics: PlatformMetrics | null;
  volumeHistory: { label: string; value: number }[];
  isLoading: boolean;
  error: string | null;
}

export function useAnalytics(): AnalyticsData {
  const [state, setState] = useState<AnalyticsData>({
    metrics: null,
    volumeHistory: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    async function load() {
      try {
        const [markets, totalVolume] = await Promise.all([
          getMarkets('all'),
          getTotalVolume(),
        ]);

        const activePools = markets.filter((m) => m.status === 'active').length;
        const settledPools = markets.filter((m) => m.status === 'settled').length;
        const expiredPools = markets.filter((m) => m.status === 'expired').length;

        type MarketWithCreatedAt = (typeof markets)[number] & { createdAt: number };
        const marketsWithCreatedAt = markets.filter(
          (market): market is MarketWithCreatedAt =>
            typeof (market as { createdAt?: unknown }).createdAt === 'number'
        );

        // Prefer real creation timestamps when available. Older adapters do not
        // expose them yet, so keep analytics functional with a conservative fallback.
        const now = Date.now();
        const DAY = 86_400_000;
        const volumeHistory = Array.from({ length: 7 }, (_, i) => {
          const dayStart = now - (6 - i) * DAY;
          const dayEnd = dayStart + DAY;
          const dayVolume =
            marketsWithCreatedAt.length > 0
              ? marketsWithCreatedAt
                  .filter((market) => market.createdAt >= dayStart && market.createdAt < dayEnd)
                  .reduce((sum, market) => sum + Number(market.totalA ?? 0) + Number(market.totalB ?? 0), 0)
              : i === 6
                ? totalVolume
                : 0;
          return {
            label: new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short' }),
            value: dayVolume,
          };
        });

        const metrics: PlatformMetrics = {
          totalVolume,
          dailyVolume: volumeHistory[6]?.value ?? 0,
          weeklyVolume: volumeHistory.reduce((s, d) => s + d.value, 0),
          monthlyVolume: totalVolume,
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
          volumeGrowthRate: 0,
          userGrowthRate: 0,
          poolGrowthRate: 0,
        };

        setState({ metrics, volumeHistory, isLoading: false, error: null });
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load analytics',
        }));
      }
    }
    void load();
  }, []);

  return state;
}
