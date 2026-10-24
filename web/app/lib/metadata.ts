/**
 * Shared metadata helpers for Predinex dynamic pages.
 *
 * Centralises OpenGraph / Twitter tag construction so pool detail pages
 * and market detail pages produce consistent, well-formed metadata without
 * duplicating logic.
 *
 * All functions are pure (no I/O) and safe to import in server components,
 * `generateMetadata`, and unit tests.
 */

import type { Metadata } from 'next';
import { getSiteUrl } from '@/lib/site-url';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const SITE_NAME = 'Predinex';
export const FALLBACK_TITLE = 'Predinex | Prediction Markets on Stellar';
export const FALLBACK_DESCRIPTION =
  'Discover and participate in decentralised prediction markets on Stellar. ' +
  'Predict, bet, and win with Soroban-powered smart contracts.';

// ---------------------------------------------------------------------------
// Pool-derived metadata
// ---------------------------------------------------------------------------

export interface PoolMetadataInput {
  /** Numeric pool / market ID. */
  poolId: number;
  title: string;
  description?: string | null;
  outcomeA?: string;
  outcomeB?: string;
}

/**
 * Build a Next.js `Metadata` object for a pool / market detail page.
 *
 * The OG image is generated dynamically via `/api/og/pool/[id]` and the
 * canonical URL points to the `/markets/[id]` route (the primary public URL).
 */
export function buildPoolMetadata(input: PoolMetadataInput): Metadata {
  const siteUrl = getSiteUrl();
  const { poolId, title, description, outcomeA, outcomeB } = input;

  const pageTitle = `${title} | ${SITE_NAME}`;

  // Build a rich description: prefer the pool's own text; fall back to a
  // template that includes the outcome labels so bots and link-unfurls give
  // users useful context even without the body copy.
  const outcomes =
    outcomeA && outcomeB ? ` — ${outcomeA} vs ${outcomeB}` : '';
  const pageDescription =
    (description && description.trim()) ||
    `Predict on "${title}"${outcomes}. Join the pool on ${SITE_NAME}.`;

  const ogImageUrl = `${siteUrl}/api/og/pool/${poolId}`;
  const canonicalUrl = `${siteUrl}/markets/${poolId}`;

  return {
    title: pageTitle,
    description: pageDescription,
    openGraph: {
      title: pageTitle,
      description: pageDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      locale: 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description: pageDescription,
      images: [ogImageUrl],
    },
  };
}

// ---------------------------------------------------------------------------
// Fallback metadata (pool not found / error)
// ---------------------------------------------------------------------------

/**
 * Build a graceful fallback `Metadata` object used when a pool cannot be
 * loaded — e.g. the pool ID does not exist or the RPC call failed.
 *
 * When `poolId` is supplied the title indicates which pool was not found;
 * omitting it returns the generic site-level fallback.
 */
export function buildFallbackMetadata(poolId?: number): Metadata {
  const siteUrl = getSiteUrl();
  const fallbackImage = `${siteUrl}/og-image.png`;

  const title =
    poolId != null
      ? `Pool #${poolId} Not Found | ${SITE_NAME}`
      : FALLBACK_TITLE;

  return {
    title,
    description: FALLBACK_DESCRIPTION,
    openGraph: {
      title,
      description: FALLBACK_DESCRIPTION,
      siteName: SITE_NAME,
      images: [{ url: fallbackImage, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: FALLBACK_DESCRIPTION,
      images: [fallbackImage],
    },
  };
}

// ---------------------------------------------------------------------------
// Embed page metadata
// ---------------------------------------------------------------------------

/**
 * Static metadata for an embeddable pool widget.
 *
 * The embed route is intentionally excluded from search-engine indexing
 * (it is meant to be loaded inside an `<iframe>`, not crawled directly).
 */
export function buildEmbedMetadata(poolId: string): Metadata {
  const numericId = parseInt(poolId, 10);
  const label = Number.isNaN(numericId) ? poolId : `#${numericId}`;

  return {
    title: `Pool ${label} | ${SITE_NAME} Embed`,
    description: `Embeddable prediction market widget for pool ${label} on ${SITE_NAME}.`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Dashboard / authenticated-page metadata
// ---------------------------------------------------------------------------

/**
 * Static metadata for the user dashboard.
 *
 * The dashboard is gated behind wallet authentication and contains personal
 * data — it must not be indexed by search engines.
 */
export const DASHBOARD_METADATA: Metadata = {
  title: `Dashboard | ${SITE_NAME}`,
  description:
    'Your personal prediction market dashboard. View active bets, portfolio overview, and recent activity on Predinex.',
  robots: {
    index: false,
    follow: false,
  },
};
