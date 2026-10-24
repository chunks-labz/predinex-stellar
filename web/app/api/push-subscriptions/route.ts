import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type WebPushSubscriptionPayload,
} from '../../lib/push-notification-types';
import { checkRateLimit, rateLimitHeaders, clientIpFromHeaders } from '@/app/lib/rate-limit';
import { verifyWalletProof } from '@/app/lib/wallet-auth';

export const runtime = 'nodejs';

const KV_PREFIX = 'push_sub:';

// ---------------------------------------------------------------------------
// Rate limit: max 30 requests per minute per verified wallet, plus a per-IP
// cap. Both keys come from values the caller cannot freely rotate (a wallet
// signature and the connecting IP), never from a payload field.
// Abuse posture: prevents a single client from hammering subscription
// management endpoints (spam-subscribing or bulk-deleting).
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 30;
const IP_RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/** Maximum number of push endpoints stored per wallet. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

const AUTH_SCOPE = 'push-subscriptions';

interface StoredPushSubscription {
  userId: string;
  subscription: WebPushSubscriptionPayload;
  preferences: NotificationPreferences;
  updatedAt: string;
}

function kvKey(userId: string, endpoint: string): string {
  return `${KV_PREFIX}${userId}:${endpoint}`;
}

function userIndexKey(userId: string): string {
  return `${KV_PREFIX}idx:${userId}`;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePreferences(value: unknown): NotificationPreferences | null {
  if (!isRecord(value)) return null;

  return {
    poolSettled:
      typeof value.poolSettled === 'boolean'
        ? value.poolSettled
        : DEFAULT_NOTIFICATION_PREFERENCES.poolSettled,
    poolExpiring24h:
      typeof value.poolExpiring24h === 'boolean'
        ? value.poolExpiring24h
        : DEFAULT_NOTIFICATION_PREFERENCES.poolExpiring24h,
    claimAvailable:
      typeof value.claimAvailable === 'boolean'
        ? value.claimAvailable
        : DEFAULT_NOTIFICATION_PREFERENCES.claimAvailable,
    disputeFiled:
      typeof value.disputeFiled === 'boolean'
        ? value.disputeFiled
        : DEFAULT_NOTIFICATION_PREFERENCES.disputeFiled,
  };
}

function validateSubscription(value: unknown): WebPushSubscriptionPayload | null {
  if (!isRecord(value) || !isRecord(value.keys)) return null;

  const endpoint = value.endpoint;
  const p256dh = value.keys.p256dh;
  const auth = value.keys.auth;
  const expirationTime = value.expirationTime;

  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null;
  if (typeof p256dh !== 'string' || p256dh.length < 16) return null;
  if (typeof auth !== 'string' || auth.length < 8) return null;
  if (expirationTime !== undefined && expirationTime !== null && typeof expirationTime !== 'number') {
    return null;
  }

  return {
    endpoint,
    expirationTime: expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

function ipRateLimited(request: NextRequest): NextResponse | null {
  const ipRl = checkRateLimit(`push-sub-ip:${clientIpFromHeaders(request.headers)}`, {
    max: IP_RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(ipRl) },
    );
  }
  return null;
}

function walletRateLimited(userId: string): NextResponse | null {
  const rl = checkRateLimit(`push-sub:${userId}`, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }
  return null;
}

/**
 * Resolve the caller's identity from a verified wallet signature. A body
 * `userId`, if present, must match the verified address.
 */
function getAuthenticatedUserId(request: NextRequest, bodyUserId?: unknown): string | null {
  const verified = verifyWalletProof(request.headers, AUTH_SCOPE);
  if (!verified) return null;
  if (bodyUserId !== undefined && (typeof bodyUserId !== 'string' || bodyUserId.trim() !== verified)) {
    return null;
  }
  return verified;
}

export async function GET(request: NextRequest) {
  const ipLimited = ipRateLimited(request);
  if (ipLimited) return ipLimited;

  const userId = getAuthenticatedUserId(request);
  if (!userId) return jsonError('Missing or invalid wallet signature.', 401);

  const limited = walletRateLimited(userId);
  if (limited) return limited;

  const endpoints = await kv.get<string[]>(userIndexKey(userId));
  if (!endpoints || endpoints.length === 0) {
    return NextResponse.json({ subscriptions: [] });
  }

  const subscriptions: StoredPushSubscription[] = [];
  for (const ep of endpoints) {
    const entry = await kv.get<StoredPushSubscription>(kvKey(userId, ep));
    if (entry) {
      subscriptions.push(entry);
    }
  }

  return NextResponse.json({ subscriptions });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!isRecord(body)) return jsonError('Invalid request body.', 400);

  const ipLimited = ipRateLimited(request);
  if (ipLimited) return ipLimited;

  const userId = getAuthenticatedUserId(request, body.userId);
  if (!userId) return jsonError('Missing or invalid wallet signature.', 401);

  const limited = walletRateLimited(userId);
  if (limited) return limited;

  const subscription = validateSubscription(body.subscription);
  if (!subscription) return jsonError('Invalid push subscription.', 400);

  const preferences = normalizePreferences(body.preferences);
  if (!preferences) return jsonError('Invalid notification preferences.', 400);

  const entry: StoredPushSubscription = {
    userId,
    subscription,
    preferences,
    updatedAt: new Date().toISOString(),
  };

  const key = kvKey(userId, subscription.endpoint);
  const idxKey = userIndexKey(userId);

  const endpoints = (await kv.get<string[]>(idxKey)) || [];
  const isNewEndpoint = !endpoints.includes(subscription.endpoint);
  if (isNewEndpoint && endpoints.length >= MAX_SUBSCRIPTIONS_PER_USER) {
    return jsonError('Subscription limit reached for this wallet.', 409);
  }

  await kv.set(key, entry);

  if (isNewEndpoint) {
    endpoints.push(subscription.endpoint);
    await kv.set(idxKey, endpoints);
  }

  return NextResponse.json({ subscription: entry }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (!isRecord(body)) return jsonError('Invalid request body.', 400);

  const ipLimited = ipRateLimited(request);
  if (ipLimited) return ipLimited;

  const userId = getAuthenticatedUserId(request, body.userId);
  if (!userId) return jsonError('Missing or invalid wallet signature.', 401);

  const limited = walletRateLimited(userId);
  if (limited) return limited;

  const idxKey = userIndexKey(userId);
  const endpoints = (await kv.get<string[]>(idxKey)) || [];

  for (const ep of endpoints) {
    await kv.del(kvKey(userId, ep));
  }
  await kv.del(idxKey);

  return NextResponse.json({ ok: true });
}
