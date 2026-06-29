import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isDisputeMockDataEnabled } from '@/app/lib/feature-flags';

describe('Dispute Feature Flag Integration', () => {
  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA;
  });

  afterEach(() => {
    // Clean up after each test
    delete process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA;
  });

  it('should return false by default when flag is not set', () => {
    expect(isDisputeMockDataEnabled()).toBe(false);
  });

  it('should return false when flag is explicitly set to false', () => {
    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'false';
    expect(isDisputeMockDataEnabled()).toBe(false);
  });

  it('should return true when flag is set to true', () => {
    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'true';
    expect(isDisputeMockDataEnabled()).toBe(true);
  });

  it('should handle case insensitive true values', () => {
    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'TRUE';
    expect(isDisputeMockDataEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'True';
    expect(isDisputeMockDataEnabled()).toBe(true);
  });

  it('should handle case insensitive false values', () => {
    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'FALSE';
    expect(isDisputeMockDataEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = 'False';
    expect(isDisputeMockDataEnabled()).toBe(false);
  });

  it('should handle whitespace around values', () => {
    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = ' true ';
    expect(isDisputeMockDataEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = ' false ';
    expect(isDisputeMockDataEnabled()).toBe(false);
  });

  it('should return false for invalid values', () => {
    const invalidValues = ['1', '0', 'yes', 'no', 'enabled', 'disabled', '', 'invalid'];
    
    invalidValues.forEach(value => {
      process.env.NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA = value;
      expect(isDisputeMockDataEnabled()).toBe(false);
    });
  });
});
