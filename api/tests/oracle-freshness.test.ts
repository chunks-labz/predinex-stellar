import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OracleFreshnessMonitor } from '../src/services/oracle-freshness.js';

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

describe('OracleFreshnessMonitor', () => {
  let clock: number;
  let logs: Record<string, unknown>[];
  let monitor: OracleFreshnessMonitor;

  beforeEach(() => {
    clock = NOW_MS;
    logs = captureLogs();
    monitor = new OracleFreshnessMonitor({ thresholdSeconds: 900, now: () => clock });
  });

  afterEach(() => vi.restoreAllMocks());

  it('tracks the last successful update for each feed', () => {
    monitor.recordUpdate('10', NOW_MS - 60_000);
    monitor.recordUpdate('pair:XLM/USDC', NOW_MS - 5_000);

    expect(monitor.getFeed('10')).toMatchObject({
      feed: 'pool:10',
      lastSuccessfulUpdateAt: new Date(NOW_MS - 60_000).toISOString(),
      ageSeconds: 60,
      stale: false,
    });
    expect(monitor.getFeed('pair:XLM/USDC')).toMatchObject({ ageSeconds: 5, stale: false });
    expect(logs.filter((line) => line.msg === 'oracle_feed_updated')).toHaveLength(2);
  });

  it('alerts with the affected feed in metadata and re-arms after recovery', () => {
    monitor.registerFeed('pool:10');
    monitor.check();
    monitor.check();

    let alerts = logs.filter((line) => line.msg === 'stale_oracle_feed_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      level: 'error',
      alert: 'stale_oracle_feed',
      feed: 'pool:10',
      lastSuccessfulUpdateAt: null,
      freshnessThresholdSecs: 900,
      runbook: 'docs/ORACLE_FRESHNESS_MONITORING.md',
    });

    monitor.recordUpdate('10', clock);
    monitor.check();
    expect(logs.filter((line) => line.msg === 'stale_oracle_feed_alert')).toHaveLength(1);

    clock += 900_000;
    monitor.check();
    alerts = logs.filter((line) => line.msg === 'stale_oracle_feed_alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]).toMatchObject({
      feed: 'pool:10',
      ageSeconds: 900,
      lastSuccessfulUpdateAt: new Date(NOW_MS).toISOString(),
    });
  });

  it('exports per-feed staleness metrics', () => {
    monitor.recordUpdate('pair:XLM/USDC', NOW_MS - 30_000);
    monitor.check();

    const metrics = monitor.prometheus();
    expect(metrics).toContain('predinex_oracle_feed_last_update_timestamp_seconds{feed="pair:XLM/USDC"}');
    expect(metrics).toContain('predinex_oracle_feed_age_seconds{feed="pair:XLM/USDC"} 30');
    expect(metrics).toContain('predinex_oracle_feed_stale{feed="pair:XLM/USDC"} 0');
    expect(metrics).toContain('predinex_oracle_feed_freshness_threshold_seconds 900');
  });
});
