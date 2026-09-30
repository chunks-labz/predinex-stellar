/**
 * Wallet ownership proof.
 *
 * A caller proves control of a Stellar account by signing a short,
 * timestamped challenge with the account's key. The server verifies the
 * signature against the claimed address before trusting it as an identity.
 *
 * Headers:
 *   x-predinex-wallet-address    G... public key
 *   x-predinex-wallet-timestamp  unix milliseconds the challenge was signed at
 *   x-predinex-wallet-signature  base64 ed25519 signature of the challenge
 *
 * The signature is accepted over either the raw challenge or its SEP-53
 * hash (sha256("Stellar Signed Message:\n" + challenge)), which is what
 * Freighter's `signMessage` produces.
 */

import { createHash } from 'crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

export const WALLET_ADDRESS_HEADER = 'x-predinex-wallet-address';
export const WALLET_TIMESTAMP_HEADER = 'x-predinex-wallet-timestamp';
export const WALLET_SIGNATURE_HEADER = 'x-predinex-wallet-signature';

/** Maximum age (and clock skew) accepted for a signed challenge. */
export const WALLET_PROOF_MAX_AGE_MS = 5 * 60 * 1000;

const SEP53_PREFIX = 'Stellar Signed Message:\n';

export function buildWalletChallenge(scope: string, address: string, timestamp: number): string {
  return `predinex:${scope}:${address}:${timestamp}`;
}

/**
 * Verify the wallet-ownership headers on a request.
 * Returns the verified address, or null if the proof is missing or invalid.
 */
export function verifyWalletProof(headers: Headers, scope: string, now = Date.now()): string | null {
  const address = headers.get(WALLET_ADDRESS_HEADER)?.trim();
  const timestampRaw = headers.get(WALLET_TIMESTAMP_HEADER)?.trim();
  const signatureRaw = headers.get(WALLET_SIGNATURE_HEADER)?.trim();
  if (!address || !timestampRaw || !signatureRaw) return null;
  if (!StrKey.isValidEd25519PublicKey(address)) return null;

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return null;
  if (Math.abs(now - timestamp) > WALLET_PROOF_MAX_AGE_MS) return null;

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureRaw, 'base64');
  } catch {
    return null;
  }
  if (signature.length !== 64) return null;

  const challenge = buildWalletChallenge(scope, address, timestamp);
  const keypair = Keypair.fromPublicKey(address);
  const raw = Buffer.from(challenge, 'utf8');
  const sep53 = createHash('sha256').update(SEP53_PREFIX + challenge, 'utf8').digest();

  try {
    if (keypair.verify(raw, signature) || keypair.verify(sep53, signature)) {
      return address;
    }
  } catch {
    return null;
  }
  return null;
}
