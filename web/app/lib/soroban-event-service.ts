/**
 * Soroban Event Service
 *
 * Fetches and maps Soroban contract events from the Stellar RPC / Horizon API
 * into typed ActivityItem objects consumed by the UI.
 *
 * Event schema reference: web/docs/CONTRACT_EVENTS.md
 *
 * Schema versioning (issue #175): every event emitted by the Predinex
 * contract carries a `Symbol` schema version at topic position 1 (currently
 * `"v1"`). This decoder pins to the version it was built against and skips
 * events with any other version rather than silently mis-decoding them.
 * See `SUPPORTED_EVENT_SCHEMA_VERSION` below.
 */

import type { ActivityItem } from './adapters/types';
import {
  notifyPoolCreated,
  notifyBetPlaced,
  notifyPoolSettled,
  notifyPayoutClaimed,
} from './webhook-service';
import { createScopedLogger } from './logger';

const log = createScopedLogger('soroban-event-service');

// ---------------------------------------------------------------------------
// Event schema version (issue #175)
// ---------------------------------------------------------------------------

/**
 * The contract event schema version this decoder understands. Must match the
 * `EVENT_SCHEMA_VERSION` constant in `contracts/predinex/src/lib.rs`. Update
 * both in lockstep when the contract bumps its version marker.
 */
export const SUPPORTED_EVENT_SCHEMA_VERSION = 'v1';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SorobanEventServiceConfig {
  /** Soroban RPC URL, e.g. https://soroban-testnet.stellar.org */
  rpcUrl: string;
  /** Stellar explorer base URL for building tx links */
  explorerUrl: string;
  /** Deployed contract ID (Stellar strkey C... format) */
  contractId: string;
}

// ---------------------------------------------------------------------------
// Raw Soroban event shapes (from RPC getEvents response)
// ---------------------------------------------------------------------------

export interface RawSorobanEvent {
  /** Hex-encoded ledger sequence + tx index, used as a stable ID */
  id: string;
  /** Ledger close time as Unix timestamp (seconds) */
  ledgerClosedAt?: string;
  /** Ledger sequence number */
  ledger?: number;
  /** Transaction hash */
  txHash?: string;
  /** Decoded topic values as XDR base64 strings or native JS values */
  topic: unknown[];
  /** Decoded data value */
  value: unknown;
  /** Contract ID that emitted the event */
  contractId?: string;
}

interface GetEventsResponse {
  result?: {
    events?: RawSorobanEvent[];
    latestLedger?: number;
  };
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// Typed event payloads (after decoding)
// ---------------------------------------------------------------------------

/**
 * Names of contract events the SDK can decode from Soroban event logs.
 */
export type SorobanEventName =
  | 'create_pool'
  | 'place_bet'
  | 'settle_pool'
  | 'claim_winnings'
  | 'fee_collected'
  | 'treasury_withdrawal';

/**
 * Normalized, typed shape of a decoded Soroban contract event.
 */
export interface DecodedSorobanEvent {
  name: SorobanEventName;
  /** Schema version of the event payload (issue #175). */
  schemaVersion?: string;
  poolId?: number;
  user?: string;
  /** Raw token units (i128 stored as number for JS compat) */
  amount?: number;
  outcome?: 0 | 1;
  winnings?: number;
  winningOutcome?: 0 | 1;
  txHash: string;
  timestamp: number;
  ledger?: number;
}

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

/**
 * Soroban RPC returns topic/value as either:
 *  - A plain JS primitive (when the SDK decodes it)
 *  - An object like { type: "symbol", value: "place_bet" }
 *  - An XDR base64 string (raw mode)
 *
 * This helper normalises all three into a plain JS value.
 */
function scValToNative(raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'bigint') return Number(raw);

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // { type: "symbol" | "u32" | "i128" | "address" | ..., value: ... }
    if ('value' in obj) return scValToNative(obj['value']);
    // { _type: ..., _value: ... } (some SDK versions)
    if ('_value' in obj) return scValToNative(obj['_value']);
  }

  return String(raw);
}

