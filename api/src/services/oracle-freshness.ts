import { logger } from '../lib/logger.js';

export interface FeedFreshnessRecord {
  feed: string;
  lastSuccessfulUpdateAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
}

export interface OracleFreshnessMonitorOptions {
  thresholdSeconds?: number;
  now?: () => number;
}

const DEFAULT_THRESHOLD_SECONDS = 900;

function normalizeFeed(feed: string): string {
  const value = feed.trim();
  if (!value || value.length > 128) throw new TypeError('feed must be a non-empty string of at most 128 characters');
  return /^\d+$/.test(value) ? `pool:${value}` : value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class OracleFreshnessMonitor {
  private readonly thresholdSeconds: number;
  private readonly now: () => number;
  private readonly feeds = new Map<string, number | null>();
  private readonly alertActive = new Set<string>();

  constructor(options: OracleFreshnessMonitorOptions = {}) {
    this.thresholdSeconds =
      options.thresholdSeconds ??
      positiveInt(process.env.ORACLE_FEED_FRESHNESS_THRESHOLD_SECS, DEFAULT_THRESHOLD_SECONDS);
    this.now = options.now ?? Date.now;
  }

  registerFeed(feed: string): FeedFreshnessRecord {
    const normalized = normalizeFeed(feed);
    if (!this.feeds.has(normalized)) this.feeds.set(normalized, null);
    return this.toRecord(normalized, this.now());
  }

  recordUpdate(feed: string, updatedAt?: number): FeedFreshnessRecord {
    const normalized = normalizeFeed(feed);
    const at = updatedAt ?? this.now();
    if (!Number.isFinite(at) || at < 0) throw new TypeError('updatedAt must be a non-negative finite timestamp');

    this.feeds.set(normalized, at);
    this.alertActive.delete(normalized);
    const record = this.toRecord(normalized, this.now());
    logger.info('oracle_feed_updated', {
      feed: record.feed,
      lastSuccessfulUpdateAt: record.lastSuccessfulUpdateAt,
    });
    return record;
  }

  getFeed(feed: string): FeedFreshnessRecord | null {
    const normalized = normalizeFeed(feed);
    const updatedAt = this.feeds.get(normalized);
    return updatedAt === undefined ? null : this.toRecord(normalized, this.now());
  }

  records(): FeedFreshnessRecord[] {
    const nowMs = this.now();
    return [...this.feeds.keys()].map((feed) => this.toRecord(feed, nowMs));
  }

  check(): FeedFreshnessRecord[] {
    const records = this.records();
    for (const record of records) {
      if (record.stale && !this.alertActive.has(record.feed)) {
        this.alertActive.add(record.feed);
        logger.error('stale_oracle_feed_alert', {
          alert: 'stale_oracle_feed',
          feed: record.feed,
          lastSuccessfulUpdateAt: record.lastSuccessfulUpdateAt,
          ageSeconds: record.ageSeconds,
          freshnessThresholdSecs: this.thresholdSeconds,
          runbook: 'docs/ORACLE_FRESHNESS_MONITORING.md',
        });
      } else if (!record.stale) {
        this.alertActive.delete(record.feed);
      }
    }
    return records;
  }

  prometheus(): string {
    const lines = [
      '# HELP predinex_oracle_feed_last_update_timestamp_seconds Unix time of the last successful update for a feed.',
      '# TYPE predinex_oracle_feed_last_update_timestamp_seconds gauge',
      '# HELP predinex_oracle_feed_age_seconds Seconds since the last successful update for a feed.',
      '# TYPE predinex_oracle_feed_age_seconds gauge',
      '# HELP predinex_oracle_feed_stale 1 while a feed exceeds its freshness threshold.',
      '# TYPE predinex_oracle_feed_stale gauge',
      '# HELP predinex_oracle_feed_freshness_threshold_seconds Alert threshold applied to every feed.',
      '# TYPE predinex_oracle_feed_freshness_threshold_seconds gauge',
    ];

    for (const record of this.records()) {
      const label = `feed="${escapeLabel(record.feed)}"`;
      if (record.lastSuccessfulUpdateAt) {
        lines.push(
          `predinex_oracle_feed_last_update_timestamp_seconds{${label}} ${Date.parse(record.lastSuccessfulUpdateAt) / 1000}`
        );
      }
      if (record.ageSeconds !== null) {
        lines.push(`predinex_oracle_feed_age_seconds{${label}} ${record.ageSeconds}`);
      }
      lines.push(`predinex_oracle_feed_stale{${label}} ${record.stale ? 1 : 0}`);
    }
    lines.push(`predinex_oracle_feed_freshness_threshold_seconds ${this.thresholdSeconds}`);
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.feeds.clear();
    this.alertActive.clear();
  }

  private toRecord(feed: string, nowMs: number): FeedFreshnessRecord {
    const updatedAt = this.feeds.get(feed) ?? null;
    const ageSeconds = updatedAt === null ? null : Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
    return {
      feed,
      lastSuccessfulUpdateAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
      ageSeconds,
      stale: ageSeconds === null || ageSeconds >= this.thresholdSeconds,
    };
  }
}

export const defaultOracleFreshnessMonitor = new OracleFreshnessMonitor();
