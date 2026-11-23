/**
 * Failed on-chain market creation monitoring (#1664).
 *
 * Every failed `create_market` submission from `POST /api/markets` is recorded
 * with non-sensitive metadata only, and an alert fires when failures repeat.
 *
 * What is recorded — and what is not:
 *   - when it happened, the request's correlation ID, the error class, the
 *     contract error code when the failure carries one (`Error(Contract, #N)`),
 *     and a coarse category (contract / timeout / network / rejected /
 *     unknown);
 *   - the shape of the request (outcome count, title length in bytes, seconds
 *     until close), never its text;
 *   - never the raw error message, stack, transaction XDR, signer, keys or the
 *     submitted payload, since those can carry secrets or user data.
 *
 * Alerting: when `threshold` failures happen within `windowMs`, one
 * `market_creation_failure_alert` line is logged at `error` level. It does not
 * fire again until the window has been clear of failures for a full window,
 * so a sustained outage pages once instead of on every request. The state is
 * per process (the API keeps no shared store); docs/MARKET_CREATION_MONITORING.md
 * describes how to alert across instances from the logs.
 */

import { logger } from '../lib/logger.js';
import { getCorrelationId } from '../lib/correlation.js';
import type { CreateMarketRequest } from './market-validation.js';

export type MarketCreationFailureCategory = 'contract' | 'timeout' | 'network' | 'rejected' | 'unknown';

export interface MarketCreationFailure {
  at: string;
  correlationId: string | null;
  category: MarketCreationFailureCategory;
  /** Constructor name of the thrown error, e.g. `Error`, `TimeoutError`. */
  errorName: string;
  /** Contract error discriminant, when the failure carries one. */
  contractErrorCode: number | null;
  outcomeCount: number;
  titleBytes: number;
  /** Seconds between the attempt and the requested close time. */
  secondsToClose: number;
}

export interface MarketCreationFailureStats {
  threshold: number;
  windowSeconds: number;
  /** Failures inside the current window. */
  recentFailures: number;
  /** Total failures since the process started. */
  totalFailures: number;
  /** True while an alert is active (until a failure-free window passes). */
  alerting: boolean;
  lastAlertAt: string | null;
  /** The most recent failures, newest first, capped at `maxRecent`. */
  recent: MarketCreationFailure[];
}

export interface MarketCreationMonitorOptions {
  threshold?: number;
  windowMs?: number;
  maxRecent?: number;
  now?: () => number;
}

const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_SECONDS = 900;
const DEFAULT_MAX_RECENT = 50;

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** `Error(Contract, #7)` as printed by Soroban host errors and the SDK. */
const CONTRACT_ERROR_RE = /Error\(Contract,\s*#(\d+)\)/;

function classify(err: unknown): { category: MarketCreationFailureCategory; contractErrorCode: number | null } {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const name = err instanceof Error ? err.name : '';
  const code = message.match(CONTRACT_ERROR_RE);
  if (code) return { category: 'contract', contractErrorCode: Number(code[1]) };
  if (/timeout|timed out/i.test(name) || /timeout|timed out/i.test(message)) {
    return { category: 'timeout', contractErrorCode: null };
  }
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|network|fetch failed/i.test(message)) {
    return { category: 'network', contractErrorCode: null };
  }
  if (/tx_failed|txFailed|tx_bad|rejected|insufficient/i.test(message)) {
    return { category: 'rejected', contractErrorCode: null };
  }
  return { category: 'unknown', contractErrorCode: null };
}

export class MarketCreationMonitor {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly maxRecent: number;
  private readonly now: () => number;
  private timestamps: number[] = [];
  private recent: MarketCreationFailure[] = [];
  private total = 0;
  private alertActive = false;
  private lastAlertAt: number | null = null;
  private lastFailureAt: number | null = null;

  constructor(options: MarketCreationMonitorOptions = {}) {
    this.threshold =
      options.threshold ?? positiveInt(process.env.MARKET_CREATION_FAILURE_ALERT_THRESHOLD, DEFAULT_THRESHOLD);
    this.windowMs =
      options.windowMs ??
      positiveInt(process.env.MARKET_CREATION_FAILURE_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS) * 1000;
    this.maxRecent = options.maxRecent ?? DEFAULT_MAX_RECENT;
    this.now = options.now ?? Date.now;
  }

  /** Record one failed creation attempt. Returns the stored (redacted) record. */
  recordFailure(request: CreateMarketRequest, err: unknown): MarketCreationFailure {
    const nowMs = this.now();
    this.refreshAlert(nowMs);

    const { category, contractErrorCode } = classify(err);
    const failure: MarketCreationFailure = {
      at: new Date(nowMs).toISOString(),
      correlationId: getCorrelationId() ?? null,
      category,
      errorName: err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name) ? err.name : 'Unknown',
      contractErrorCode,
      outcomeCount: Array.isArray(request.outcomes) ? request.outcomes.length : 0,
      titleBytes: Buffer.byteLength(String(request.title ?? ''), 'utf8'),
      secondsToClose: Math.round(request.closeTime - nowMs / 1000),
    };

    this.total += 1;
    this.lastFailureAt = nowMs;
    this.timestamps.push(nowMs);
    this.prune(nowMs);
    this.recent.unshift(failure);
    this.recent.length = Math.min(this.recent.length, this.maxRecent);

    logger.warn('market_creation_failed', { ...failure });

    if (!this.alertActive && this.timestamps.length >= this.threshold) {
      this.alertActive = true;
      this.lastAlertAt = nowMs;
      logger.error('market_creation_failure_alert', {
        alert: 'market_creation_failures',
        failuresInWindow: this.timestamps.length,
        threshold: this.threshold,
        windowSeconds: this.windowMs / 1000,
        categories: this.categoryCounts(),
        runbook: 'docs/MARKET_CREATION_MONITORING.md',
      });
    }
    return failure;
  }

  stats(): MarketCreationFailureStats {
    const nowMs = this.now();
    this.refreshAlert(nowMs);
    this.prune(nowMs);
    return {
      threshold: this.threshold,
      windowSeconds: this.windowMs / 1000,
      recentFailures: this.timestamps.length,
      totalFailures: this.total,
      alerting: this.alertActive,
      lastAlertAt: this.lastAlertAt === null ? null : new Date(this.lastAlertAt).toISOString(),
      recent: [...this.recent],
    };
  }

  /** Test helper: forget everything. */
  reset(): void {
    this.timestamps = [];
    this.recent = [];
    this.total = 0;
    this.alertActive = false;
    this.lastAlertAt = null;
    this.lastFailureAt = null;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }

  /** An active alert clears once a full window has passed with no failures. */
  private refreshAlert(nowMs: number): void {
    if (this.alertActive && this.lastFailureAt !== null && nowMs - this.lastFailureAt >= this.windowMs) {
      this.alertActive = false;
    }
  }

  private categoryCounts(): Partial<Record<MarketCreationFailureCategory, number>> {
    const cutoff = this.now() - this.windowMs;
    const counts: Partial<Record<MarketCreationFailureCategory, number>> = {};
    for (const failure of this.recent) {
      if (Date.parse(failure.at) <= cutoff) break;
      counts[failure.category] = (counts[failure.category] ?? 0) + 1;
    }
    return counts;
  }
}

export const defaultMarketCreationMonitor = new MarketCreationMonitor();
