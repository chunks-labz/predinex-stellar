/**
 * Webhook Notification Service (browser side).
 *
 * Posts pool events to the app's own `/api/webhooks/notify` route, which signs
 * and delivers them (issue #1286).
 *
 * Events supported:
 *   - pool_created: When a new prediction market is created
 *   - bet_placed: When a user places a bet
 *   - pool_settled: When a pool is settled with a winning outcome
 *   - payout_claimed: When a user claims their winnings
 *
 * Security: this module deliberately holds no secret and performs no signing.
 * It previously HMAC-signed payloads in the browser using
 * `NEXT_PUBLIC_WEBHOOK_SECRET`, which published the shared secret in the client
 * bundle and let anyone forge signed deliveries. Signing now happens only on
 * the server, where the secret is never exposed.
 */

import { getRuntimeConfig } from './runtime-config';

/** Internal route that signs and forwards events. */
const WEBHOOK_DISPATCH_ENDPOINT = '/api/webhooks/notify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookEventType =
  | 'pool_created'
  | 'bet_placed'
  | 'pool_settled'
  | 'payout_claimed';

export interface WebhookPayload {
  /** Event type */
  event: WebhookEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Unique event ID */
  eventId: string;
  /** Pool ID (if applicable) */
  poolId?: number;
  /** User address (if applicable) */
  user?: string;
  /** Event-specific data */
  data: Record<string, unknown>;
}

/**
 * Client-visible webhook configuration.
 *
 * The shared secret is intentionally absent: it is read from the server-only
 * `WEBHOOK_SECRET` inside the dispatch route, never from runtime config.
 */
export interface WebhookConfig {
  /** Webhook destination URL */
  url: string;
  /** Whether webhook is enabled */
  enabled: boolean;
}

export interface WebhookNotificationResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Get webhook configuration from runtime config.
 * Supports both global webhook and per-pool webhook.
 */
export function getWebhookConfig(poolId?: number): WebhookConfig | null {
  const config = getRuntimeConfig();
  
  // Per-pool webhook takes precedence
  if (poolId) {
    const poolWebhook = config.poolWebhooks?.[poolId];
    if (poolWebhook?.enabled && poolWebhook.url) {
      return poolWebhook;
    }
  }
  
  // Fall back to global webhook
  if (config.webhook?.enabled && config.webhook.url) {
    return config.webhook;
  }
  
  return null;
}

// ---------------------------------------------------------------------------
// Event Builders
// ---------------------------------------------------------------------------

/**
 * Build webhook payload for pool creation event.
 */
function buildPoolCreatedPayload(
  eventId: string,
  timestamp: string,
  poolId: number,
  creator: string,
  title: string,
  outcomeA: string,
  outcomeB: string,
  expiry: number
): WebhookPayload {
  return {
    event: 'pool_created',
    timestamp,
    eventId,
    poolId,
    user: creator,
    data: {
      title,
      outcomeA,
      outcomeB,
      expiry: expiry * 1000, // Convert to milliseconds
    },
  };
}

/**
 * Build webhook payload for bet placement event.
 */
function buildBetPlacedPayload(
  eventId: string,
  timestamp: string,
  poolId: number,
  user: string,
  outcome: 'A' | 'B',
  amount: number,
  potentialWinnings: number
): WebhookPayload {
  return {
    event: 'bet_placed',
    timestamp,
    eventId,
    poolId,
    user,
    data: {
      outcome,
      amount,
      potentialWinnings,
    },
  };
}

/**
 * Build webhook payload for pool settlement event.
 */
function buildPoolSettledPayload(
  eventId: string,
  timestamp: string,
  poolId: number,
  winningOutcome: 0 | 1,
  totalPoolA: number,
  totalPoolB: number,
  totalWinners: number
): WebhookPayload {
  return {
    event: 'pool_settled',
    timestamp,
    eventId,
    poolId,
    data: {
      winningOutcome,
      outcomeA: totalPoolA,
      outcomeB: totalPoolB,
      totalWinners,
    },
  };
}

/**
 * Build webhook payload for payout claim event.
 */
function buildPayoutClaimedPayload(
  eventId: string,
  timestamp: string,
  poolId: number,
  user: string,
  amount: number,
  outcome: 'A' | 'B'
): WebhookPayload {
  return {
    event: 'payout_claimed',
    timestamp,
    eventId,
    poolId,
    user,
    data: {
      amount,
      outcome,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Hand an event to the server for signing and delivery.
 *
 * The request body is untrusted input; the route validates and rebuilds it
 * before signing, so a tampered client payload cannot influence the signature
 * beyond the fields the route accepts.
 */
async function dispatchWebhook(
  payload: WebhookPayload
): Promise<WebhookNotificationResult> {
  try {
    const response = await fetch(WEBHOOK_DISPATCH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { success: true, statusCode: response.status };
    }

    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Notify webhook of pool creation.
 */
export async function notifyPoolCreated(
  eventId: string,
  timestamp: string,
  poolId: number,
  creator: string,
  title: string,
  outcomeA: string,
  outcomeB: string,
  expiry: number
): Promise<WebhookNotificationResult | null> {
  if (!getWebhookConfig(poolId)) return null;

  return dispatchWebhook(
    buildPoolCreatedPayload(eventId, timestamp, poolId, creator, title, outcomeA, outcomeB, expiry)
  );
}

/**
 * Notify webhook of bet placement.
 */
export async function notifyBetPlaced(
  eventId: string,
  timestamp: string,
  poolId: number,
  user: string,
  outcome: 'A' | 'B',
  amount: number,
  potentialWinnings: number
): Promise<WebhookNotificationResult | null> {
  if (!getWebhookConfig(poolId)) return null;

  return dispatchWebhook(
    buildBetPlacedPayload(eventId, timestamp, poolId, user, outcome, amount, potentialWinnings)
  );
}

/**
 * Notify webhook of pool settlement.
 */
export async function notifyPoolSettled(
  eventId: string,
  timestamp: string,
  poolId: number,
  winningOutcome: 0 | 1,
  totalPoolA: number,
  totalPoolB: number,
  totalWinners: number
): Promise<WebhookNotificationResult | null> {
  if (!getWebhookConfig(poolId)) return null;

  return dispatchWebhook(
    buildPoolSettledPayload(eventId, timestamp, poolId, winningOutcome, totalPoolA, totalPoolB, totalWinners)
  );
}

/**
 * Notify webhook of payout claim.
 */
export async function notifyPayoutClaimed(
  eventId: string,
  timestamp: string,
  poolId: number,
  user: string,
  amount: number,
  outcome: 'A' | 'B'
): Promise<WebhookNotificationResult | null> {
  if (!getWebhookConfig(poolId)) return null;

  return dispatchWebhook(
    buildPayoutClaimedPayload(eventId, timestamp, poolId, user, amount, outcome)
  );
}
