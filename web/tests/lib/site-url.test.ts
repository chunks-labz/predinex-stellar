/**
 * robots.txt and sitemap.xml must describe the deployment they are served
 * from. These tests pin down that a preview deployment never advertises the
 * production domain, and that an explicitly configured origin still wins in
 * production.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadGetSiteUrl() {
  const mod = await import('@/lib/site-url');
  return mod.getSiteUrl;
}

describe('getSiteUrl', () => {
  it('falls back to the production domain when nothing is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('VERCEL_ENV', '');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://predinex.io');
  });

  it('uses the configured origin when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.predinex.io');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('VERCEL_ENV', '');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://app.predinex.io');
  });

  it('strips trailing slashes', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.predinex.io/');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://app.predinex.io');
  });

  it('uses the preview deployment host instead of the production domain', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    vi.stubEnv('VERCEL_URL', 'predinex-git-feature-team.vercel.app');
    vi.stubEnv('VERCEL_ENV', 'preview');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://predinex-git-feature-team.vercel.app');
  });

  it('keeps the configured origin on production deployments', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://predinex.io');
    vi.stubEnv('VERCEL_URL', 'predinex-abc123.vercel.app');
    vi.stubEnv('VERCEL_ENV', 'production');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://predinex.io');
  });

  it('falls back to VERCEL_URL when nothing else is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('VERCEL_URL', 'predinex-abc123.vercel.app');
    vi.stubEnv('VERCEL_ENV', 'production');
    const getSiteUrl = await loadGetSiteUrl();
    expect(getSiteUrl()).toBe('https://predinex-abc123.vercel.app');
  });
});
