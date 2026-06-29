import { describe, it, expect } from 'vitest';
import {
  formatDisplayAddress,
  WALLET_ADDRESS_DISPLAY,
} from '../../app/lib/address-display';
import { truncateAddress } from '../../lib/utils';

const SAMPLE = 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM';

describe('formatDisplayAddress', () => {
  it('matches truncateAddress with canonical wallet display lengths', () => {
    expect(formatDisplayAddress(SAMPLE)).toBe(
      truncateAddress(SAMPLE, WALLET_ADDRESS_DISPLAY.start, WALLET_ADDRESS_DISPLAY.end)
    );
  });

  it('returns empty string for empty input', () => {
    expect(formatDisplayAddress('')).toBe('');
  });
});
