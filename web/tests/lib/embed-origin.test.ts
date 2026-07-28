/**
 * The embed widget posts pool and bet data to its host page. These tests pin
 * down that a concrete origin is always resolved — never a '*' wildcard — and
 * that the resolver reports failure rather than guessing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadResolver() {
  const mod = await import('@/lib/embed-origin');
  return mod.resolveEmbedTargetOrigin;
}

describe('resolveEmbedTargetOrigin', () => {
  it('derives the origin from the referrer', async () => {
    const resolve = await loadResolver();
    expect(resolve('https://partner.example/blog/post-1?utm=x')).toBe('https://partner.example');
  });

  it('keeps a non-default port in the origin', async () => {
    const resolve = await loadResolver();
    expect(resolve('http://localhost:4000/embed-host')).toBe('http://localhost:4000');
  });

  it('returns null when the referrer is empty', async () => {
    const resolve = await loadResolver();
    expect(resolve('')).toBeNull();
  });

  it('returns null when the referrer is not a valid URL', async () => {
    const resolve = await loadResolver();
    expect(resolve('not a url')).toBeNull();
  });

  it('returns null for an opaque origin', async () => {
    const resolve = await loadResolver();
    expect(resolve('data:text/html,<p>hi</p>')).toBeNull();
  });

  it('never returns the wildcard target origin', async () => {
    const resolve = await loadResolver();
    for (const referrer of ['', '*', 'not a url', 'https://partner.example/x']) {
      expect(resolve(referrer)).not.toBe('*');
    }
  });

  it('prefers the configured allowed origin over the referrer', async () => {
    vi.stubEnv('NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN', 'https://allowed.example');
    vi.resetModules();
    const resolve = await loadResolver();
    expect(resolve('https://partner.example/blog')).toBe('https://allowed.example');
  });

  it('normalises a configured value that includes a path', async () => {
    vi.stubEnv('NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN', 'https://allowed.example/host/page');
    vi.resetModules();
    const resolve = await loadResolver();
    expect(resolve()).toBe('https://allowed.example');
  });

  it('falls back to the referrer when the configured value is unusable', async () => {
    vi.stubEnv('NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN', 'nonsense');
    vi.resetModules();
    const resolve = await loadResolver();
    expect(resolve('https://partner.example/blog')).toBe('https://partner.example');
  });

  it('reads document.referrer when no referrer argument is supplied', async () => {
    const resolve = await loadResolver();
    const spy = vi
      .spyOn(document, 'referrer', 'get')
      .mockReturnValue('https://host.example/page');
    expect(resolve()).toBe('https://host.example');
    spy.mockRestore();
  });
});
