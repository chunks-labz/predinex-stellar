/**
 * Pool dispute-history timeline.
 *
 * The Predinex Soroban contract exposes a freeze/dispute lifecycle for settled
 * pools. All three share the same topics `(name, "v1", pool_id)`:
 *   - `pool_frozen`   — pool temporarily frozen, blocking bets/claims
 *   - `pool_disputed` — settled pool marked disputed, blocking payouts
 *   - `pool_unfrozen` — frozen/disputed pool restored to Open (dispute resolved)
 *
 * `pool_frozen` and `pool_disputed` carry the calling address as their data.
 *
 * #1309 — `pool_unfrozen` widened its payload from a bare `Address` to
 * `{ actor, trigger, had_cooling_deadline }`. It is emitted both by a freeze
 * admin and by the first `place_bet` submitted after an automatic cooling
 * period elapses, so the address alone cannot say whether an administrator
 * acted. Historical events still carry the old bare-`Address` shape and cannot
 * be rewritten, so both shapes are accepted below.
 *
 * This module decodes those events into an ordered, display-ready timeline so
 * the pool detail page can show dispute transparency to users.
 */

import { SUPPORTED_EVENT_SCHEMA_VERSION, type SorobanEventServiceConfig } from './soroban-event-service';
import { createScopedLogger } from '@/app/lib/logger';

const log = createScopedLogger('dispute-history');

export type DisputeEventType = 'frozen' | 'disputed' | 'unfrozen' | 'resolved';

/**
 * #1309 — What caused a pool to thaw.
 *
 * `admin` means a freeze admin called `unfreeze_pool`. `autoThaw` means the
 * pool's cooling period had elapsed and the first bettor's `place_bet` reopened
 * it — the actor is that bettor, and no administrative action occurred.
 */
export type UnfreezeTrigger = 'admin' | 'autoThaw';

export interface DisputeTimelineEvent {
  type: DisputeEventType;
  /**
   * Address that triggered the transition. For an `unfrozen` event this is the
   * freeze admin only when `trigger` is `admin`; for `autoThaw` it is the
   * bettor whose bet ended the cooling period.
   */
  actor: string;
  /**
   * #1309 — Present on `unfrozen` events emitted after the fix. Absent for
   * `frozen`/`disputed` (always admin-initiated) and for historical
   * `unfrozen` events that predate the discriminator.
   */
  trigger?: UnfreezeTrigger;
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
 * Peels the scVal wrapper layers (`{ value }`, `{ _value }`, `{ symbol }`)
 * without collapsing anything else.
 *
 * `scValToNative` stringifies anything it does not recognise, which turns a
 * struct/map payload into `"[object Object]"`. This helper instead leaves maps
 * and structs as objects so their fields stay reachable.
 */
function peelScVal(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'object') return raw;

  const obj = raw as Record<string, unknown>;
  if ('value' in obj) return peelScVal(obj['value']);
  if ('_value' in obj) return peelScVal(obj['_value']);
  if ('symbol' in obj) return peelScVal(obj['symbol']);
  return obj;
}

/**
 * Normalises the `UnfreezeTrigger` contract enum to its wire name.
 *
 * The Rust enum's unit variants serialise as a symbol in several shapes
 * depending on the RPC transport: `Admin`, `{ symbol: "Admin" }`,
 * `{ value: "Admin" }`, or `{ vec: [{ symbol: "Admin" }] }`.
 *
 * Returns `undefined` for anything unrecognised so an unknown future variant
 * degrades to "unknown" rather than being guessed as an admin action.
 */
function asUnfreezeTrigger(raw: unknown): UnfreezeTrigger | undefined {
  let v = peelScVal(raw);

  // Unit enum variants arrive as a single-element vec.
  if (v && typeof v === 'object' && !Array.isArray(v) && 'vec' in (v as Record<string, unknown>)) {
    v = peelScVal((v as Record<string, unknown>)['vec']);
  }
  if (Array.isArray(v)) v = peelScVal(v[0]);

  if (typeof v !== 'string') return undefined;
  switch (v.toLowerCase()) {
    case 'admin':
      return 'admin';
    case 'autothaw':
      return 'autoThaw';
    default:
      return undefined;
  }
}

/**
 * Extracts a field from a contract-event struct payload.
 *
 * Handles both the plain-object form and the RPC map form
 * (`{ map: [{ key: ..., val: ... }] }`). Returns `undefined` when the payload is
 * not a struct or the field is absent — which is exactly the legacy
 * bare-`Address` case from #1309.
 */
function structField(raw: unknown, field: string): unknown {
  const v = peelScVal(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;

  const obj = v as Record<string, unknown>;
  if (field in obj) return obj[field];

  const entries = obj['map'];
  if (!Array.isArray(entries)) return undefined;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const key = peelScVal((entry as Record<string, unknown>)['key']);
    if (key === field) return (entry as Record<string, unknown>)['val'];
  }

  return undefined;
}

/**
 * Reads a string-bearing scVal, handling the XDR tagged forms the Soroban RPC
 * actually returns (`{ address: "G..." }`, `{ symbol: "Admin" }`, `{ scv: ... }`)
 * in addition to the `{ type, value }` form used by fixtures.
 *
 * Needed because `asString`/`scValToNative` would otherwise stringify these
 * objects into `"[object Object]"`.
 */
function asScValString(raw: unknown): string | undefined {
  const v = peelScVal(raw);

  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    for (const tag of ['address', 'symbol', 'scv', 'strString']) {
      if (tag in obj) return asScValString(obj[tag]);
    }
    return undefined;
  }

  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * #1309 — Decodes the `pool_unfrozen` payload.
 *
 * Returns the actor and, when the event carries the discriminator, the trigger.
 * Falls back to treating the payload as a bare `Address` for events emitted
 * before the fix, which is required because on-chain history is immutable.
 */
function decodeUnfrozenPayload(raw: unknown): { actor: string; trigger?: UnfreezeTrigger } {
  const actor = asScValString(structField(raw, 'actor'));
  if (actor !== undefined) {
    return { actor, trigger: asUnfreezeTrigger(structField(raw, 'trigger')) };
  }
  // Legacy shape: the data payload is the caller address itself.
  return { actor: asString(raw) ?? '' };
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

  // #1309 — only `pool_unfrozen` is ambiguous, so only it needs the trigger.
  // `frozen`/`disputed` are always admin-initiated.
  if (type === 'unfrozen') {
    const { actor, trigger } = decodeUnfrozenPayload(raw.value);
    return {
      type,
      actor,
      ...(trigger ? { trigger } : {}),
      timestamp,
      txHash,
      explorerUrl: txHash ? `${explorerUrl}/tx/${txHash}` : '',
      poolId: asNumber(topics[2]),
    };
  }

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
