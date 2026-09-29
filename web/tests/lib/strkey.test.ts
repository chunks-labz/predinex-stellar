/**
 * #1161 — strkey encoding must produce real Stellar addresses.
 *
 * The read layer previously emitted `'G' + bytes.toString('base64')`, which is
 * not a strkey at all: base64 uses `+`, `/` and `=`, none of which are in the
 * strkey alphabet, and no CRC-16 checksum is appended. These tests pin the
 * encoders to the canonical SEP-23 vectors and to the Stellar SDK's own
 * implementation.
 */
import { describe, expect, it } from 'vitest';
import { Address, StrKey } from '@stellar/stellar-sdk';
import fc from 'fast-check';
import {
  encodeEd25519PublicKey,
  encodeScContractAddress,
  encodeStrkey,
  STRKEY_ENCODED_LENGTH,
  STRKEY_PAYLOAD_BYTES,
  STRKEY_VERSION_CONTRACT,
  STRKEY_VERSION_ED25519,
} from '../../app/lib/strkey';

/**
 * SEP-23 canonical test vector: the ed25519 public key shared by the account,
 * contract, and liquidity-pool examples in the spec.
 */
const SEP23_PUBLIC_KEY = Buffer.from(
  '3f0c34bf93ad0d9971d04ccc90f705511c838aad9734a4a2fb0d7a03fc7fe89a',
  'hex'
);
const SEP23_ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const SEP23_CONTRACT = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA';

/**
 * Any strkey must be built only from the RFC 4648 base32 alphabet.
 *
 * Note the alphabet is uppercase: Stellar emits uppercase strkeys and the SDK
 * rejects lowercase input, so a lowercase address would never match the value
 * reported by soroban-rpc/Horizon. What must never appear is the base64-specific
 * `+`, `/` and `=`, or a lowercase letter.
 */
const STRKEY_ALPHABET = /^[A-Z2-7]+$/;

describe('encodeEd25519PublicKey', () => {
  it('matches the canonical SEP-23 account vector', () => {
    expect(encodeEd25519PublicKey(SEP23_PUBLIC_KEY)).toBe(SEP23_ACCOUNT);
  });

  it('produces a G-prefixed strkey of the documented length', () => {
    const encoded = encodeEd25519PublicKey(SEP23_PUBLIC_KEY);
    expect(encoded).toHaveLength(STRKEY_ENCODED_LENGTH);
    expect(encoded.startsWith('G')).toBe(true);
  });

  it('rejects payloads that are not 32 bytes', () => {
    expect(() => encodeEd25519PublicKey(Buffer.alloc(31))).toThrow(/32 bytes/);
    expect(() => encodeEd25519PublicKey(Buffer.alloc(33))).toThrow(/32 bytes/);
  });
});

describe('encodeScContractAddress', () => {
  it('matches the canonical SEP-23 contract vector', () => {
    expect(encodeScContractAddress(SEP23_PUBLIC_KEY)).toBe(SEP23_CONTRACT);
  });

  it('produces a C-prefixed strkey of the documented length', () => {
    const encoded = encodeScContractAddress(SEP23_PUBLIC_KEY);
    expect(encoded).toHaveLength(STRKEY_ENCODED_LENGTH);
    expect(encoded.startsWith('C')).toBe(true);
  });

  it('uses the SEP-23 contract base version byte, not the muxed-account one', () => {
    // 12 << 3 is the muxed-account base value and would render an `M...` address.
    expect(STRKEY_VERSION_CONTRACT).toBe(2 << 3);
    expect(encodeScContractAddress(Buffer.alloc(STRKEY_PAYLOAD_BYTES, 1))[0]).toBe('C');
  });

  it('rejects payloads that are not 32 bytes', () => {
    expect(() => encodeScContractAddress(new Uint8Array(0))).toThrow(/32 bytes/);
  });
});

describe('strkey charset invariants', () => {
  const encoders = [
    ['account', encodeEd25519PublicKey],
    ['contract', encodeScContractAddress],
  ] as const;

  for (const [label, encode] of encoders) {
    it(`${label} output never contains base64-only or non-strkey characters`, () => {
      for (let seed = 0; seed < 64; seed++) {
        const bytes = Buffer.alloc(STRKEY_PAYLOAD_BYTES);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 37 + i * 11) % 256;

        const encoded = encode(bytes);
        expect(encoded).not.toMatch(/[+/=]/);
        expect(encoded).not.toMatch(/[a-z]/);
        expect(encoded).toMatch(STRKEY_ALPHABET);
      }
    });
  }
});

describe('round-trip through the Stellar SDK', () => {
  it('SDK decodes our account addresses and re-encoding is byte-identical', () => {
    for (let seed = 0; seed < 32; seed++) {
      const bytes = Buffer.alloc(STRKEY_PAYLOAD_BYTES);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 91 + i * 7) % 256;

      const encoded = encodeEd25519PublicKey(bytes);

      // Throws if the version byte or CRC-16 checksum is wrong.
      const decoded = Address.fromString(encoded);
      expect(decoded.toBuffer().equals(Buffer.from(bytes))).toBe(true);

      // Re-encoding the decoded payload reproduces the identical string.
      expect(encodeEd25519PublicKey(decoded.toBuffer())).toBe(encoded);
    }
  });

  it('SDK decodes our contract addresses and re-encoding is byte-identical', () => {
    for (let seed = 0; seed < 32; seed++) {
      const bytes = Buffer.alloc(STRKEY_PAYLOAD_BYTES);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 53 + i * 23) % 256;

      const encoded = encodeScContractAddress(bytes);
      const decoded = Address.fromString(encoded);
      expect(decoded.toBuffer().equals(Buffer.from(bytes))).toBe(true);
      expect(encodeScContractAddress(decoded.toBuffer())).toBe(encoded);
    }
  });

  it('agrees with the SDK on arbitrary 32-byte payloads', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (bytes) => {
        expect(encodeEd25519PublicKey(bytes)).toBe(StrKey.encodeEd25519PublicKey(Buffer.from(bytes)));
        expect(encodeScContractAddress(bytes)).toBe(StrKey.encodeContract(Buffer.from(bytes)));
        return true;
      }),
      { numRuns: 200 }
    );
  });
});

describe('encodeStrkey', () => {
  it('is the shared implementation behind both Stellar encoders', () => {
    const bytes = Buffer.alloc(STRKEY_PAYLOAD_BYTES, 7);
    expect(encodeStrkey(STRKEY_VERSION_ED25519, bytes)).toBe(encodeEd25519PublicKey(bytes));
    expect(encodeStrkey(STRKEY_VERSION_CONTRACT, bytes)).toBe(encodeScContractAddress(bytes));
  });

  it('embeds a CRC-16/XModem checksum in the trailing characters', () => {
    // Flipping a single payload bit must change the encoded string.
    const original = Buffer.alloc(STRKEY_PAYLOAD_BYTES, 3);
    const mutated = Buffer.from(original);
    mutated[31] ^= 0x01;

    expect(encodeEd25519PublicKey(mutated)).not.toBe(encodeEd25519PublicKey(original));
  });
});
