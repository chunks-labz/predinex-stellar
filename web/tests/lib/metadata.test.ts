/**
 * Unit tests for the shared metadata helpers (issue #1060).
 *
 * All functions are pure (no I/O), so tests run entirely in-process with
 * environment stubs for getSiteUrl().
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function load() {
  return import('@/app/lib/metadata');
}

// ---------------------------------------------------------------------------
// buildPoolMetadata
// ---------------------------------------------------------------------------

describe('buildPoolMetadata', () => {
  it('sets the page title as "<pool title> | Predinex"', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({
      poolId: 42,
      title: 'Will BTC hit $200k?',
      description: 'A market about Bitcoin.',
      outcomeA: 'Yes',
      outcomeB: 'No',
    });

    expect(meta.title).toBe('Will BTC hit $200k? | Predinex');
  });

  it('uses the provided description verbatim', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({
      poolId: 1,
      title: 'Test pool',
      description: 'Custom description text.',
    });

    expect(meta.description).toBe('Custom description text.');
    expect((meta.openGraph as { description?: string })?.description).toBe('Custom description text.');
  });

  it('builds a fallback description from title and outcomes when no description given', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({
      poolId: 7,
      title: 'ETH vs BTC',
      outcomeA: 'ETH',
      outcomeB: 'BTC',
    });

    expect(meta.description).toContain('ETH vs BTC');
    expect(meta.description).toContain('ETH');
    expect(meta.description).toContain('BTC');
  });

  it('builds a fallback description with just the title when no outcomes given', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({ poolId: 3, title: 'Solo pool' });

    expect(meta.description).toContain('Solo pool');
  });

  it('sets the canonical OG URL to the /markets/:id path', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({ poolId: 5, title: 'My Pool' });

    expect((meta.openGraph as { url?: string })?.url).toBe('https://predinex.io/markets/5');
  });

  it('points the OG image to the /api/og/pool/:id route', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({ poolId: 99, title: 'Pool 99' });

    const ogImages = (meta.openGraph as { images?: unknown[] })?.images ?? [];
    expect(ogImages).toHaveLength(1);
    expect((ogImages[0] as { url: string }).url).toBe(
      'https://predinex.io/api/og/pool/99',
    );
  });

  it('sets twitter:card to summary_large_image', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({ poolId: 1, title: 'T' });

    expect((meta.twitter as { card?: string })?.card).toBe('summary_large_image');
  });

  it('respects a non-production site URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://staging.predinex.io');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_URL', 'staging.predinex.io');
    const { buildPoolMetadata } = await load();

    const meta = buildPoolMetadata({ poolId: 12, title: 'Staging Pool' });

    // Preview deployments use VERCEL_URL when env != production
    const ogImages = (meta.openGraph as { images?: unknown[] })?.images ?? [];
    const ogUrl = (ogImages[0] as { url: string }).url;
    expect(ogUrl).toContain('/api/og/pool/12');
    expect(ogUrl).not.toContain('staging.predinex.io/staging');
  });
});

// ---------------------------------------------------------------------------
// buildFallbackMetadata
// ---------------------------------------------------------------------------

describe('buildFallbackMetadata', () => {
  it('returns the generic site title when no pool ID supplied', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildFallbackMetadata, FALLBACK_TITLE } = await load();

    const meta = buildFallbackMetadata();

    expect(meta.title).toBe(FALLBACK_TITLE);
  });

  it('includes the pool ID in the title when supplied', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildFallbackMetadata } = await load();

    const meta = buildFallbackMetadata(404);

    expect(meta.title).toContain('404');
    expect(meta.title).toContain('Not Found');
  });

  it('uses the static /og-image.png fallback', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    const { buildFallbackMetadata } = await load();

    const meta = buildFallbackMetadata();
    const ogImages = (meta.openGraph as { images?: unknown[] })?.images ?? [];

    expect((ogImages[0] as { url: string }).url).toBe(
      'https://predinex.io/og-image.png',
    );
  });
});

// ---------------------------------------------------------------------------
// buildEmbedMetadata
// ---------------------------------------------------------------------------

describe('buildEmbedMetadata', () => {
  it('sets a title that includes the pool ID', async () => {
    const { buildEmbedMetadata } = await load();

    const meta = buildEmbedMetadata('7');

    expect(typeof meta.title).toBe('string');
    expect(meta.title as string).toContain('#7');
  });

  it('sets robots noindex and nofollow', async () => {
    const { buildEmbedMetadata } = await load();

    const meta = buildEmbedMetadata('5');

    const robots = meta.robots as { index?: boolean; follow?: boolean };
    expect(robots?.index).toBe(false);
    expect(robots?.follow).toBe(false);
  });

  it('handles a non-numeric pool ID gracefully', async () => {
    const { buildEmbedMetadata } = await load();

    const meta = buildEmbedMetadata('abc');

    expect(typeof meta.title).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// DASHBOARD_METADATA
// ---------------------------------------------------------------------------

describe('DASHBOARD_METADATA', () => {
  it('has a title referencing the dashboard', async () => {
    const { DASHBOARD_METADATA } = await load();

    expect(typeof DASHBOARD_METADATA.title).toBe('string');
    expect(DASHBOARD_METADATA.title as string).toMatch(/dashboard/i);
  });

  it('sets robots noindex and nofollow', async () => {
    const { DASHBOARD_METADATA } = await load();

    const robots = DASHBOARD_METADATA.robots as { index?: boolean; follow?: boolean };
    expect(robots?.index).toBe(false);
    expect(robots?.follow).toBe(false);
  });
});
