import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexerLagMonitor } from '../src/services/indexer-lag.js';

const NOW_MS = Date.UTC(2026, 10, 24, 12, 0, 0);

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const write = (chunk: unknown) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) lines.push(JSON.parse(line));
    }
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(write as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(write as never);
  return lines;
}

describe('IndexerLagMonitor', () => {
  let clock: number;
  let current: number | null;
  let indexed: number | null;
  let logs: Record<string, unknown>[];
  let monitor: IndexerLagMonitor;

  beforeEach(() => {
    clock = NOW_MS;
    current = 1_000;
    indexed = 990;
    logs = captureLogs();
    monitor = new IndexerLagMonitor({
      threshold: 20,
      now: () => clock,
      currentLedgerHeight: async () => current,
      indexedLedgerHeight: async () => indexed,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('exports current height, indexed height, and lag as metrics', async () => {
    const sample = await monitor.collect();

    expect(sample).toMatchObject({
      currentLedgerHeight: 1_000,
      indexedLedgerHeight: 990,
      lagLedgers: 10,
      threshold: 20,
      alerting: false,
      observedAt: new Date(NOW_MS).toISOString(),
    });
    expect(logs.find((line) => line.msg === 'indexer_lag_metric')).toMatchObject({
      level: 'info',
      currentLedgerHeight: 1_000,
      indexedLedgerHeight: 990,
      lagLedgers: 10,
    });

    const metrics = monitor.prometheus();
    expect(metrics).toContain('predinex_indexer_current_ledger_height 1000');
    expect(metrics).toContain('predinex_indexer_indexed_ledger_height 990');
    expect(metrics).toContain('predinex_indexer_lag_ledgers 10');
    expect(metrics).toContain('predinex_indexer_lag_threshold 20');
    expect(metrics).toContain('predinex_indexer_lag_alerting 0');
  });

  it('alerts once when lag reaches the threshold and re-arms after recovery', async () => {
    await monitor.collect();
    current = 1_030;
    clock += 5_000;
    await monitor.collect();
    current = 1_040;
    await monitor.collect();

    const alerts = logs.filter((line) => line.msg === 'indexer_lag_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'error',
      alert: 'indexer_lag',
      currentLedgerHeight: 1_030,
      indexedLedgerHeight: 990,
      lagLedgers: 40,
      threshold: 20,
      runbook: 'docs/INDEXER_LAG_MONITORING.md',
    });
    expect(monitor.prometheus()).toContain('predinex_indexer_lag_alerting 1');

    current = 1_000;
    await monitor.collect();
    current = 1_040;
    await monitor.collect();
    expect(logs.filter((line) => line.msg === 'indexer_lag_alert')).toHaveLength(2);
  });

  it('does not alert when a height source is unavailable', async () => {
    indexed = null;
    const sample = await monitor.collect();

    expect(sample).toMatchObject({ lagLedgers: null, alerting: false });
    expect(logs.some((line) => line.msg === 'indexer_lag_alert')).toBe(false);
    expect(monitor.prometheus()).not.toMatch(/^predinex_indexer_lag_ledgers \d+$/m);
  });
});
