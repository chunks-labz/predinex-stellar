import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MARKETS_HREF,
  LAST_MARKETS_HREF_KEY,
  getLastMarketsHref,
  rememberMarketsHref,
} from '../../app/lib/market-nav';

describe('market-nav', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('falls back to the unfiltered list when nothing is stored', () => {
    expect(getLastMarketsHref()).toBe(DEFAULT_MARKETS_HREF);
  });

  it('returns the remembered filtered markets URL', () => {
    rememberMarketsHref('/markets?status=active&sort=volume');
    expect(getLastMarketsHref()).toBe('/markets?status=active&sort=volume');
  });

  it('ignores stored values that are not a markets list path', () => {
    window.sessionStorage.setItem(LAST_MARKETS_HREF_KEY, 'https://evil.example/markets');
    expect(getLastMarketsHref()).toBe(DEFAULT_MARKETS_HREF);

    window.sessionStorage.setItem(LAST_MARKETS_HREF_KEY, '/markets/12');
    expect(getLastMarketsHref()).toBe(DEFAULT_MARKETS_HREF);
  });
});
