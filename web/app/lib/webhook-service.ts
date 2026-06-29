/**
 * Webhook Notification Service
 *
 * Sends HTTP POST notifications to configured webhook URLs when
 * pool events occur on the Predinex platform.
 *
 * Events supported:
 *   - pool_created: When a new prediction market is created
 *   - bet_placed: When a user places a bet
 *   - pool_settled: When a pool is settled with a winning outcome
 *   - payout_claimed: When a user claims their winnings
 *
 * Security: All payloads are signed with HMAC-SHA256 using a shared secret.
 * The signature is included in the `X-Predinex-Signature` header for verification.
 */

import { getRuntimeConfig } from './runtime-config';

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

export interface WebhookConfig {
  /** Webhook destination URL */
  url: string;
  /** Shared secret for HMAC signature */
  secret: string;
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
// HMAC Signature
// ---------------------------------------------------------------------------

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 * Used in the `X-Predinex-Signature` header.
 */
function generateSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  
  // Use SubtleCrypto for HMAC-SHA256
  const cryptoKey = crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return cryptoKey.then(key => 
    crypto.subtle.sign('HMAC', key, messageData)
  ).then(signature => {
    // Convert to hex string
    const array = new Uint8Array(signature);
    return Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

// ---------------------------------------------------------------------------
// Event Builders
// ---------------------------------------------------------------------------

/**
 * Build webhook payload for pool creation event.
 */
function buildPoolCreatedPayload(
  poolId: number,
  creator: string,
  title: string,
  outcomeA: string,
  outcomeB: string,
  expiry: number
): WebhookPayload {
  return {
    event: 'pool_created',
    timestamp: new Date().toISOString(),
    eventId: `evt_${poolId}_${Date.now()}`,
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
  poolId: number,
  user: string,
  outcome: 'A' | 'B',
  amount: number,
  potentialWinnings: number
): WebhookPayload {
  return {
    event: 'bet_placed',
    timestamp: new Date().toISOString(),
    eventId: `evt_${poolId}_${Date.now()}`,
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
  poolId: number,
  winningOutcome: 0 | 1,
  totalPoolA: number,
  totalPoolB: number,
  totalWinners: number
): WebhookPayload {
  return {
    event: 'pool_settled',
    timestamp: new Date().toISOString(),
    eventId: `evt_${poolId}_${Date.now()}`,
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
  poolId: number,
  user: string,
  amount: number,
  outcome: 'A' | 'B'
): WebhookPayload {
  return {
    event: 'payout_claimed',
    timestamp: new Date().toISOString(),
    eventId: `evt_${poolId}_${Date.now()}`,
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
 * Send webhook notification to configured endpoint.
 */
async function sendWebhook(
  payload: WebhookPayload,
  config: WebhookConfig
): Promise<WebhookNotificationResult> {
  const payloadString = JSON.stringify(payload);
  
  try {
    const signature = await generateSignature(payloadString, config.secret);
    
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Predinex-Signature': `sha256=${signature}`,
        'X-Predinex-Event': payload.event,
      },
      body: payloadString,
    });
    
    if (response.ok) {
      return {
        success: true,
        statusCode: response.status,
      };
    } else {
      return {
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
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
  poolId: number,
  creator: string,
  title: string,
  outcomeA: string,
  outcomeB: string,
  expiry: number
): Promise<WebhookNotificationResult | null> {
  const config = getWebhookConfig(poolId);
  if (!config) return null;
  
  const payload = buildPoolCreatedPayload(poolId, creator, title, outcomeA, outcomeB, expiry);
  return sendWebhook(payload, config);
}

/**
 * Notify webhook of bet placement.
 */
export async function notifyBetPlaced(
  poolId: number,
  user: string,
  outcome: 'A' | 'B',
  amount: number,
  potentialWinnings: number
): Promise<WebhookNotificationResult | null> {
  const config = getWebhookConfig(poolId);
  if (!config) return null;
  
  const payload = buildBetPlacedPayload(poolId, user, outcome, amount, potentialWinnings);
  return sendWebhook(payload, config);
}

/**
 * Notify webhook of pool settlement.
 */
export async function notifyPoolSettled(
  poolId: number,
  winningOutcome: 0 | 1,
  totalPoolA: number,
  totalPoolB: number,
  totalWinners: number
): Promise<WebhookNotificationResult | null> {
  const config = getWebhookConfig(poolId);
  if (!config) return null;
  
  const payload = buildPoolSettledPayload(poolId, winningOutcome, totalPoolA, totalPoolB, totalWinners);
  return sendWebhook(payload, config);
}

/**
 * Notify webhook of payout claim.
 */
export async function notifyPayoutClaimed(
  poolId: number,
  user: string,
  amount: number,
  outcome: 'A' | 'B'
): Promise<WebhookNotificationResult | null> {
  const config = getWebhookConfig(poolId);
  if (!config) return null;
  
  const payload = buildPayoutClaimedPayload(poolId, user, amount, outcome);
  return sendWebhook(payload, config);
}
