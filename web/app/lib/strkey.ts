/**
 * Stellar strkey encoding (#1161).
 *
 * Stellar addresses are strkey values: RFC 4648 base32 (uppercase alphabet, no
 * padding) over a single version byte followed by the raw payload, with a
 * trailing CRC-16/XModem checksum (poly 0x1021) appended as two bytes before
 * encoding. See SEP-23 for the specification and its canonical test vectors.
 *
 * The alphabet is uppercase: every strkey Stellar emits is uppercase, the
 * Stellar SDK rejects lowercase input, and the SDK/Horizon/soroban-rpc all
 * report uppercase addresses. Lowercase output would therefore never compare
 * equal to an address obtained from the network.
 *
 * The read layer used to fake these with base64 (`'G' + bytes.toString('base64')`),
 * which produced plausible-looking but structurally invalid addresses that failed
 * strkey validation and never matched the accounts the RPC actually reported.
 * These encoders are the single place the read layer produces address strings.
 */

/** RFC 4648 base32 alphabet used by strkey (uppercase, no padding). */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Strkey version byte for an ed25519 account public key (`6 << 3`, renders as `G`). */
export const STRKEY_VERSION_ED25519 = 6 << 3; // 0b0011_0000 = 48

/**
 * Strkey version byte for a Soroban contract (`2 << 3`, renders as `C`).
 *
 * Per SEP-23 the contract base value is `2 << 3`. `12 << 3` is the *muxed
 * account* base value and would render an `M...` muxed address, not a contract.
 */
export const STRKEY_VERSION_CONTRACT = 2 << 3; // 0b0001_0000 = 16

/** Length in bytes of a Stellar ed25519 public key / Soroban contract hash. */
export const STRKEY_PAYLOAD_BYTES = 32;

/** Total encoded length of a `G...`/`C...` strkey: 1 prefix + 55 base32 chars. */
export const STRKEY_ENCODED_LENGTH = 56;

const CRC16_XMODEM_POLYNOMIAL = 0x1021;

/**
 * CRC-16/XModem over `bytes` (poly 0x1021, init 0x0000, no reflection, no final XOR).
 */
function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;

  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC16_XMODEM_POLYNOMIAL) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc & 0xffff;
}

/**
 * Encode raw bytes as RFC 4648 base32 without padding.
 *
 * @throws If the input is not a whole number of 5-bit groups once zero-padded
 *         to a group boundary (never happens for strkey payloads, which are
 *         always a multiple of 5 bytes: version + 32-byte key + 2 CRC bytes).
 */
function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 0x1f];
    }
  }

  // Flush the trailing partial group with zero padding (strkey payloads are
  // always a multiple of 5 bytes, so this is defensive only).
  if (bits > 0) {
    output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 0x1f];
  }

  return output;
}

/**
 * Encode a version byte + payload as a strkey string.
 *
 * @param versionByte - Strkey version byte (e.g. `STRKEY_VERSION_ED25519`).
 * @param payload - Raw payload bytes; must be `STRKEY_PAYLOAD_BYTES` long for Stellar addresses.
 * @returns The canonical strkey, e.g. `G...` or `C...`.
 */
export function encodeStrkey(versionByte: number, payload: Uint8Array): string {
  const versioned = new Uint8Array(1 + payload.length);
  versioned[0] = versionByte;
  versioned.set(payload, 1);

  const checksum = crc16Xmodem(versioned);
  const checksummed = new Uint8Array(versioned.length + 2);
  checksummed.set(versioned, 0);
  // Strkey appends the checksum little-endian (low byte first), matching the
  // reference implementation in the Stellar SDK and stellar-core.
  checksummed[versioned.length] = checksum & 0xff;
  checksummed[versioned.length + 1] = (checksum >>> 8) & 0xff;

  return toBase32(checksummed);
}

function assertPayload(payload: Uint8Array): void {
  if (payload.length !== STRKEY_PAYLOAD_BYTES) {
    throw new Error(
      `strkey payload must be ${STRKEY_PAYLOAD_BYTES} bytes, received ${payload.length}.`
    );
  }
}

/**
 * Encode a 32-byte ed25519 public key as a Stellar account address (`G...`).
 *
 * @param publicKey - Raw 32-byte ed25519 public key.
 * @returns Canonical `G...` strkey.
 */
export function encodeEd25519PublicKey(publicKey: Uint8Array): string {
  assertPayload(publicKey);
  return encodeStrkey(STRKEY_VERSION_ED25519, publicKey);
}

/**
 * Encode a 32-byte Soroban contract hash as a contract address (`C...`).
 *
 * @param contractHash - Raw 32-byte contract hash.
 * @returns Canonical `C...` strkey.
 */
export function encodeScContractAddress(contractHash: Uint8Array): string {
  assertPayload(contractHash);
  return encodeStrkey(STRKEY_VERSION_CONTRACT, contractHash);
}
