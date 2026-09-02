import { Keypair } from '@stellar/stellar-sdk';

/**
 * Derive the Stellar public key (G...) that is the counterpart to a secret key
 * (S...).
 *
 * If derivation fails — e.g. the secret key is malformed or misconfigured — the
 * function throws. Callers must surface this error rather than continuing with a
 * fabricated placeholder public key, which would silently mask misconfiguration
 * and cause the bot to act under a key that is not the real counterpart to its
 * secret.
 *
 * @param secretKey A Stellar secret key strkey (S...)
 * @returns The derived public key strkey (G...)
 */
export function deriveStellarPublicKey(secretKey: string): string {
  try {
    return Keypair.fromSecret(secretKey).publicKey();
  } catch (error) {
    throw new Error(
      `Failed to derive public key from secret key: ${
        error instanceof Error ? error.message : 'invalid secret key'
      }`
    );
  }
}
