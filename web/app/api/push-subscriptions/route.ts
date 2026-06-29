import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type WebPushSubscriptionPayload,
} from '../../lib/push-notification-types';

export const runtime = 'nodejs';

interface StoredPushSubscription {
  userId: string;
  subscription: WebPushSubscriptionPayload;
  preferences: NotificationPreferences;
  updatedAt: string;
}

const STORE_KEY = '__predinexPushSubscriptions';

function getStore(): Map<string, StoredPushSubscription> {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: Map<string, StoredPushSubscription>;
  };

  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = new Map();
  }

  return globalStore[STORE_KEY];
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

function storeKey(userId: string, endpoint: string): string {
  return `${userId}:${endpoint}`;
}

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-predinex-wallet-address')?.trim();
  if (!userId) return jsonError('Missing wallet identity.', 401);

  const subscriptions = [...getStore().values()].filter((entry) => entry.userId === userId);
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
  getStore().set(storeKey(userId, subscription.endpoint), entry);

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

  for (const [key, entry] of getStore()) {
    if (entry.userId === userId) {
      getStore().delete(key);
    }
  }

  return NextResponse.json({ ok: true });
}
