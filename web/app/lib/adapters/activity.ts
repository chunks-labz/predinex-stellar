/**
 * Activity Adapter
 *
 * Aggregates pool-lifecycle events and user bet/claim history from the
 * canonical read-side (`predinexReadApi`) so that the `ActivityFeed`,
 * `PoolActivityTimeline`, and `ActivityExportButton` components consume a
 * single typed source instead of building rows ad-hoc.
 *
 * Offline/dev mode: set `NEXT_PUBLIC_ACTIVITY_FIXTURES=true` to swap the
 * real read-side for a deterministic in-memory fixture source. This is an
 * explicit opt-in — components never silently fall back to mocks.
 */

import type { ActivityItem } from '../market-types';
import type { PoolActivityEvent } from '../pool-activity';
import { predinexReadApi } from './predinex-read-api';
import { getRuntimeConfig } from '../runtime-config';
import { createScopedLogger } from '../logger';

const log = createScopedLogger('adapters/activity');

export interface Pagination {
  limit?: number;
  cursor?: string;
}

export interface FetchActivityResult<T> {
  items: T[];
  cursor?: string;
  hasMore: boolean;
}

export function useFixtures(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_ACTIVITY_FIXTURES === 'true'
  );
}

// ---------------------------------------------------------------------------
// Fixtures (offline/dev) – deterministic seeds, stable under pagination
// ---------------------------------------------------------------------------

function makeFixturePoolActivityEvents(poolId: number, count: number): PoolActivityEvent[] {
  const now = Math.floor(Date.now() / 1000);
  const types: PoolActivityEvent['type'][] = [
    'pool-created',
    'bet-placed',
    'bet-placed',
    'bet-placed',
    'bet-cancelled',
    'pool-settled',
    'claim-processed',
  ];
  return Array.from({ length: count }, (_, i) => {
    const type = types[i % types.length];
    const outcome = type === 'bet-placed' || type === 'pool-settled' ? (i % 2) : undefined;
    const amount =
      type === 'bet-placed' || type === 'claim-processed'
        ? (5_000_000 + i * 250_000)
        : undefined;
    return {
      id: `fixture-${poolId}-${i}`,
      type,
      poolId,
      actor: `G${'A'.repeat(50)}${i.toString(36).padStart(5, '0')}`,
      timestamp: now - i * 300,
      txHash: `fixture-tx-${poolId}-${i}`,
      explorerUrl: `#fixture-${poolId}-${i}`,
      amount,
      outcome,
      status: 'success',
    };
  });
}

function makeFixtureUserActivity(address: string, count: number): ActivityItem[] {
  const now = Math.floor(Date.now() / 1000);
  const types: ActivityItem['type'][] = [
    'bet-placed',
    'bet-placed',
    'winnings-claimed',
    'pool-created',
    'bet-placed',
  ];
  return Array.from({ length: count }, (_, i) => {
    const type = types[i % types.length];
    const poolId = 100 + (i % 7);
    return {
      txId: `fixture-tx-user-${i}`,
      type,
      functionName: type.replace('-', '_'),
      timestamp: now - i * 600,
      status: 'success',
      amount: type === 'bet-placed' || type === 'winnings-claimed' ? 2_500_000 + i * 100_000 : undefined,
      poolId,
      poolTitle: `Fixture Pool #${poolId}`,
      explorerUrl: `#fixture-user-${i}`,
    };
  });
}

// ---------------------------------------------------------------------------
// Pool activity (per-pool timeline)
// ---------------------------------------------------------------------------

/**
 * Fetch a page of pool-lifecycle events for the given pool ID, newest first.
 * Mirrors the dashboard read path: real data comes through the Soroban event
 * pipeline via `usePoolActivity`, and the fixture path is used only when
 * the explicit flag is set.
 */
export async function fetchPoolActivity(
  poolId: number,
  pagination: Pagination = {},
): Promise<FetchActivityResult<PoolActivityEvent>> {
  const limit = pagination.limit ?? 100;

  if (useFixtures()) {
    const all = makeFixturePoolActivityEvents(poolId, 30);
    const start = pagination.cursor ? parseInt(pagination.cursor, 10) || 0 : 0;
    const items = all.slice(start, start + limit);
    const nextCursor = start + items.length < all.length ? String(start + items.length) : undefined;
    return { items, cursor: nextCursor, hasMore: !!nextCursor };
  }

  const cfg = getRuntimeConfig();
  const { soroban } = cfg;

  if (!soroban.rpcUrl || !soroban.contractId) {
    log.warn('fetchPoolActivity: Soroban config missing, returning empty');
    return { items: [], hasMore: false };
  }

  const { fetchPoolActivityFromSoroban } = await import('../hooks/usePoolActivity');
  const res = await fetchPoolActivityFromSoroban(poolId, limit, pagination.cursor);
  return {
    items: res.events,
    cursor: res.cursor,
    hasMore: res.rawCount >= limit && res.events.length > 0,
  };
}

// ---------------------------------------------------------------------------
// User activity (wallet-wide feed + CSV export)
// ---------------------------------------------------------------------------

/**
 * Fetch per-user activity rows. The canonical path is `predinexReadApi`;
 * `NEXT_PUBLIC_ACTIVITY_FIXTURES=true` returns deterministic seeded rows
 * so offline/dev export and layout QA stay functional.
 */
export async function fetchUserActivity(
  address: string,
  pagination: Pagination = {},
): Promise<FetchActivityResult<ActivityItem>> {
  const limit = pagination.limit ?? 100;

  if (useFixtures()) {
    const all = makeFixtureUserActivity(address, 20);
    const start = pagination.cursor ? parseInt(pagination.cursor, 10) || 0 : 0;
    const items = all.slice(start, start + limit);
    const nextCursor = start + items.length < all.length ? String(start + items.length) : undefined;
    return { items, cursor: nextCursor, hasMore: !!nextCursor };
  }

  const items: ActivityItem[] = await predinexReadApi.getUserActivity(address, limit);
  return { items, hasMore: items.length >= limit };
}

/**
 * Group timeline events by calendar day (UTC) for sectioned renderers.
 * `events` are assumed pre-sorted newest-first; the returned groups are
 * also newest-first with section keys formatted as `YYYY-MM-DD`.
 */
export function groupTimelineByDay(
  events: PoolActivityEvent[],
): Array<{ date: string; items: PoolActivityEvent[] }> {
  const byDay = new Map<string, PoolActivityEvent[]>();
  for (const ev of events) {
    const key = new Date(ev.timestamp * 1000).toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(ev);
    else byDay.set(key, [ev]);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, items]) => ({ date, items }));
}
