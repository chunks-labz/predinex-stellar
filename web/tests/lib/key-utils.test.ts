import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { deriveStellarPublicKey } from '../../app/lib/key-utils';

describe('deriveStellarPublicKey (issue #1003)', () => {
  it('returns the real public key counterpart to a valid secret key', () => {
    const keypair = Keypair.random();
    const publicKey = deriveStellarPublicKey(keypair.secret());
    expect(publicKey).toBe(keypair.publicKey());
    expect(publicKey.startsWith('G')).toBe(true);
  });

  it('throws when the secret key cannot be derived instead of returning a placeholder', () => {
    expect(() => deriveStellarPublicKey('not-a-real-secret-key')).toThrow(
      /Failed to derive public key/
    );
  });
});
