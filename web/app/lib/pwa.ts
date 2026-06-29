/**
 * Pure helpers describing the service worker's caching strategy.
 *
 * The runtime logic lives in `public/sw.js` (a plain static file the browser
 * loads directly and therefore cannot import these TS modules). These helpers
 * mirror that file's request classification so the strategy can be unit-tested
 * and kept in sync — keep both in step when editing either.
 */

export type CacheStrategy = 'navigation' | 'static' | 'data';

const STATIC_ASSET_EXTENSIONS =
  /\.(?:css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i;

/** True for build output and static asset file requests (cache-first). */
export function isStaticAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next/static')) return true;
  if (pathname.startsWith('/icons/')) return true;
  return STATIC_ASSET_EXTENSIONS.test(pathname);
}

/** True for app data requests served from this origin (network-first). */
export function isDataRequest(pathname: string): boolean {
  return pathname.startsWith('/api') || pathname.startsWith('/_next/data');
}

/**
 * Classifies a same-origin GET request into a caching strategy:
 *   - `navigation` → page loads (network-first with an offline fallback)
 *   - `static`     → assets (cache-first)
 *   - `data`       → everything else (network-first)
 */
export function classifyRequest(input: { pathname: string; mode?: string }): CacheStrategy {
  if (input.mode === 'navigate') return 'navigation';
  if (isStaticAsset(input.pathname)) return 'static';
  return 'data';
}
