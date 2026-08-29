/**
 * Resolves the absolute origin the current deployment is served from.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a preview deployment
 * built without its own `NEXT_PUBLIC_APP_URL` (or with the production value
 * inherited from project settings) would otherwise emit robots.txt and
 * sitemap.xml claiming to live at the production domain.
 *
 * Resolution order:
 *  1. `VERCEL_URL` on non-production deployments — the deployment's own host,
 *     so previews describe themselves rather than production.
 *  2. `NEXT_PUBLIC_APP_URL` — the explicitly configured canonical origin.
 *  3. `VERCEL_URL` — a Vercel deployment with nothing else configured.
 *  4. `https://predinex.io` — the production default.
 *
 * Server-side only: `VERCEL_URL` / `VERCEL_ENV` are not exposed to the browser.
 */
export const DEFAULT_SITE_URL = 'https://predinex.io';

function normalize(url: string): string {
  const withProtocol = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return withProtocol.replace(/\/+$/, '');
}

export function getSiteUrl(): string {
  const vercelUrl = process.env['VERCEL_URL'];
  const vercelEnv = process.env['VERCEL_ENV'];
  const configured = process.env['NEXT_PUBLIC_APP_URL'];

  // Preview / development deployments always describe their own host.
  if (vercelUrl && vercelEnv && vercelEnv !== 'production') {
    return normalize(vercelUrl);
  }

  if (configured) return normalize(configured);
  if (vercelUrl) return normalize(vercelUrl);

  return DEFAULT_SITE_URL;
}
