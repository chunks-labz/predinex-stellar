import { describe, it, expect } from 'vitest';
import { parsePoolId } from '../../app/lib/market-types';

describe('parsePoolId', () => {
  it('parses a numeric route parameter', () => {
    expect(parsePoolId('12')).toBe(12);
    expect(parsePoolId(12)).toBe(12);
  });

  it('parses a numeric string with surrounding whitespace', () => {
    expect(parsePoolId(' 7 ')).toBe(7);
  });

  it('accepts pool id 0', () => {
    expect(parsePoolId('0')).toBe(0);
  });

  it('returns null for a non-numeric id', () => {
    expect(parsePoolId('abc')).toBeNull();
  });

  it('returns null for a negative id', () => {
    expect(parsePoolId('-3')).toBeNull();
  });

  it('returns null for an empty or missing id', () => {
    expect(parsePoolId('')).toBeNull();
    expect(parsePoolId(null)).toBeNull();
    expect(parsePoolId(undefined)).toBeNull();
  });

  it('returns null for a fractional id', () => {
    expect(parsePoolId(1.5)).toBeNull();
  });
});
