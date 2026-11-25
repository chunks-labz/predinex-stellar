import { logger } from '../lib/logger.js';

export interface IndexerLagSample {
  currentLedgerHeight: number | null;
  indexedLedgerHeight: number | null;
  lagLedgers: number | null;
  threshold: number;
  alerting: boolean;
  observedAt: string;
}

export interface IndexerLagMonitorOptions {
  currentLedgerHeight?: () => Promise<number | null>;
  indexedLedgerHeight?: () => Promise<number | null>;
  threshold?: number;
  now?: () => number;
}

const DEFAULT_THRESHOLD = 60;
const DEFAULT_TIMEOUT_MS = 2_000;
const LEDGER_HEIGHT_KEYS = [
  'latestLedger',
  'currentLedgerHeight',
  'current_ledger_height',
  'sequence',
  'ledger',
  'height',
] as const;
const INDEXED_HEIGHT_KEYS = [
  'indexedLedger',
  'indexed_ledger',
  'indexedLedgerHeight',
  'indexed_ledger_height',
  'lastProcessedLedger',
  'last_processed_ledger',
  'height',
] as const;

function nonNegativeInt(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function heightFrom(payload: unknown, keys: readonly string[]): number | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload !== 'object') return nonNegativeInt(payload);

  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const direct = nonNegativeInt(record[key]);
    if (direct !== null) return direct;
  }
  const result = nonNegativeInt(record.result);
  if (result !== null) return result;
  if (record.result && typeof record.result === 'object') {
    for (const key of keys) {
      const nested = nonNegativeInt((record.result as Record<string, unknown>)[key]);
      if (nested !== null) return nested;
    }
  }
  if (record.cursor && typeof record.cursor === 'object') {
    return nonNegativeInt((record.cursor as Record<string, unknown>).ledgerSeq);
  }
  return null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultCurrentLedgerHeight(): Promise<number | null> {
  const url = process.env.SOROBAN_RPC_URL || process.env.RPC_URL;
  if (!url) return null;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger', params: [] }),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  return heightFrom(await response.json(), LEDGER_HEIGHT_KEYS);
}

async function defaultIndexedLedgerHeight(): Promise<number | null> {
  const url = process.env.INDEXER_STATUS_URL;
  if (!url) return null;

  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`indexer status returned HTTP ${response.status}`);
  return heightFrom(await response.json(), INDEXED_HEIGHT_KEYS);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export class IndexerLagMonitor {
  private readonly currentLedgerHeight: () => Promise<number | null>;
  private readonly indexedLedgerHeight: () => Promise<number | null>;
  private readonly threshold: number;
  private readonly now: () => number;
  private lastSample: IndexerLagSample | null = null;
  private alertActive = false;

  constructor(options: IndexerLagMonitorOptions = {}) {
    this.currentLedgerHeight = options.currentLedgerHeight ?? defaultCurrentLedgerHeight;
    this.indexedLedgerHeight = options.indexedLedgerHeight ?? defaultIndexedLedgerHeight;
    this.threshold = options.threshold ?? positiveInt(process.env.INDEXER_LAG_THRESHOLD_LEDGERS, DEFAULT_THRESHOLD);
    this.now = options.now ?? Date.now;
  }

  async collect(): Promise<IndexerLagSample> {
    const [current, indexed] = await Promise.all([
      this.currentLedgerHeight(),
      this.indexedLedgerHeight(),
    ]);
    const lag = current !== null && indexed !== null ? Math.max(0, current - indexed) : null;
    const alerting = lag !== null && lag >= this.threshold;
    const sample: IndexerLagSample = {
      currentLedgerHeight: current,
      indexedLedgerHeight: indexed,
      lagLedgers: lag,
      threshold: this.threshold,
      alerting,
      observedAt: new Date(this.now()).toISOString(),
    };
    this.lastSample = sample;

    logger.info('indexer_lag_metric', { ...sample });

    if (alerting && !this.alertActive) {
      this.alertActive = true;
      logger.error('indexer_lag_alert', {
        alert: 'indexer_lag',
        currentLedgerHeight: current,
        indexedLedgerHeight: indexed,
        lagLedgers: lag,
        threshold: this.threshold,
        runbook: 'docs/INDEXER_LAG_MONITORING.md',
      });
    } else if (!alerting) {
      this.alertActive = false;
    }

    return sample;
  }

  stats(): IndexerLagSample | null {
    return this.lastSample;
  }

  prometheus(): string {
    const sample = this.lastSample;
    const lines = [
      '# HELP predinex_indexer_current_ledger_height Latest chain head observed by the API.',
      '# TYPE predinex_indexer_current_ledger_height gauge',
      '# HELP predinex_indexer_indexed_ledger_height Latest ledger committed by the indexer.',
      '# TYPE predinex_indexer_indexed_ledger_height gauge',
      '# HELP predinex_indexer_lag_ledgers Current ledger height minus indexed ledger height.',
      '# TYPE predinex_indexer_lag_ledgers gauge',
      '# HELP predinex_indexer_lag_threshold Alert threshold in ledgers.',
      '# TYPE predinex_indexer_lag_threshold gauge',
      '# HELP predinex_indexer_lag_alerting 1 while the lag alert is active.',
      '# TYPE predinex_indexer_lag_alerting gauge',
    ];
    if (sample?.currentLedgerHeight !== null && sample?.currentLedgerHeight !== undefined) {
      lines.push(`predinex_indexer_current_ledger_height ${sample.currentLedgerHeight}`);
    }
    if (sample?.indexedLedgerHeight !== null && sample?.indexedLedgerHeight !== undefined) {
      lines.push(`predinex_indexer_indexed_ledger_height ${sample.indexedLedgerHeight}`);
    }
    if (sample?.lagLedgers !== null && sample?.lagLedgers !== undefined) {
      lines.push(`predinex_indexer_lag_ledgers ${sample.lagLedgers}`);
    }
    lines.push(`predinex_indexer_lag_threshold ${this.threshold}`);
    lines.push(`predinex_indexer_lag_alerting ${this.alertActive ? 1 : 0}`);
    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.lastSample = null;
    this.alertActive = false;
  }
}

export const defaultIndexerLagMonitor = new IndexerLagMonitor();
