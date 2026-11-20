/**
 * Remembers the last markets list URL (including search/filter/sort query) so
 * the market detail page can link back to the same view instead of resetting
 * the user's filters. Stored per tab in sessionStorage; every access is
 * guarded because storage can be unavailable (private mode, SSR).
 */
export const LAST_MARKETS_HREF_KEY = 'predinex_last_markets_href';
export const DEFAULT_MARKETS_HREF = '/markets';

export function rememberMarketsHref(href: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(LAST_MARKETS_HREF_KEY, href);
  } catch {
    // Storage unavailable — the back link falls back to the unfiltered list.
  }
}

export function getLastMarketsHref(): string {
  if (typeof window === 'undefined') return DEFAULT_MARKETS_HREF;
  try {
    const href = window.sessionStorage.getItem(LAST_MARKETS_HREF_KEY);
    // Only accept in-app markets list paths.
    if (href && (href === DEFAULT_MARKETS_HREF || href.startsWith(`${DEFAULT_MARKETS_HREF}?`))) {
      return href;
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_MARKETS_HREF;
}
