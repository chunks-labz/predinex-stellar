/**
 * Pool dispute-history timeline.
 *
 * The Predinex Soroban contract exposes a freeze/dispute lifecycle for settled
 * pools, emitting these events (topics: `(name, "v1", pool_id)`, data: caller):
 *   - `pool_frozen`   — pool temporarily frozen, blocking bets/claims
 *   - `pool_disputed` — settled pool marked disputed, blocking payouts
 *   - `pool_unfrozen` — frozen/disputed pool restored to Open (dispute resolved)
 *
 * This module decodes those events into an ordered, display-ready timeline so
 * the pool detail page can show dispute transparency to users.
 */

import { SUPPORTED_EVENT_SCHEMA_VERSION, type SorobanEventServiceConfig } from './soroban-event-service';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('dispute-history');

export type DisputeEventType = 'frozen' | 'disputed' | 'unfrozen' | 'resolved';

export interface DisputeTimelineEvent {
  type: DisputeEventType;
  /** Address (freeze admin) that triggered the transition. */
  actor: string;
  /** Ledger close time, Unix seconds. */
  timestamp: number;
  /** Transaction hash of the emitting transaction. */
  txHash: string;
  /** Block-explorer URL for the transaction (empty when no tx hash). */
  explorerUrl: string;
  /** Pool the event belongs to (used for filtering). */
  poolId?: number;
}

/** Maps an on-chain event name to its timeline event type. */
const EVENT_NAME_TO_TYPE: Record<string, DisputeEventType> = {
  pool_frozen: 'frozen',
  pool_disputed: 'disputed',
  pool_unfrozen: 'unfrozen',
};

/** On-chain event names that make up the dispute lifecycle. */
export const DISPUTE_EVENT_NAMES = Object.keys(EVENT_NAME_TO_TYPE);

/** Human-readable label and description per timeline event type. */
export const DISPUTE_EVENT_META: Record<DisputeEventType, { label: string; description: string }> = {
  disputed: {
    label: 'Dispute initiated',
    description: 'Pool settlement was challenged and payouts were paused for review.',
  },
  frozen: {
    label: 'Pool frozen',
    description: 'Betting and claims were temporarily halted.',
  },
  unfrozen: {
    label: 'Pool unfrozen',
    description: 'The pool was restored to its open state and the dispute lifted.',
  },
  resolved: {
    label: 'Dispute resolved',
    description: 'The dispute was concluded.',
  },
};

interface RawSorobanEvent {
  id?: string;
  ledgerClosedAt?: string;
  txHash?: string;
  topic?: unknown[];
  value?: unknown;
}

/** Normalises a Soroban scVal (primitive, `{value}` wrapper, or string) to JS. */
function scValToNative(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('value' in obj) return scValToNative(obj['value']);
    if ('_value' in obj) return scValToNative(obj['_value']);
  }
  return String(raw);
}

function asString(raw: unknown): string | undefined {
  const v = scValToNative(raw);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asNumber(raw: unknown): number | undefined {
  const v = scValToNative(raw);
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Decodes a raw Soroban event into a dispute timeline event, or `null` when the
 * event is not a recognised dispute event or uses an unsupported schema version.
 */
export function decodeDisputeEvent(
  raw: RawSorobanEvent,
  explorerUrl: string
): DisputeTimelineEvent | null {
  const topics = raw.topic ?? [];
  if (topics.length === 0) return null;

  const name = asString(topics[0]);
  const type = name ? EVENT_NAME_TO_TYPE[name] : undefined;
  if (!type) return null;

  // Pin to the supported schema version so a future contract revision cannot
  // feed mis-shaped payloads into this decoder.
  if (asString(topics[1]) !== SUPPORTED_EVENT_SCHEMA_VERSION) return null;

  const txHash = raw.txHash ?? raw.id ?? '';
  const timestamp = raw.ledgerClosedAt
    ? Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000)
    : 0;

  return {
    type,
    actor: asString(raw.value) ?? '',
    timestamp,
    txHash,
    explorerUrl: txHash ? `${explorerUrl}/tx/${txHash}` : '',
    poolId: asNumber(topics[2]),
  };
}

/** Orders dispute events chronologically (oldest first) for timeline display. */
export function buildDisputeTimeline(events: DisputeTimelineEvent[]): DisputeTimelineEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}

/** True when a pool has any recorded dispute-lifecycle activity. */
export function hasDisputeHistory(events: DisputeTimelineEvent[]): boolean {
  return events.length > 0;
}

/**
 * Fetches and decodes the dispute-lifecycle timeline for a single pool from the
 * Soroban RPC `getEvents` endpoint. Returns an empty array when the Soroban
 * config is incomplete or the request fails (non-blocking for the UI).
 */
export async function getDisputeHistoryFromSoroban(
  poolId: number,
  config: SorobanEventServiceConfig
): Promise<DisputeTimelineEvent[]> {
  const { rpcUrl, explorerUrl, contractId } = config;
  if (!rpcUrl || !explorerUrl || !contractId) return [];

  try {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
            // topics[0] = event name, topics[1] = schema version. pool_id at
            // position 2 is filtered client-side after decoding.
            topics: [DISPUTE_EVENT_NAMES, [SUPPORTED_EVENT_SCHEMA_VERSION]],
          },
        ],
        pagination: { limit: 100 },
      },
    };

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      log.error(`[dispute-history] Soroban RPC error: ${response.status}`);
      return [];
    }

    const json = (await response.json()) as {
      result?: { events?: RawSorobanEvent[] };
      error?: { message: string };
    };

    if (json.error) {
      log.error('[dispute-history] Soroban RPC returned error:', json.error.message);
      return [];
    }

    const decoded: DisputeTimelineEvent[] = [];
    for (const raw of json.result?.events ?? []) {
      const event = decodeDisputeEvent(raw, explorerUrl);
      if (!event) continue;
      if (event.poolId !== undefined && event.poolId !== poolId) continue;
      decoded.push(event);
    }

    return buildDisputeTimeline(decoded);
  } catch (e) {
    log.error('[dispute-history] Failed to fetch dispute events:', e);
    return [];
  }
}
