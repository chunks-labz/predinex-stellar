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

const RETURN_POSITION_KEY = 'predinex_markets_return_position';

export function rememberMarketsPosition(href: string, page: number, scrollY: number) {
  try {
    window.sessionStorage.setItem(RETURN_POSITION_KEY, JSON.stringify({ href, page, scrollY }));
  } catch { /* Storage is optional. */ }
}

export function getMarketsPosition(href: string): { page: number; scrollY: number } | null {
  try {
    const position = JSON.parse(window.sessionStorage.getItem(RETURN_POSITION_KEY) ?? 'null');
    if (position?.href === href && Number.isSafeInteger(position.page) && position.page > 0 &&
        Number.isFinite(position.scrollY) && position.scrollY >= 0) return position;
  } catch { /* Ignore an unavailable or invalid snapshot. */ }
  return null;
}

export function clearMarketsPosition() {
  try {
    window.sessionStorage.removeItem(RETURN_POSITION_KEY);
  } catch { /* Storage is optional. */ }
}
