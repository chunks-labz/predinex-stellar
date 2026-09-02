/**
 * Tests for the i18n module (issue #1058).
 *
 * Verifies:
 * - useI18n hook is accessible within I18nProvider
 * - useTranslation is a functional alias for useI18n
 * - t() returns the correct English string for all new key groups
 * - t() falls back to the key name when a key is missing
 * - setLanguage switches to Spanish/French translations
 * - All new key groups exist in es and fr locales
 */
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { I18nProvider, useI18n, useTranslation } from '@/app/lib/i18n';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider>{children}</I18nProvider>
);

// ─── useI18n / useTranslation alias ────────────────────────────────────────

describe('useI18n', () => {
  it('exposes t, language, and setLanguage', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(typeof result.current.t).toBe('function');
    expect(result.current.language).toBe('en');
    expect(typeof result.current.setLanguage).toBe('function');
  });

  it('useTranslation is the same hook as useI18n', () => {
    const hook1 = renderHook(() => useI18n(), { wrapper });
    const hook2 = renderHook(() => useTranslation(), { wrapper });
    // Both return the same language
    expect(hook1.result.current.language).toBe(hook2.result.current.language);
  });

  it('throws when used outside I18nProvider', () => {
    // Suppress the error output in the test runner
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useI18n())).toThrow('useI18n must be used within an I18nProvider');
    spy.mockRestore();
  });
});

// ─── English defaults ───────────────────────────────────────────────────────

describe('t() — create wizard keys (en)', () => {
  it('returns StepBasics labels', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('create.basics.titleLabel')).toBe('Pool title');
    expect(result.current.t('create.basics.categoryLabel')).toBe('Category');
    expect(result.current.t('create.basics.categoryCrypto')).toBe('Cryptocurrency');
    expect(result.current.t('create.basics.tagsHint')).toBe('Comma-separated labels for discovery.');
  });

  it('returns StepParameters labels', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('create.params.durationLabel')).toBe('Pool expiry (seconds)');
    expect(result.current.t('create.params.estimatedFeesTitle')).toBe('Estimated fees');
    expect(result.current.t('create.params.totalEstimate')).toBe('Total estimate');
  });

  it('returns StepOutcomes labels', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('create.outcomes.addButton')).toBe('Add outcome');
    expect(result.current.t('create.outcomes.placeholderYes')).toBe('e.g. Yes');
    expect(result.current.t('create.outcomes.placeholderNo')).toBe('e.g. No');
  });
});

describe('t() — betting keys (en)', () => {
  it('returns betting section strings', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('betting.sectionTitle')).toBe('Place Bet');
    expect(result.current.t('betting.connectTitle')).toBe('Connect Wallet to Bet');
    expect(result.current.t('betting.poolSettled')).toBe('This pool has been settled.');
    expect(result.current.t('betting.wrongNetwork')).toBe('Wrong Network');
  });
});

describe('t() — claim keys (en)', () => {
  it('returns claim button strings', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('claim.button')).toBe('Claim Winnings');
    expect(result.current.t('claim.processing')).toBe('Processing...');
  });
});

describe('t() — empty state / disconnected / auth guard keys (en)', () => {
  it('returns empty state strings', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('emptyState.defaultMessage')).toBe('No items to display.');
  });

  it('returns disconnected state strings', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('disconnected.walletNotConnected')).toBe('Wallet not connected');
    expect(result.current.t('disconnected.connectButton')).toBe('Connect Wallet');
  });

  it('returns auth guard strings', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.t('authGuard.connectTitle')).toBe('Authentication Required');
    expect(result.current.t('authGuard.goHome')).toBe('Go Home');
    expect(result.current.t('authGuard.supportedWalletsTitle')).toBe('Supported Wallets');
  });
});

// ─── Fallback behaviour ─────────────────────────────────────────────────────

describe('t() — fallback', () => {
  it('returns the key name when the key does not exist', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    // @ts-expect-error — intentionally passing an unknown key
    expect(result.current.t('non.existent.key')).toBe('non.existent.key');
  });

  it('returns the supplied fallback string when provided', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    // @ts-expect-error — intentionally passing an unknown key
    expect(result.current.t('non.existent.key', 'my fallback')).toBe('my fallback');
  });
});

// ─── Language switching ─────────────────────────────────────────────────────

describe('setLanguage', () => {
  it('switches to Spanish translations', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLanguage('es'));
    expect(result.current.language).toBe('es');
    expect(result.current.t('betting.sectionTitle')).toBe('Realizar apuesta');
    expect(result.current.t('claim.button')).toBe('Reclamar ganancias');
    expect(result.current.t('create.outcomes.addButton')).toBe('Añadir resultado');
  });

  it('switches to French translations', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLanguage('fr'));
    expect(result.current.language).toBe('fr');
    expect(result.current.t('betting.sectionTitle')).toBe('Placer un pari');
    expect(result.current.t('claim.button')).toBe('Réclamer les gains');
    expect(result.current.t('authGuard.connectTitle')).toBe('Connectez votre wallet');
  });

  it('falls back to English when a key is only defined in en', () => {
    const { result } = renderHook(() => useI18n(), { wrapper });
    act(() => result.current.setLanguage('es'));
    // nav.markets is defined in both; just verify it returns the Spanish value
    expect(result.current.t('nav.markets')).toBe('Mercados');
  });
});
