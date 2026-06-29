import { describe, it, expect } from 'vitest';
import { classifyRequest, isDataRequest, isStaticAsset } from '../../app/lib/pwa';

describe('isStaticAsset', () => {
  it('treats build output and asset extensions as static', () => {
    expect(isStaticAsset('/_next/static/chunks/main.js')).toBe(true);
    expect(isStaticAsset('/icons/icon-192.png')).toBe(true);
    expect(isStaticAsset('/fonts/geist.woff2')).toBe(true);
    expect(isStaticAsset('/globe.svg')).toBe(true);
  });

  it('does not treat pages or data routes as static', () => {
    expect(isStaticAsset('/markets')).toBe(false);
    expect(isStaticAsset('/api/pools')).toBe(false);
  });
});

describe('isDataRequest', () => {
  it('matches API and Next data routes', () => {
    expect(isDataRequest('/api/pools')).toBe(true);
    expect(isDataRequest('/_next/data/build/markets.json')).toBe(true);
    expect(isDataRequest('/markets')).toBe(false);
  });
});

describe('classifyRequest', () => {
  it('routes navigations to the navigation strategy', () => {
    expect(classifyRequest({ pathname: '/markets', mode: 'navigate' })).toBe('navigation');
  });

  it('routes static assets to the static strategy', () => {
    expect(classifyRequest({ pathname: '/_next/static/x.css', mode: 'no-cors' })).toBe('static');
  });

  it('routes everything else to the data strategy', () => {
    expect(classifyRequest({ pathname: '/api/pools', mode: 'cors' })).toBe('data');
    expect(classifyRequest({ pathname: '/unknown' })).toBe('data');
  });
});
