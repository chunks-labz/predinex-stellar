/**
 * Pure helpers for exporting wallet activity history as CSV or JSON.
 *
 * Exports are bounded to a maximum 90-day window (for tax/analytics use) and
 * expose a stable, documented field set: pool ID, type, amount, timestamp,
 * tx hash and pool title.
 */

import type { ActivityItem } from './stacks-api';

export type ExportFormat = 'csv' | 'json';

/** Maximum span, in days, that a single export may cover. */
export const EXPORT_MAX_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MICRO_STX_PER_STX = 1_000_000;

/** One exported activity row. `amount` is denominated in STX. */
export interface ActivityExportRecord {
  poolId: number | null;
  type: ActivityItem['type'];
  amount: number | null;
  timestamp: string;
  txHash: string;
  poolTitle: string;
}

/** A resolved, clamped export date window (inclusive `YYYY-MM-DD` bounds). */
export interface ExportWindow {
  from: string;
  to: string;
  /** True when the requested range exceeded 90 days and was clamped. */
  clamped: boolean;
}

/** Formats an epoch-ms value as a UTC `YYYY-MM-DD` date string. */
function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses a `YYYY-MM-DD` date string into epoch ms at UTC midnight. */
function parseDateString(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/**
 * Resolves the effective export window from optional user-supplied bounds,
 * enforcing the 90-day maximum.
 *
 * - Missing `to` defaults to today.
 * - Missing `from` defaults to 90 days before `to`.
 * - A span wider than 90 days is clamped by moving `from` forward, and the
 *   returned `clamped` flag is set so the UI can inform the user.
 */
export function resolveExportWindow(
  from: string,
  to: string,
  now: number = Date.now()
): ExportWindow {
  const toMs = to ? parseDateString(to) : parseDateString(toDateString(now));
  const requestedFromMs = from ? parseDateString(from) : toMs - EXPORT_MAX_WINDOW_DAYS * MS_PER_DAY;

  // Guard against an inverted range by collapsing it to an empty window.
  const fromMs = Math.min(requestedFromMs, toMs);

  const maxSpanMs = EXPORT_MAX_WINDOW_DAYS * MS_PER_DAY;
  const clamped = toMs - fromMs > maxSpanMs;
  const effectiveFromMs = clamped ? toMs - maxSpanMs : fromMs;

  return {
    from: toDateString(effectiveFromMs),
    to: toDateString(toMs),
    clamped,
  };
}

/**
 * Filters activities to those whose timestamp falls within the inclusive
 * `[from, to]` date window.
 */
export function filterActivitiesForExport(
  activities: ActivityItem[],
  window: ExportWindow
): ActivityItem[] {
  return activities.filter((item) => {
    const date = toDateString(item.timestamp * 1000);
    return date >= window.from && date <= window.to;
  });
}

/** Maps raw activity items to the documented export record shape. */
export function toExportRecords(activities: ActivityItem[]): ActivityExportRecord[] {
  return activities.map((item) => ({
    poolId: item.poolId ?? null,
    type: item.type,
    amount: item.amount === undefined ? null : item.amount / MICRO_STX_PER_STX,
    timestamp: new Date(item.timestamp * 1000).toISOString(),
    txHash: item.txId,
    poolTitle: item.poolTitle ?? '',
  }));
}

const CSV_COLUMNS: { key: keyof ActivityExportRecord; header: string }[] = [
  { key: 'poolId', header: 'pool_id' },
  { key: 'type', header: 'type' },
  { key: 'amount', header: 'amount' },
  { key: 'timestamp', header: 'timestamp' },
  { key: 'txHash', header: 'tx_hash' },
  { key: 'poolTitle', header: 'pool_title' },
];

/** Escapes a single CSV field per RFC 4180 (quote when needed, double quotes). */
function escapeCsvField(value: string | number | null): string {
  if (value === null) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Serializes activities to a CSV string with a header row. */
export function activitiesToCSV(activities: ActivityItem[]): string {
  const records = toExportRecords(activities);
  const header = CSV_COLUMNS.map((column) => column.header).join(',');
  const rows = records.map((record) =>
    CSV_COLUMNS.map((column) => escapeCsvField(record[column.key])).join(',')
  );
  return [header, ...rows].join('\n');
}

/** Serializes activities to a pretty-printed JSON string. */
export function activitiesToJSON(activities: ActivityItem[]): string {
  return JSON.stringify(toExportRecords(activities), null, 2);
}

/** Builds a download filename, e.g. `predinex-activity_2026-03-01_2026-05-30.csv`. */
export function buildExportFilename(format: ExportFormat, window: ExportWindow): string {
  return `predinex-activity_${window.from}_${window.to}.${format}`;
}
