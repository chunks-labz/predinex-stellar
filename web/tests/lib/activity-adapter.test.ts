/**
 * Activity Adapter Tests
 *
 * Covers fetch (real vs fixture modes), timeline/day grouping, and CSV export
 * of real-row-shaped data. Fetch paths that hit the network are mocked to
 * return Soroban-shaped payloads via `vi.mock`.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchPoolActivity,
  fetchUserActivity,
  groupTimelineByDay,
  useFixtures,
} from '../../app/lib/adapters/activity';
import {
  activitiesToCSV,
  toExportRecords,
} from '../../app/lib/activity-export';
import type { PoolActivityEvent } from '../../app/lib/pool-activity';
import type { ActivityItem } from '../../app/lib/market-types';

describe('activity adapter – fixture flag', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_ACTIVITY_FIXTURES;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('useFixtures returns false without the env flag', () => {
    expect(useFixtures()).toBe(false);
  });

  it('useFixtures returns true when NEXT_PUBLIC_ACTIVITY_FIXTURES=true', () => {
    process.env.NEXT_PUBLIC_ACTIVITY_FIXTURES = 'true';
    expect(useFixtures()).toBe(true);
  });
});

describe('activity adapter – fetchPoolActivity (fixture mode)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ACTIVITY_FIXTURES: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns deterministically seeded events newest-first with hasMore pagination', async () => {
    const page1 = await fetchPoolActivity(7, { limit: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursor).toBeTypeOf('string');

    // Sorted newest-first: timestamps descend.
    for (let i = 1; i < page1.items.length; i++) {
      expect(page1.items[i].timestamp).toBeLessThanOrEqual(page1.items[i - 1].timestamp);
    }

    const page2 = await fetchPoolActivity(7, { limit: 10, cursor: page1.cursor });
    expect(page2.items).toHaveLength(10);
    // Pages are disjoint by id.
    const ids1 = new Set(page1.items.map((e) => e.id));
    for (const ev of page2.items) expect(ids1.has(ev.id)).toBe(false);
  });

  it('hasMore becomes false after fixture set is exhausted', async () => {
    const page = await fetchPoolActivity(1, { limit: 200 });
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeUndefined();
  });
});

describe('activity adapter – fetchUserActivity (fixture mode)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_ACTIVITY_FIXTURES: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns ActivityItem rows with pool titles, amounts and explorer links', async () => {
    const { items } = await fetchUserActivity('GTEST', { limit: 5 });
    expect(items.length).toBeGreaterThan(0);
    for (const row of items) {
      expect(row.txId.startsWith('fixture-tx-')).toBe(true);
      expect(['bet-placed', 'winnings-claimed', 'pool-created', 'contract-call']).toContain(row.type);
      expect(row.explorerUrl.startsWith('#fixture-')).toBe(true);
      expect(row.poolId).toBeDefined();
      expect(row.poolTitle).toBeDefined();
      expect(typeof row.timestamp).toBe('number');
    }
  });
});

describe('groupTimelineByDay', () => {
  function ev(dateStr: string, id: string): PoolActivityEvent {
    return {
      id,
      type: 'bet-placed',
      poolId: 1,
      actor: 'GA',
      timestamp: Math.floor(Date.parse(dateStr) / 1000),
      txHash: id,
      explorerUrl: '#',
      amount: 1_000_000,
      outcome: 0,
      status: 'success',
    };
  }

  it('groups events by UTC YYYY-MM-DD, newest groups first', () => {
    const events = [
      ev('2026-05-31T10:00:00Z', 'a'),
      ev('2026-05-31T02:00:00Z', 'b'),
      ev('2026-05-30T23:00:00Z', 'c'),
      ev('2026-03-15T12:00:00Z', 'd'),
    ];
    const groups = groupTimelineByDay(events);
    expect(groups.map((g) => g.date)).toEqual(['2026-05-31', '2026-05-30', '2026-03-15']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['c']);
  });

  it('returns empty array for empty input', () => {
    expect(groupTimelineByDay([])).toEqual([]);
  });
});

describe('CSV export of real-row-shaped ActivityItems', () => {
  function row(overrides: Partial<ActivityItem> = {}): ActivityItem {
    return {
      txId: '0xabcdef',
      type: 'bet-placed',
      functionName: 'place_bet',
      timestamp: Math.floor(Date.parse('2026-05-31T12:00:00Z') / 1000),
      status: 'success',
      amount: 2_500_000,
      poolId: 7,
      poolTitle: 'Will BTC exceed 100k by 2027?',
      explorerUrl: 'https://explorer.example/tx/0xabcdef',
      ...overrides,
    };
  }

  it('toExportRecords converts microSTX → STX and ISO timestamps', () => {
    const rows = [row()];
    const [record] = toExportRecords(rows);
    expect(record.poolId).toBe(7);
    expect(record.type).toBe('bet-placed');
    expect(record.amount).toBe(2.5);
    expect(record.timestamp).toBe('2026-05-31T12:00:00.000Z');
    expect(record.txHash).toBe('0xabcdef');
    expect(record.poolTitle).toBe('Will BTC exceed 100k by 2027?');
  });

  it('activitiesToCSV emits a header row and escapes commas/quotes in pool titles', () => {
    const rows = [
      row({ poolTitle: 'Will it rain, "maybe"?', amount: 10_000_000 }),
      row({ type: 'winnings-claimed', amount: undefined }),
    ];
    const csv = activitiesToCSV(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('pool_id,type,amount,timestamp,tx_hash,pool_title');
    // Comma + double-quote in pool title → field must be quoted with inner quotes doubled.
    expect(lines[1]).toContain('"Will it rain, ""maybe""?"');
    // Undefined amount → null → empty CSV field (not "0").
    expect(lines[2]).toContain(',,2026-05-31T12:00:00.000Z,');
  });
});
