/**
 * Server-side webhook dispatch (issue #1286).
 *
 * Webhook payloads are signed with an HMAC-SHA256 shared secret. That secret
 * must never reach the browser, so this route owns signing and delivery: the
 * client posts an unsigned event here, and this handler attaches the
 * `X-Predinex-Signature` header before forwarding it to the configured
 * destination.
 *
 * Previously `webhook-service.ts` did all of this in the browser with
 * `NEXT_PUBLIC_WEBHOOK_SECRET`, which shipped the shared secret to every
 * visitor and let anyone forge signed deliveries.
 *
 * Two further problems are fixed here:
 *   - Event IDs were `evt_${poolId}_${Date.now()}`, so the same on-chain event
 *     produced a different ID on every poll and was delivered repeatedly. IDs
 *     are now derived from on-chain identity, making retries idempotent.
 *   - Deduplication is enforced server-side, since many browser tabs poll the
 *     chain concurrently and each would otherwise fan out its own copy.
 */

import { NextResponse } from 'next/server';
import { getRuntimeConfig } from '@/app/lib/runtime-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const WEBHOOK_EVENT_TYPES = new Set([
  'pool_created',
  'bet_placed',
  'pool_settled',
  'payout_claimed',
]);

type WebhookEventType = 'pool_created' | 'bet_placed' | 'pool_settled' | 'payout_claimed';

interface WebhookEventRequest {
  event: WebhookEventType;
  eventId: string;
  timestamp: string;
  poolId?: number;
  user?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Recently-seen event IDs, keyed by eventId. Bounded and time-based so a
 * long-running server cannot grow it without limit.
 *
 * A TTL rather than a permanent set is deliberate: an event only needs to
 * collapse across the polling window in which a browser might re-send it, and
 * re-delivering a very old event is better than a permanent memory leak.
 */
const DEDUPE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEDUPE_MAX_ENTRIES = 5_000;

const recentlySeen = new Map<string, number>();

function pruneSeen(now: number): void {
  for (const [id, at] of recentlySeen) {
    if (now - at > DEDUPE_TTL_MS) recentlySeen.delete(id);
  }
  // Guard against unbounded growth if events arrive faster than they expire.
  while (recentlySeen.size > DEDUPE_MAX_ENTRIES) {
    const oldest = recentlySeen.keys().next();
    if (oldest.done) break;
    recentlySeen.delete(oldest.value);
  }
}

/**
 * Clear the dedupe window. Test-only: the dedupe set is module-level by design
 * so it is shared across requests within a server instance.
 */
export function __resetWebhookDedupeForTests(): void {
  recentlySeen.clear();
}

function claimEventId(eventId: string): boolean {
  const now = Date.now();
  pruneSeen(now);
  if (recentlySeen.has(eventId)) return false;
  recentlySeen.set(eventId, now);
  return true;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the client-supplied event. The payload is attacker-controlled — the
 * client can post anything — so it is treated as untrusted input and rebuilt
 * from a known field list rather than passed through to the HMAC verbatim.
 */
function parseEventRequest(body: unknown): WebhookEventRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;

  const event = raw.event;
  if (typeof event !== 'string' || !WEBHOOK_EVENT_TYPES.has(event)) return null;

  const eventId = raw.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 200) return null;

  const timestamp = raw.timestamp;
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return null;

  if (raw.poolId !== undefined && !Number.isInteger(raw.poolId)) return null;
  if (raw.user !== undefined && typeof raw.user !== 'string') return null;

  let data: Record<string, unknown> = {};
  if (raw.data !== undefined) {
    if (typeof raw.data !== 'object' || raw.data === null || Array.isArray(raw.data)) return null;
    data = raw.data as Record<string, unknown>;
  }

  return {
    event: event as WebhookEventType,
    eventId,
    timestamp,
    poolId: raw.poolId as number | undefined,
    user: raw.user as string | undefined,
    data,
  };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 the exact bytes that will be sent, so receivers can verify with
 * `X-Predinex-Signature` against the raw body.
 */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse> {
  const config = getRuntimeConfig();
  const webhook = config.webhook;

  if (!webhook?.enabled || !webhook.url) {
    return NextResponse.json({ delivered: false, reason: 'webhooks_disabled' }, { status: 202 });
  }

  // Server-only: this key is absent from the client env allowlist, so it is
  // never inlined into the browser bundle.
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] WEBHOOK_SECRET is not configured; refusing to deliver');
    return NextResponse.json({ delivered: false, reason: 'server_misconfigured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseEventRequest(body);
  if (!event) {
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
  }

  if (!claimEventId(event.eventId)) {
    return NextResponse.json({ delivered: false, deduplicated: true }, { status: 200 });
  }

  // Rebuild the payload in a fixed shape so field order is stable; the receiver
  // signs whatever bytes arrive, and stable ordering keeps retries consistent.
  const payload = JSON.stringify({
    event: event.event,
    timestamp: event.timestamp,
    eventId: event.eventId,
    ...(event.poolId !== undefined ? { poolId: event.poolId } : {}),
    ...(event.user !== undefined ? { user: event.user } : {}),
    data: event.data ?? {},
  });

  try {
    const signature = await signPayload(payload, secret);
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Predinex-Signature': `sha256=${signature}`,
        'X-Predinex-Event': event.event,
        'X-Predinex-Event-Id': event.eventId,
      },
      body: payload,
    });

    if (!response.ok) {
      console.error(`[webhook] destination responded ${response.status} for ${event.eventId}`);
      // Release the claim so a later retry is not permanently suppressed.
      recentlySeen.delete(event.eventId);
      return NextResponse.json(
        { delivered: false, statusCode: response.status },
        { status: 502 }
      );
    }

    return NextResponse.json({ delivered: true, statusCode: response.status });
  } catch (error) {
    recentlySeen.delete(event.eventId);
    console.error('[webhook] delivery failed:', error);
    return NextResponse.json({ delivered: false, error: 'delivery_failed' }, { status: 502 });
  }
}
