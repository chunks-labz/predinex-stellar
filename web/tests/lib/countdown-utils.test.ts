import { describe, it, expect } from 'vitest';
import {
  secondsUntil,
  formatCountdown,
  formatCountdownAccessible,
  isUrgent,
} from '../../app/lib/countdown-utils';

describe('secondsUntil', () => {
  // #1284 — expiry is a Unix timestamp in seconds, not a block height, so no
  // block-time conversion is involved.
  const NOW = 1_780_000_000;

  it('returns the whole seconds between now and expiry', () => {
    expect(secondsUntil(NOW + 3600, NOW)).toBe(3600);
    expect(secondsUntil(NOW + 90, NOW)).toBe(90);
  });

  it('truncates partial seconds rather than rounding up', () => {
    expect(secondsUntil(NOW + 10.9, NOW)).toBe(10);
  });

  it('returns null once the expiry instant has passed', () => {
    expect(secondsUntil(NOW, NOW)).toBeNull();
    expect(secondsUntil(NOW - 1, NOW)).toBeNull();
    expect(secondsUntil(NOW - 86400, NOW)).toBeNull();
  });

  it('returns null for missing or unusable expiry values', () => {
    expect(secondsUntil(null, NOW)).toBeNull();
    expect(secondsUntil(0, NOW)).toBeNull();
    expect(secondsUntil(-1, NOW)).toBeNull();
    expect(secondsUntil(Number.NaN, NOW)).toBeNull();
  });

  it('reproduces the reported bug: a real timestamp is no longer treated as a height', () => {
    // The old code did `blocksToSeconds(expiry - blockHeight)`, turning a 2026-era
    // timestamp into ~273 years of remaining time instead of expiring promptly.
    const expiry = NOW + 2 * 60 * 60; // two hours out
    const remaining = secondsUntil(expiry, NOW);
    expect(remaining).toBe(7200);
    expect(remaining!).toBeLessThan(86_400 * 365);
  });

  it('defaults to the current wall clock when now is omitted', () => {
    const remaining = secondsUntil(Math.floor(Date.now() / 1000) + 120);
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeGreaterThan(0);
    expect(remaining!).toBeLessThanOrEqual(120);
  });
});

describe('formatCountdown', () => {
  it('shows days/hours/minutes when over a day remains', () => {
    const seconds = 2 * 86400 + 4 * 3600 + 30 * 60 + 15;
    expect(formatCountdown(seconds)).toBe('2d 4h 30m');
  });

  it('shows hours/minutes/seconds under a day', () => {
    const seconds = 4 * 3600 + 30 * 60 + 15;
    expect(formatCountdown(seconds)).toBe('4h 30m 15s');
  });

  it('shows minutes/seconds under an hour', () => {
    expect(formatCountdown(30 * 60 + 15)).toBe('30m 15s');
  });

  it('renders Expired at or below zero', () => {
    expect(formatCountdown(0)).toBe('Expired');
    expect(formatCountdown(-10)).toBe('Expired');
  });

  it('renders a placeholder when the remaining time is unknown', () => {
    // `null` means "not loaded yet", which is distinct from an elapsed deadline.
    expect(formatCountdown(null)).toBe('--');
  });
});

describe('isUrgent', () => {
  it('is urgent under one hour but not expired', () => {
    expect(isUrgent(59 * 60)).toBe(true);
    expect(isUrgent(1)).toBe(true);
  });

  it('is not urgent at or above one hour', () => {
    expect(isUrgent(60 * 60)).toBe(false);
    expect(isUrgent(2 * 3600)).toBe(false);
  });

  it('is not urgent when expired or unknown', () => {
    expect(isUrgent(0)).toBe(false);
    expect(isUrgent(null)).toBe(false);
  });
});

describe('formatCountdownAccessible', () => {
  it('describes the remaining time in words', () => {
    const seconds = 2 * 86400 + 4 * 3600 + 30 * 60;
    expect(formatCountdownAccessible(seconds)).toBe('2 days, 4 hours, 30 minutes remaining');
  });

  it('uses singular units correctly', () => {
    const seconds = 1 * 86400 + 1 * 3600 + 1 * 60;
    expect(formatCountdownAccessible(seconds)).toBe('1 day, 1 hour, 1 minute remaining');
  });

  it('falls back to a coarse label under a minute', () => {
    expect(formatCountdownAccessible(30)).toBe('Less than a minute remaining');
  });

  it('renders Expired at or below zero', () => {
    expect(formatCountdownAccessible(0)).toBe('Expired');
    expect(formatCountdownAccessible(-10)).toBe('Expired');
  });

  it('announces a loading state when the remaining time is unknown', () => {
    expect(formatCountdownAccessible(null)).toBe('Loading time remaining');
  });
});
