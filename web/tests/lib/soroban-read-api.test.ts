/**
 * #1161 — `parseScVal` must return the address the RPC actually reported.
 *
 * Two defects are covered here:
 *  1. `parseScAddress` used a hand-rolled `'G' + base64` "encoding" that never
 *     produced a valid strkey.
 *  2. The `ScVal` union discriminant was read as a single byte, but XDR encodes
 *     every enum discriminant as a 4-byte big-endian integer. The leading byte is
 *     therefore always 0, so *every* ScVal fell into the `SCV_BOOL` branch and
 *     the address branch was unreachable.
 */
import { describe, expect, it } from 'vitest';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { parseScVal } from '../../app/lib/soroban-read-api';
import { encodeEd25519PublicKey, encodeScContractAddress } from '../../app/lib/strkey';

const SEP23_PUBLIC_KEY = Buffer.from(
  '3f0c34bf93ad0d9971d04ccc90f705511c838aad9734a4a2fb0d7a03fc7fe89a',
  'hex'
);
const SEP23_ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const SEP23_CONTRACT = 'CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA';

function scAddressXdr(address: string): string {
  return xdr.ScVal.scvAddress(Address.fromString(address).toScAddress()).toXDR('base64');
}

describe('parseScVal — ScAddress', () => {
  it('decodes an account address to the exact strkey the RPC reported', () => {
    expect(parseScVal(scAddressXdr(SEP23_ACCOUNT))).toBe(SEP23_ACCOUNT);
  });

  it('decodes a contract address to the exact strkey the RPC reported', () => {
    expect(parseScVal(scAddressXdr(SEP23_CONTRACT))).toBe(SEP23_CONTRACT);
  });

  it('matches the SDK for arbitrary accounts', () => {
    for (let seed = 0; seed < 16; seed++) {
      const key = Buffer.alloc(32);
      for (let i = 0; i < key.length; i++) key[i] = (seed * 61 + i * 29) % 256;
      const address = StrKey.encodeEd25519PublicKey(key);

      expect(parseScVal(scAddressXdr(address))).toBe(address);
    }
  });

  it('never returns a base64-shaped string', () => {
    const decoded = parseScVal(scAddressXdr(SEP23_ACCOUNT)) as string;

    expect(decoded).not.toMatch(/[+/=]/);
    expect(decoded).toBe(encodeEd25519PublicKey(SEP23_PUBLIC_KEY));
  });

  it('uses the contract version byte for contract addresses', () => {
    const decoded = parseScVal(scAddressXdr(SEP23_CONTRACT)) as string;
    expect(decoded).toBe(encodeScContractAddress(SEP23_PUBLIC_KEY));
    expect(decoded.startsWith('C')).toBe(true);
  });
});

describe('parseScVal — neighbouring union tags', () => {
  it('does not mistake an address for a boolean (regression on 1-byte tags)', () => {
    // A 4-byte big-endian discriminant of 18 has a leading zero byte. Reading the
    // tag as one byte yields 0 => SCV_BOOL, which was the original silent failure.
    const encoded = scAddressXdr(SEP23_ACCOUNT);
    expect(Buffer.from(encoded, 'base64')[0]).toBe(0);

    const parsed = parseScVal(encoded);
    expect(typeof parsed).toBe('string');
    expect(Address.fromString(parsed as string).toBuffer().equals(SEP23_PUBLIC_KEY)).toBe(true);
  });

  it('decodes SCV_U32 and SCV_STRING using their real tag values', () => {
    expect(parseScVal(xdr.ScVal.scvU32(4294967295).toXDR('base64'))).toBe(4294967295);
    expect(parseScVal(xdr.ScVal.scvString('predinex').toXDR('base64'))).toBe('predinex');
    expect(parseScVal(xdr.ScVal.scvSymbol('bet_placed').toXDR('base64'))).toBe('bet_placed');
  });

  it('decodes SCV_U128 and SCV_I128', () => {
    // Built by hand: js-xdr's `scvU128` cannot serialize a raw BigInt.
    // Negative values are two's complement, so every byte above the low 64 bits
    // is 0xff.
    const i128 = (value: bigint): string => {
      const payload = Buffer.alloc(16);
      if (value < 0n) payload.fill(0xff, 0, 8);
      payload.writeBigUInt64BE(BigInt.asUintN(64, value), 8);
      return Buffer.concat([Buffer.from([0, 0, 0, 10]), payload]).toString('base64');
    };

    expect(parseScVal(i128(10n ** 12n))).toBe(10n ** 12n);
    expect(parseScVal(i128(-42n))).toBe(-42n);
    expect(parseScVal(i128(0n))).toBe(0n);
  });

  it('decodes a Vec of ScVals', () => {
    const vec = xdr.ScVal.scvVec([xdr.ScVal.scvU32(7), xdr.ScVal.scvString('settled')]);
    expect(parseScVal(vec.toXDR('base64'))).toEqual([7, 'settled']);
  });

  it('decodes a Map of symbol keys to values', () => {
    const map = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('total_a'), val: xdr.ScVal.scvU32(5) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('expiry'), val: xdr.ScVal.scvU32(1780000000) }),
    ]);
    expect(parseScVal(map.toXDR('base64'))).toEqual({ total_a: 5, expiry: 1780000000 });
  });

  it('decodes a nested Vec of addresses', () => {
    const vec = xdr.ScVal.scvVec([
      xdr.ScVal.scvAddress(Address.fromString(SEP23_ACCOUNT).toScAddress()),
      xdr.ScVal.scvAddress(Address.fromString(SEP23_CONTRACT).toScAddress()),
    ]);
    expect(parseScVal(vec.toXDR('base64'))).toEqual([SEP23_ACCOUNT, SEP23_CONTRACT]);
  });

  it('decodes an empty Vec and an empty Map', () => {
    expect(parseScVal(xdr.ScVal.scvVec([]).toXDR('base64'))).toEqual([]);
    expect(parseScVal(xdr.ScVal.scvMap([]).toXDR('base64'))).toEqual({});
  });

  it('returns null for SCV_VOID and for empty input', () => {
    expect(parseScVal(xdr.ScVal.scvVoid().toXDR('base64'))).toBeNull();
    expect(parseScVal('')).toBeNull();
  });
});
