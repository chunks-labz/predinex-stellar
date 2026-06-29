import { describe, it, expect } from 'vitest';
import {
  BLOCK_TIME_SECONDS,
  blocksToSeconds,
  formatCountdown,
  formatCountdownAccessible,
  isUrgent,
} from '../../app/lib/countdown-utils';

describe('blocksToSeconds', () => {
  it('converts remaining blocks using the average block time', () => {
    expect(blocksToSeconds(3)).toBe(3 * BLOCK_TIME_SECONDS);
  });

  it('returns null when expired or unknown', () => {
    expect(blocksToSeconds(null)).toBeNull();
    expect(blocksToSeconds(0)).toBeNull();
    expect(blocksToSeconds(-5)).toBeNull();
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
    expect(formatCountdown(null)).toBe('Expired');
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
    expect(formatCountdownAccessible(null)).toBe('Expired');
  });
});
