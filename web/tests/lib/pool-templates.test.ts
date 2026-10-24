import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultDepositDeadline,
  loadSavedTemplates,
  saveTemplateToLocalStorage,
} from '../../app/create/_wizard/pool-templates';
import { EMPTY_DRAFT } from '../../app/create/_wizard/useCreateWizard';
import { validateDepositDeadline, MIN_POOL_DURATION_SECS } from '../../lib/validators';

describe('defaultDepositDeadline', () => {
  it('uses 80% of the pool duration', () => {
    expect(defaultDepositDeadline(86_400)).toBe(69_120);
  });

  it('passes deadline validation for any duration above the minimum', () => {
    // A 300s template used to seed 300, which equals the expiry and fails.
    for (const duration of [MIN_POOL_DURATION_SECS + 1, 301, 360, 375, 1_001, 3_600, 604_800]) {
      const deadline = defaultDepositDeadline(duration);
      expect(Number.isInteger(deadline)).toBe(true);
      expect(validateDepositDeadline(deadline, duration)).toEqual({ valid: true });
    }
  });
});

describe('saveTemplateToLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores the extended fields so a template restores the whole draft', () => {
    saveTemplateToLocalStorage('Weekly BTC', {
      ...EMPTY_DRAFT,
      title: 'BTC above 100k?',
      resolutionCriteria: 'CoinGecko close price',
      externalLinks: 'https://example.com',
      coverImage: 'https://example.com/cover.png',
      saveAsTemplate: true,
    });

    const [saved] = loadSavedTemplates();
    expect(saved.name).toBe('Weekly BTC');
    expect(saved.draft).toMatchObject({
      title: 'BTC above 100k?',
      resolutionCriteria: 'CoinGecko close price',
      externalLinks: 'https://example.com',
      coverImage: 'https://example.com/cover.png',
    });
    expect(saved.draft).not.toHaveProperty('saveAsTemplate');
  });
});
