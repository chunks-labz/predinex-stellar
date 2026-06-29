'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Star, StarOff, RefreshCw } from 'lucide-react';

import { usePoolFavorites } from '../../lib/hooks/usePoolFavorites';
import type { ProcessedMarket } from '../../lib/market-types';
import { readMarketListCache } from '../../lib/market-list-cache';
import { getEnhancedPool } from '../../lib/enhanced-stacks-api';
import { fetchCurrentBlockHeightLive, processMarketData } from '../../lib/market-utils';
import { useToast } from '../../../providers/ToastProvider';

const FAVORITE_SNAPSHOT_KEY = 'predinex_favorite_snapshot_v1';

function snapshotOfMarket(market: ProcessedMarket): string {
  // Compact snapshot so we can cheaply diff per-market.
  return `${market.status}|${market.timeRemaining ?? 'na'}|${market.oddsA}|${market.oddsB}`;
}

function safeReadSnapshot(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FAVORITE_SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function safeWriteSnapshot(next: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAVORITE_SNAPSHOT_KEY, JSON.stringify(next));
  } catch {
    // best-effort
  }
}

export default function FavoritePoolsCard() {
  const { favoritePoolIds, isFavorite, toggleFavorite } = usePoolFavorites();
  const { showToast } = useToast();

  const [favoriteMarkets, setFavoriteMarkets] = useState<ProcessedMarket[]>([]);
  const [isUpdating, setIsUpdating] = useState(false);

  const lastNotifiedSnapshotRef = useRef<Record<string, string>>({});

  const favoriteIdSet = useMemo(() => new Set(favoritePoolIds), [favoritePoolIds]);

  // Fast path: show cached processed markets immediately (MarketListPreloader warms this).
  useEffect(() => {
    const cached = readMarketListCache();
    if (favoritePoolIds.length === 0) {
      setFavoriteMarkets([]);
      return;
    }

    const byId = new Map(cached.markets.map((m) => [m.poolId, m]));
    const initial = favoritePoolIds.map((id) => byId.get(id)).filter(Boolean) as ProcessedMarket[];
    setFavoriteMarkets(initial);
  }, [favoritePoolIds]);

  const update = useCallback(async () => {
    if (favoritePoolIds.length === 0) return;

    setIsUpdating(true);
    try {
      const heightResult = await fetchCurrentBlockHeightLive({ timeoutMs: 5000 });
      const currentBlockHeight = heightResult.height;

      const poolDatas = await Promise.all(
        favoritePoolIds.map(async (poolId) => {
          try {
            return await getEnhancedPool(poolId);
          } catch {
            return null;
          }
        })
      );

      const processed: ProcessedMarket[] = poolDatas
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((poolData) => processMarketData(poolData, currentBlockHeight));

      // Ensure stable ordering for diffing & rendering.
      processed.sort((a, b) => a.poolId - b.poolId);
      setFavoriteMarkets(processed);

      const prev = lastNotifiedSnapshotRef.current || safeReadSnapshot();
      const nextSnap: Record<string, string> = {};
      for (const m of processed) nextSnap[String(m.poolId)] = snapshotOfMarket(m);

      const changes: ProcessedMarket[] = [];
      for (const m of processed) {
        const prevSnap = prev[String(m.poolId)];
        const nextSnapForPool = nextSnap[String(m.poolId)];
        if (prevSnap && prevSnap !== nextSnapForPool) changes.push(m);
      }

      if (changes.length > 0) {
        for (const changed of changes.slice(0, 5)) {
          const prevSnap = prev[String(changed.poolId)];
          const prevStatus = prevSnap?.split('|')?.[0];
          if (prevStatus && prevStatus !== changed.status) {
            showToast(
              `Favorite pool #${changed.poolId} is now ${changed.status}.`,
              'info'
            );
          } else {
            showToast(`Favorite pool #${changed.poolId} updated.`, 'info');
          }
        }
      }

      // Update snapshot after processing so we don't re-notify on the next tick.
      lastNotifiedSnapshotRef.current = nextSnap;
      safeWriteSnapshot(nextSnap);
    } finally {
      setIsUpdating(false);
    }
  }, [favoritePoolIds, showToast]);

  useEffect(() => {
    if (favoritePoolIds.length === 0) return;

    lastNotifiedSnapshotRef.current = safeReadSnapshot();
    void update();

    const timer = window.setInterval(() => {
      void update();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [favoritePoolIds, update]);

  if (favoritePoolIds.length === 0) {
    return (
      <div className="glass p-6 rounded-xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Favorites</h3>
          <StarOff className="w-5 h-5 text-muted-foreground" />
        </div>

        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-2">No favorite pools yet.</p>
          <p className="text-xs text-muted-foreground">Use the star icon on a market to bookmark it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass p-6 rounded-xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">Favorites</h3>
        <div className="flex items-center gap-2">
          {isUpdating && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
          <span className="text-sm text-muted-foreground">{favoriteMarkets.length} pinned</span>
        </div>
      </div>

      <div className="space-y-3">
        {favoriteMarkets
          .filter((m) => favoriteIdSet.has(m.poolId))
          .map((market) => {
            const statusLabel =
              market.status === 'active'
                ? 'Active'
                : market.status === 'settled'
                  ? 'Settled'
                  : 'Expired';

            return (
              <div
                key={market.poolId}
                className="flex items-center justify-between gap-3 p-3 bg-muted/30 border border-border/50 rounded-lg hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/markets/${market.poolId}`}
                    className="font-medium hover:text-primary transition-colors flex items-center gap-2"
                  >
                    <span className="truncate">{market.title}</span>
                  </Link>
                  <div className="text-xs text-muted-foreground mt-1">
                    {statusLabel}
                    {market.timeRemaining !== null && market.status === 'active' ? ` • ${market.timeRemaining} blocks` : ''}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => toggleFavorite(market.poolId)}
                  aria-label={`Unfavorite pool #${market.poolId}`}
                  className="p-2 rounded-lg border border-border/50 bg-background hover:bg-muted/40 transition-colors shrink-0"
                >
                  {isFavorite(market.poolId) ? (
                    <Star className="w-4 h-4 text-yellow-400" fill="currentColor" strokeWidth={2} />
                  ) : (
                    <StarOff className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            );
          })}

        {favoriteMarkets.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">
            Favorites pinned, but no market data is available yet.
          </div>
        )}
      </div>
    </div>
  );
}

