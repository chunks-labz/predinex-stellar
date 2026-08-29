import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type WebPushSubscriptionPayload,
} from '../../lib/push-notification-types';
import { checkRateLimit, rateLimitHeaders } from '@/app/lib/rate-limit';

export const runtime = 'nodejs';

const KV_PREFIX = 'push_sub:';

// ---------------------------------------------------------------------------
// Rate limit: max 30 requests per minute per wallet address.
// Abuse posture: prevents a single client from hammering subscription
// management endpoints (spam-subscribing or bulk-deleting).
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

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

function getAuthenticatedUserId(request: NextRequest, bodyUserId?: unknown): string | null {
  const headerUserId = request.headers.get('x-predinex-wallet-address')?.trim();
  if (!headerUserId || typeof bodyUserId !== 'string') return null;
  const normalizedBodyUserId = bodyUserId.trim();
  if (!normalizedBodyUserId || headerUserId !== normalizedBodyUserId) return null;
  return normalizedBodyUserId;
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-predinex-wallet-address')?.trim();
  if (!userId) return jsonError('Missing wallet identity.', 401);

  // Rate limit by wallet address.
  const rl = checkRateLimit(`push-sub:${userId}`, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

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

  const userId = getAuthenticatedUserId(request, body.userId);
  if (!userId) return jsonError('Missing or mismatched wallet identity.', 401);

  // Rate limit by wallet address.
  const rl = checkRateLimit(`push-sub:${userId}`, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

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

  await kv.set(key, entry);

  const endpoints = (await kv.get<string[]>(idxKey)) || [];
  if (!endpoints.includes(subscription.endpoint)) {
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

  const userId = getAuthenticatedUserId(request, body.userId);
  if (!userId) return jsonError('Missing or mismatched wallet identity.', 401);

  // Rate limit by wallet address.
  const rl = checkRateLimit(`push-sub:${userId}`, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429, headers: rateLimitHeaders(rl) },
    );
  }

  const idxKey = userIndexKey(userId);
  const endpoints = (await kv.get<string[]>(idxKey)) || [];

  for (const ep of endpoints) {
    await kv.del(kvKey(userId, ep));
  }
  await kv.del(idxKey);

  return NextResponse.json({ ok: true });
}