function toNumber(raw: unknown): number | undefined {
  const v = scValToNative(raw);
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toString(raw: unknown): string | undefined {
  const v = scValToNative(raw);
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

/**
 * Decode a raw Soroban event into a typed DecodedSorobanEvent.
 *
 * Only decodes events matching the contract's current
 * `SUPPORTED_EVENT_SCHEMA_VERSION`. Skipped events are logged so operators
 * can detect a contract upgrade that the frontend has not caught up with.
 *
 * @param raw - Raw event payload from the Soroban RPC `getEvents` response
 * @returns The decoded event, or null if unrecognized or schema-mismatched
 */
export function decodeSorobanEvent(raw: RawSorobanEvent): DecodedSorobanEvent | null {
  const topics = raw.topic ?? [];
  if (topics.length === 0) return null;

  const name = toString(topics[0]) as SorobanEventName | undefined;
  if (!name) return null;

  // Issue #175: pin to a known schema version. Contract emits the version
  // `Symbol` at topic position 1. An older or newer marker means the payload
  // shape may have changed — refuse to decode rather than mis-decode.
  const schemaVersion = toString(topics[1]);
  if (schemaVersion !== SUPPORTED_EVENT_SCHEMA_VERSION) {
    log.warn(
      `Skipping ${name} event with unsupported schema version "${schemaVersion ?? 'missing'}" (decoder pinned to "${SUPPORTED_EVENT_SCHEMA_VERSION}")`
    );
    return null;
  }

  const txHash = raw.txHash ?? raw.id ?? '';
  const timestamp = raw.ledgerClosedAt
    ? Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const base: DecodedSorobanEvent = {
    name,
    txHash,
    timestamp,
    ledger: raw.ledger,
    schemaVersion,
  };

  switch (name) {
    case 'create_pool': {
      // topics: [name, version, pool_id], data: (creator, status)
      base.poolId = toNumber(topics[2]);
      return base;
    }

    case 'place_bet': {
      // topics: [name, version, pool_id, user], data: BetEvent struct
      base.poolId = toNumber(topics[2]);
      base.user = toString(topics[3]);
      const data = raw.value;
      if (Array.isArray(data)) {
        const outcome = toNumber(data[0]);
        base.outcome = (outcome === 0 || outcome === 1) ? outcome : undefined;
        base.amount = toNumber(data[1]);
      } else if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        const outcome = toNumber(d['outcome'] ?? d[0]);
        base.outcome = (outcome === 0 || outcome === 1) ? outcome : undefined;
        base.amount = toNumber(d['amount'] ?? d[1]);
      }
      return base;
    }

    case 'settle_pool': {
      // topics: [name, version, pool_id], data: tuple including winning_outcome
      base.poolId = toNumber(topics[2]);
      const data = raw.value;
      let wo: number | undefined;
      if (Array.isArray(data)) {
        // (caller, winning_outcome, winning_side_total, total_pool_volume, fee_amount)
        wo = toNumber(data[1]);
      } else {
        wo = toNumber(data);
      }
      base.winningOutcome = (wo === 0 || wo === 1) ? wo : undefined;
      return base;
    }

    case 'claim_winnings': {
      // topics: [name, version, pool_id, user], data: winnings
      base.poolId = toNumber(topics[2]);
      base.user = toString(topics[3]);
      base.winnings = toNumber(raw.value);
      return base;
    }

    case 'fee_collected':
    case 'treasury_withdrawal':
      // Not surfaced in the activity feed
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Event → ActivityItem mapper
// ---------------------------------------------------------------------------

/**
 * Maps a decoded Soroban event to the ActivityItem UI model.
 * Returns null for event types that don't map to a user-visible activity.
 *
 * @param event - Decoded Soroban event to map
 * @param explorerUrl - Base URL used to build the transaction explorer link
 * @returns The corresponding ActivityItem, or null if not user-visible
 */
export function mapEventToActivityItem(
  event: DecodedSorobanEvent,
  explorerUrl: string
): ActivityItem | null {
  const txUrl = `${explorerUrl}/tx/${event.txHash}`;

  switch (event.name) {
    case 'place_bet':
      return {
        txId: event.txHash,
        type: 'bet-placed',
        functionName: 'place_bet',
        timestamp: event.timestamp,
        status: 'success',
        amount: event.amount,
        poolId: event.poolId,
        explorerUrl: txUrl,
        event: {
          type: 'bet',
          poolId: event.poolId,
          amount: event.amount,
          outcome: event.outcome,
        },
      };

    case 'claim_winnings':
      return {
        txId: event.txHash,
        type: 'winnings-claimed',
        functionName: 'claim_winnings',
        timestamp: event.timestamp,
        status: 'success',
        amount: event.winnings,
        poolId: event.poolId,
        explorerUrl: txUrl,
        event: {
          type: 'claim',
          poolId: event.poolId,
          winnerAmount: event.winnings,
        },
      };

    case 'create_pool':
      return {
        txId: event.txHash,
        type: 'pool-created',
        functionName: 'create_pool',
        timestamp: event.timestamp,
        status: 'success',
        poolId: event.poolId,
        explorerUrl: txUrl,
        event: {
          type: 'pool-creation',
          poolId: event.poolId,
        },
      };

    case 'settle_pool':
      return {
        txId: event.txHash,
        type: 'contract-call',
        functionName: 'settle_pool',
        timestamp: event.timestamp,
        status: 'success',
        poolId: event.poolId,
        explorerUrl: txUrl,
        event: {
          type: 'settlement',
          poolId: event.poolId,
          outcome: event.winningOutcome,
        },
      };

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main service function
// ---------------------------------------------------------------------------

/**
 * Trigger webhook notification for a decoded event.
 * This is fire-and-forget — failures are logged but don't block the activity feed.
 */
async function triggerWebhookNotification(event: DecodedSorobanEvent): Promise<void> {
  if (!event.poolId) return;

  switch (event.name) {
    case 'create_pool':
      // For pool creation, we need additional data not in the decoded event
      // This is a simplified version — in production you'd fetch pool details
      await notifyPoolCreated(
        event.poolId,
        event.user ?? '',
        '', // title - would need to fetch
        '', // outcomeA
        '', // outcomeB
        0   // expiry
      );
      break;

    case 'place_bet':
      if (event.user && event.outcome !== undefined && event.amount) {
        await notifyBetPlaced(
          event.poolId,
          event.user,
          event.outcome === 0 ? 'A' : 'B',
          event.amount,
          0 // potentialWinnings - would need to calculate
        );
      }
      break;

    case 'settle_pool':
      if (event.winningOutcome !== undefined) {
        await notifyPoolSettled(
          event.poolId,
          event.winningOutcome,
          0, // totalPoolA - would need to fetch
          0, // totalPoolB
          0  // totalWinners
        );
      }
      break;

    case 'claim_winnings':
      if (event.user && event.winnings) {
        await notifyPayoutClaimed(
          event.poolId,
          event.user,
          event.winnings,
          'A' // outcome - would need to fetch
        );
      }
      break;
  }
}

/**
 * Fetches Soroban contract events for a specific user address and maps them
 * into ActivityItem objects for the UI.
 *
 * Queries the Soroban RPC `getEvents` method, filtering by contract ID and
 * the user's address in the topic list (for place_bet and claim_winnings).
 *
 * @param userAddress - Stellar address (G... strkey) of the user
 * @param limit       - Maximum number of activity items to return
 * @param config      - Injectable service config (enables test isolation)
 * @returns Array of activity items, newest first; empty array on missing config or fetch failure
 */
export async function getUserActivityFromSoroban(
  userAddress: string,
  limit: number = 20,
  config: SorobanEventServiceConfig
): Promise<ActivityItem[]> {
  const { rpcUrl, explorerUrl, contractId } = config;

  if (!rpcUrl || !explorerUrl || !contractId) return [];

  try {
    // Use getEvents RPC method — filter by contract, user-relevant event names,
    // and the supported schema version so a future contract version cannot
    // silently feed mis-shaped events into this decoder (issue #175).
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params: {
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
            // topics[0] = event name, topics[1] = schema version. The third
            // and later positions (pool_id, user) are accepted on any value.
            topics: [
              ['place_bet', 'claim_winnings', 'create_pool', 'settle_pool'],
              [SUPPORTED_EVENT_SCHEMA_VERSION],
            ],
          },
        ],
        pagination: { limit },
      },
    };

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      log.error(`Soroban RPC error: ${response.status}`);
      return [];
    }

    const json: GetEventsResponse = await response.json();

    if (json.error) {
      log.error('Soroban RPC returned error', json.error.message);
      return [];
    }

    const rawEvents: RawSorobanEvent[] = json.result?.events ?? [];

    const items: ActivityItem[] = [];

    for (const raw of rawEvents) {
      const decoded = decodeSorobanEvent(raw);
      if (!decoded) continue;

      // Filter to events relevant to this user:
      // - place_bet / claim_winnings must have user in topics
      // - create_pool / settle_pool are included if the user is the creator
      //   (we can't filter server-side without an indexer, so we include all
      //    and let the UI decide; for user-specific feeds the hook can filter)
      const isUserEvent =
        decoded.user === userAddress ||
        decoded.name === 'create_pool' ||
        decoded.name === 'settle_pool';

      if (!isUserEvent) continue;

      const item = mapEventToActivityItem(decoded, explorerUrl);
      if (item) items.push(item);

      // Send webhook notifications (fire-and-forget, don't block activity feed)
      // Issue #314: webhook notifications for pool events
      triggerWebhookNotification(decoded).catch(err =>
        log.warn(`Webhook notification failed: ${err instanceof Error ? err.message : err}`)
      );
    }

    // Sort newest first
    items.sort((a, b) => b.timestamp - a.timestamp);

    return items.slice(0, limit);
  } catch (e) {
    log.error('Failed to fetch Soroban activity events', e);
    return [];
  }
}
