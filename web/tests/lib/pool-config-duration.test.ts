import { describe, it, expect } from 'vitest';
import { POOL_CONFIG } from '@/app/lib/config';
import { MIN_POOL_DURATION_SECS, MAX_POOL_DURATION_SECS } from '@/lib/validators';

describe('POOL_CONFIG duration units', () => {
  it('MINIMUM_DURATION matches the contract minimum in seconds, not blocks', () => {
    expect(POOL_CONFIG.MINIMUM_DURATION).toBe(MIN_POOL_DURATION_SECS);
    expect(POOL_CONFIG.MINIMUM_DURATION).toBe(300);
  });

  it('MAXIMUM_DURATION matches the contract maximum in seconds, not blocks', () => {
    expect(POOL_CONFIG.MAXIMUM_DURATION).toBe(MAX_POOL_DURATION_SECS);
  });
});
