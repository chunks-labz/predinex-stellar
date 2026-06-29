/*
 * Predinex service worker.
 *
 * Strategy (mirrors app/lib/pwa.ts — keep both in sync):
 *   - Navigations  → network-first, falling back to cache then the /offline page
 *   - Static assets → cache-first (build output, icons, fonts, images)
 *   - Same-origin data → network-first, falling back to the last cached response
 *   - Cross-origin requests (RPC, Stellar APIs) are left to the network
 */

const CACHE_VERSION = 'predinex-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const DATA_CACHE = `${CACHE_VERSION}-data`;
const OFFLINE_URL = '/offline';

// Precached so the shell and offline fallback work on a cold, offline start.
const PRECACHE_URLS = ['/', OFFLINE_URL, '/manifest.webmanifest'];

const STATIC_ASSET_EXTENSIONS =
  /\.(?:css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i;
const DEFAULT_NOTIFICATION_ICON = '/icons/icon-192.png';
const DEFAULT_NOTIFICATION_URL = '/dashboard';
const EVENT_FALLBACKS = {
  pool_settled: {
    title: 'Pool settled',
    body: 'A Predinex pool you follow has settled.',
  },
  pool_expiring_24h: {
    title: 'Pool expiring soon',
    body: 'A Predinex pool you follow expires in 24 hours.',
  },
  claim_available: {
    title: 'Claim available',
    body: 'You have Predinex winnings available to claim.',
  },
  dispute_filed: {
    title: 'Dispute filed',
    body: 'A dispute was filed on a Predinex pool you follow.',
  },
};

function isStaticAsset(pathname) {
  if (pathname.startsWith('/_next/static')) return true;
  if (pathname.startsWith('/icons/')) return true;
  return STATIC_ASSET_EXTENSIONS.test(pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Resilient precache: a single 404 must not abort the whole install.
      await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response('You are offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200 && fresh.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const fallback = await caches.match(request);
    if (fallback) return fallback;
    return Response.error();
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.status === 200) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only manage same-origin traffic; let RPC / Stellar API calls hit the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirstData(request));
});

function parsePushPayload(event) {
  if (!event.data) return {};

  try {
    return event.data.json();
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

function normalizeNotificationUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return DEFAULT_NOTIFICATION_URL;

  try {
    const target = new URL(url, self.location.origin);
    if (target.origin !== self.location.origin) return DEFAULT_NOTIFICATION_URL;
    return target.pathname + target.search + target.hash;
  } catch {
    return DEFAULT_NOTIFICATION_URL;
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = parsePushPayload(event);
      const fallback = EVENT_FALLBACKS[payload.eventType] || {
        title: 'Predinex update',
        body: 'There is a new update for your Predinex activity.',
      };
      const url = normalizeNotificationUrl(payload.url);

      await self.registration.showNotification(payload.title || fallback.title, {
        body: payload.body || fallback.body,
        icon: payload.icon || DEFAULT_NOTIFICATION_ICON,
        badge: DEFAULT_NOTIFICATION_ICON,
        tag: payload.eventType || 'predinex-update',
        data: {
          url,
          eventType: payload.eventType || 'predinex_update',
          poolId: payload.poolId,
          disputeId: payload.disputeId,
          claimId: payload.claimId,
        },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const targetPath = normalizeNotificationUrl(event.notification.data && event.notification.data.url);
      const targetUrl = new URL(targetPath, self.location.origin).href;
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client && clientUrl.href !== targetUrl) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })()
  );
});
