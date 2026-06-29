import { describe, it, expect } from 'vitest';
import type { ActivityItem } from '../../app/lib/stacks-api';
import {
  EXPORT_MAX_WINDOW_DAYS,
  activitiesToCSV,
  activitiesToJSON,
  buildExportFilename,
  filterActivitiesForExport,
  resolveExportWindow,
  toExportRecords,
} from '../../app/lib/activity-export';

const DAY = 24 * 60 * 60;

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    txId: '0xabc',
    type: 'bet-placed',
    functionName: 'place-bet',
    timestamp: Date.parse('2026-03-15T12:00:00.000Z') / 1000,
    status: 'success',
    amount: 2_500_000, // 2.5 STX in micro-STX
    poolId: 7,
    poolTitle: 'Will it rain?',
    explorerUrl: 'https://explorer.example/tx/0xabc',
    ...overrides,
  };
}

describe('resolveExportWindow', () => {
  const now = Date.parse('2026-05-31T00:00:00.000Z');

  it('defaults to the most recent 90 days when no bounds are given', () => {
    const window = resolveExportWindow('', '', now);
    expect(window.to).toBe('2026-05-31');
    expect(window.from).toBe('2026-03-02'); // 90 days earlier
    expect(window.clamped).toBe(false);
  });

  it('respects an explicit in-range window', () => {
    const window = resolveExportWindow('2026-05-01', '2026-05-15', now);
    expect(window).toEqual({ from: '2026-05-01', to: '2026-05-15', clamped: false });
  });

  it('clamps ranges wider than 90 days by moving the start forward', () => {
    const window = resolveExportWindow('2026-01-01', '2026-05-31', now);
    expect(window.to).toBe('2026-05-31');
    expect(window.from).toBe('2026-03-02');
    expect(window.clamped).toBe(true);
  });

  it('collapses an inverted range to an empty window', () => {
    const window = resolveExportWindow('2026-05-20', '2026-05-10', now);
    expect(window.from).toBe('2026-05-10');
    expect(window.to).toBe('2026-05-10');
  });
});

describe('filterActivitiesForExport', () => {
  it('keeps only activities inside the inclusive window', () => {
    const items = [
      makeActivity({ txId: 'before', timestamp: Date.parse('2026-02-28T00:00:00Z') / 1000 }),
      makeActivity({ txId: 'inside', timestamp: Date.parse('2026-03-10T00:00:00Z') / 1000 }),
      makeActivity({ txId: 'edge', timestamp: Date.parse('2026-03-31T23:00:00Z') / 1000 }),
      makeActivity({ txId: 'after', timestamp: Date.parse('2026-04-05T00:00:00Z') / 1000 }),
    ];
    const result = filterActivitiesForExport(items, {
      from: '2026-03-01',
      to: '2026-03-31',
      clamped: false,
    });
    expect(result.map((item) => item.txId)).toEqual(['inside', 'edge']);
  });
});

describe('toExportRecords', () => {
  it('maps the documented fields and converts amount to STX', () => {
    expect(toExportRecords([makeActivity()])).toEqual([
      {
        poolId: 7,
        type: 'bet-placed',
        amount: 2.5,
        timestamp: '2026-03-15T12:00:00.000Z',
        txHash: '0xabc',
        poolTitle: 'Will it rain?',
      },
    ]);
  });

  it('uses null/empty fallbacks for missing optional fields', () => {
    const record = toExportRecords([
      makeActivity({ amount: undefined, poolId: undefined, poolTitle: undefined }),
    ])[0];
    expect(record.amount).toBeNull();
    expect(record.poolId).toBeNull();
    expect(record.poolTitle).toBe('');
  });
});

describe('activitiesToCSV', () => {
  it('produces a header row plus one row per activity', () => {
    const csv = activitiesToCSV([makeActivity()]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('pool_id,type,amount,timestamp,tx_hash,pool_title');
    expect(lines[1]).toBe('7,bet-placed,2.5,2026-03-15T12:00:00.000Z,0xabc,Will it rain?');
  });

  it('escapes fields containing commas or quotes', () => {
    const csv = activitiesToCSV([makeActivity({ poolTitle: 'Apple, "Inc"' })]);
    expect(csv.split('\n')[1]).toContain('"Apple, ""Inc"""');
  });
});

describe('activitiesToJSON', () => {
  it('emits valid JSON of the export records', () => {
    const json = activitiesToJSON([makeActivity()]);
    expect(JSON.parse(json)).toEqual(toExportRecords([makeActivity()]));
  });
});

describe('buildExportFilename', () => {
  it('embeds the format and window bounds', () => {
    const window = { from: '2026-03-01', to: '2026-05-30', clamped: false };
    expect(buildExportFilename('csv', window)).toBe('predinex-activity_2026-03-01_2026-05-30.csv');
    expect(buildExportFilename('json', window)).toBe('predinex-activity_2026-03-01_2026-05-30.json');
  });
});

describe('EXPORT_MAX_WINDOW_DAYS', () => {
  it('is 90 days', () => {
    expect(EXPORT_MAX_WINDOW_DAYS).toBe(90);
    expect(DAY).toBe(86_400);
  });
});
