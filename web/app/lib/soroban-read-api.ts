/**
 * Soroban Read API
 *
 * Canonical read-only contract calls for the Predinex Soroban contract.
 * All pool and user data reads go through the Soroban RPC using simulateTransaction.
 *
 * This module provides the canonical Soroban read layer for:
 * - Pool data (get_pool)
 * - User bets (get_user_bet)
 * - Pool count (get_pool_count)
 * - Batch pool reads (get_pools_batch)
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { getRuntimeConfig } from './runtime-config';
import { createScopedLogger } from './logger';
import { fetchHorizon } from './horizon-client';
import {
  encodeEd25519PublicKey,
  encodeScContractAddress,
  STRKEY_PAYLOAD_BYTES,
} from './strkey';

const log = createScopedLogger('soroban-read-api');
import type { Pool, UserBetData } from './market-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Runtime configuration for Soroban RPC read operations.
 */
export interface SorobanReadConfig {
  /** Soroban RPC endpoint URL (e.g. `https://soroban-testnet.stellar.org`). */
  rpcUrl: string;
  /** Deployed contract ID in `C...` strkey format. */
  contractId: string;
}

/**
 * Result wrapper returned by single-pool Soroban reads.
 */
export interface PoolReadResult {
  /** Normalized pool data, or `null` when the pool is missing or unreadable. */
  pool: Pool | null;
  /** Human-readable error message when the read fails. */
  error?: string;
}

/**
 * Result wrapper returned by user-bet Soroban reads.
 */
export interface UserBetReadResult {
  /** User stake breakdown, or `null` when no bet exists or the read fails. */
  bet: UserBetData | null;
  /** Human-readable error message when the read fails. */
  error?: string;
}

/**
 * Per-pool minimum and maximum bet amounts enforced by the Soroban contract.
 */
export interface PoolBetLimits {
  /** Minimum bet in raw token units (stroops). */
  minBet: number;
  /** Maximum bet in raw token units (stroops); `0` may mean unlimited. */
  maxBet: number;
}

// Raw pool data shape from Soroban contract
interface RawSorobanPool {
  creator?: string;
  title?: string;
  description?: string;
  outcome_a_name?: string;
  outcome_b_name?: string;
  total_a?: bigint | number | string;
  total_b?: bigint | number | string;
  participant_count?: number;
  settled?: boolean;
  winning_outcome?: number | null;
  created_at?: bigint | number | string;
  expiry?: bigint | number | string;
  status?: string | { tag: string; values?: unknown[] };
}

// Raw user bet data shape from Soroban contract
interface RawSorobanUserBet {
  amount_a?: bigint | number | string;
  amount_b?: bigint | number | string;
  total_bet?: bigint | number | string;
}

// Raw per-pool bet limits returned by `get_pool_bet_limits`.
interface RawSorobanBetLimits {
  min_bet?: bigint | number | string;
  max_bet?: bigint | number | string;
}

// ---------------------------------------------------------------------------
// XDR Helpers
// ---------------------------------------------------------------------------

/**
 * Source account used for read-only simulations. `simulateTransaction` never
 * loads or charges the source, so any valid account strkey works; this is the
 * all-zero ed25519 key.
 */
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Error thrown when a Soroban read cannot be completed (transport failure,
 * RPC error, or a failed simulation). Reads surface this instead of returning
 * `null`, so a broken read path is distinguishable from "no data".
 */
export class SorobanReadError extends Error {
  constructor(message: string, readonly functionName: string) {
    super(message);
    this.name = 'SorobanReadError';
  }
}

/**
 * Encode a JS read argument as an `ScVal`.
 *
 * Every numeric argument of the contract's read functions is a `u32`
 * (pool IDs, ranges); account/contract strkeys are `Address`es.
 */
export function readArgToScVal(arg: unknown): xdr.ScVal {
  if (typeof arg === 'number') {
    if (!Number.isInteger(arg) || arg < 0 || arg > 0xffffffff) {
      throw new TypeError(`Read argument ${arg} is not a valid u32`);
    }
    return nativeToScVal(arg, { type: 'u32' });
  }
  if (typeof arg === 'bigint') {
    return nativeToScVal(arg, { type: 'i128' });
  }
  if (typeof arg === 'string' && /^[GC][A-Z2-7]{55}$/.test(arg)) {
    return new Address(arg).toScVal();
  }
  return nativeToScVal(arg);
}

/**
 * Build a base64 `TransactionEnvelope` invoking `functionName` on the contract,
 * suitable for `simulateTransaction`.
 */
export function buildReadTransactionXDR(
  contractId: string,
  functionName: string,
  args: unknown[] = [],
  networkPassphrase: string = getNetworkPassphrase()
): string {
  return new TransactionBuilder(new Account(SIMULATION_SOURCE, '0'), {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(functionName, ...args.map(readArgToScVal)))
    .setTimeout(0)
    .build()
    .toXDR();
}

function getNetworkPassphrase(): string {
  return getRuntimeConfig().network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

// ---------------------------------------------------------------------------
// RPC Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a transaction on the Soroban RPC to read contract state.
 *
 * @returns The decoded return value (`null` for `void` / `Option::None`).
 * @throws {SorobanReadError} On transport, RPC, or simulation failure.
 */
async function simulateContractRead(
  rpcUrl: string,
  contractId: string,
  functionName: string,
  args: unknown[] = []
): Promise<unknown> {
  const transactionXDR = buildReadTransactionXDR(contractId, functionName, args);

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: {
      transaction: transactionXDR,
    },
  };

  const response = await fetchHorizon(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new SorobanReadError(`Soroban RPC error: HTTP ${response.status}`, functionName);
  }

  const json = await response.json();

  if (json.error) {
    throw new SorobanReadError(
      `Soroban RPC returned error: ${json.error.message ?? JSON.stringify(json.error)}`,
      functionName
    );
  }

  const result = json.result;
  if (!result) {
    throw new SorobanReadError('Soroban RPC returned no result', functionName);
  }

  // A failed simulation (contract panic, missing entry, bad args) reports
  // `error` instead of `results`.
  if (result.error) {
    throw new SorobanReadError(`Simulation of ${functionName} failed: ${result.error}`, functionName);
  }

  if (result.results && result.results.length > 0) {
    return parseScVal(result.results[0].xdr);
  }

  if (result.xdr) {
    // Legacy format
    return parseScVal(result.xdr);
  }

  throw new SorobanReadError(`Simulation of ${functionName} returned no value`, functionName);
}

/**
 * XDR `ScVal` union discriminant values (protocol 20+ / 22).
 *
 * Every union discriminant in XDR is a 4-byte big-endian integer, so these
 * constants are compared against `readInt32BE(0)`, never against a single byte.
 * @see https://developers.stellar.org/docs/data/encoding/xdr
 */
const SCV = {
  BOOL: 0,
  VOID: 1,
  ERROR: 2,
  U32: 3,
  I32: 4,
  U64: 5,
  I64: 6,
  TIMEPOINT: 7,
  DURATION: 8,
  U128: 9,
  I128: 10,
  U256: 11,
  I256: 12,
  BYTES: 13,
  STRING: 14,
  SYMBOL: 15,
  VEC: 16,
  MAP: 17,
  ADDRESS: 18,
  CONTRACT_INSTANCE: 19,
} as const;

/**
 * Legacy `ScObject` discriminant, used only by the pre-protocol-22
 * `SCV_OBJECT` wrapper. Distinct numbering from {@link SCV}.
 */
const SCO = {
  BOX: 0,
  VEC: 1,
  MAP: 2,
  U64: 3,
  I64: 4,
  U128: 5,
  I128: 6,
  U256: 7,
  I256: 8,
  BYTES: 9,
  CONTRACT_CODE: 10,
  ADDRESS: 11,
  NONCE_KEY: 12,
} as const;

/** `ScAddress` discriminant values. */
const SC_ADDRESS_TYPE = { ACCOUNT: 0, CONTRACT: 1 } as const;

/** Byte width of an XDR enum discriminant. */
const XDR_DISCRIMINANT_BYTES = 4;

/** Byte offset of the payload following a 4-byte XDR discriminant. */
const XDR_PAYLOAD_OFFSET = XDR_DISCRIMINANT_BYTES;

/**
 * Parse an SCVal XDR string into a JS value.
 *
 * @param xdr - Base64-encoded ScVal as returned by `soroban-rpc`.
 * @returns The decoded value; the raw base64 string for types with no JS mapping.
 */
export function parseScVal(xdr: string): unknown {
  if (!xdr || typeof xdr !== 'string') return null;

  try {
    const decoded = Buffer.from(xdr, 'base64');
    if (decoded.length < XDR_DISCRIMINANT_BYTES) return null;

    // The ScVal union discriminant is a 4-byte big-endian enum.
    const typeTag = decoded.readInt32BE(0);

    switch (typeTag) {
      case SCV.BOOL:
        return decoded.readUInt32BE(XDR_PAYLOAD_OFFSET) !== 0;
      case SCV.VOID:
        return null;
      case SCV.U32:
        return decoded.readUInt32BE(XDR_PAYLOAD_OFFSET);
      case SCV.I32:
        return decoded.readInt32BE(XDR_PAYLOAD_OFFSET);
      case SCV.U64:
        return decoded.readBigUInt64BE(XDR_PAYLOAD_OFFSET);
      case SCV.I64:
        return decoded.readBigInt64BE(XDR_PAYLOAD_OFFSET);
      case SCV.TIMEPOINT:
      case SCV.DURATION:
        return decoded.readBigUInt64BE(XDR_PAYLOAD_OFFSET);
      case SCV.STRING:
        return parseScString(decoded);
      case SCV.SYMBOL:
        return parseScString(decoded);
      case SCV.BYTES:
        return parseScBytes(decoded);
      case SCV.I128:
        return parseScI128(decoded);
      case SCV.U128:
        return parseScU128(decoded);
      case SCV.VEC:
        return parseScVec(decoded);
      case SCV.MAP:
        return parseScMap(decoded);
      case SCV.ADDRESS:
        return parseScAddress(decoded);
      case 12: // Legacy SCV_OBJECT wrapper (pre-protocol-22 encodes some types nested).
        return parseScObject(decoded);
      default:
        // Return raw for unknown types
        return xdr;
    }
  } catch (e) {
    log.error('Failed to parse SCVal:', e);
    return xdr;
  }
}

/**
 * Parse a legacy `ScObject` wrapper (pre-protocol-22 `SCV_OBJECT`).
 *
 * Only the variants the read layer can meaningfully surface are handled; the
 * rest return `null` as before.
 */
function parseScObject(decoded: Buffer): unknown {
  if (decoded.length < XDR_PAYLOAD_OFFSET * 2) return null;
  const objType = decoded.readInt32BE(XDR_PAYLOAD_OFFSET);

  switch (objType) {
    case SCO.VEC:
      return parseScVec(decoded.subarray(XDR_PAYLOAD_OFFSET));
    case SCO.MAP:
      return parseScMap(decoded.subarray(XDR_PAYLOAD_OFFSET));
    case SCO.U128:
      return parseScU128(decoded);
    case SCO.I128:
      return parseScI128(decoded);
    case SCO.ADDRESS:
      return parseScAddress(decoded);
    default:
      return null;
  }
}

function parseScString(decoded: Buffer): string {
  // XDR length-prefixed opaque: 4-byte length, then the UTF-8 payload, 4-byte padded.
  const len = decoded.readUInt32BE(XDR_PAYLOAD_OFFSET);
  return decoded.slice(XDR_PAYLOAD_OFFSET * 2, XDR_PAYLOAD_OFFSET * 2 + len).toString('utf8');
}

/**
 * Parse a length-prefixed opaque `ScBytes` value into a lowercase hex string.
 */
function parseScBytes(decoded: Buffer): string {
  const len = decoded.readUInt32BE(XDR_PAYLOAD_OFFSET);
  return decoded.slice(XDR_PAYLOAD_OFFSET * 2, XDR_PAYLOAD_OFFSET * 2 + len).toString('hex');
}

function parseScI128(decoded: Buffer): bigint {
  // I128: 16 bytes two's complement
  const hex = decoded.subarray(XDR_PAYLOAD_OFFSET, XDR_PAYLOAD_OFFSET + 16).toString('hex');
  const unsigned = BigInt(`0x${hex}`);
  // Check if negative (MSB set)
  if (unsigned >> BigInt(127)) {
    return unsigned - (BigInt(1) << BigInt(128));
  }
  return unsigned;
}

function parseScU128(decoded: Buffer): bigint {
  // U128: 16 bytes
  return BigInt(`0x${decoded.subarray(XDR_PAYLOAD_OFFSET, XDR_PAYLOAD_OFFSET + 16).toString('hex')}`);
}

/**
 * Length-prefixed `VecO`/`MapO` presence discriminant.
 *
 * `ScVec` is `VecO<ScVal>` and `ScMap` is `MapO<ScMapEntry>`, so each carries a
 * 4-byte enum discriminant before its contents. `0` means the value is absent
 * (an `Option::None`), which surfaces as `null`/`{}` rather than an empty list.
 */
function isPresentO(decoded: Buffer): boolean {
  if (decoded.length < XDR_PAYLOAD_OFFSET * 2) return false;
  return decoded.readInt32BE(XDR_PAYLOAD_OFFSET) !== 0;
}

/**
 * Byte length of the XDR encoding of an ScVal whose payload starts at `offset`.
 *
 * Needed because `vec<ScVal>` / `Map<ScVal, ScVal>` concatenate their elements
 * with no per-element length prefix — each element is simply zero-padded to the
 * next 4-byte boundary, so the parser has to know where one element ends.
 */
function scValEncodedLength(decoded: Buffer, offset: number): number {
  if (offset + XDR_DISCRIMINANT_BYTES > decoded.length) return 0;

  const typeTag = decoded.readInt32BE(offset);
  const payload = offset + XDR_PAYLOAD_OFFSET;
  const align4 = (n: number) => Math.ceil(n / 4) * 4;

  switch (typeTag) {
    case SCV.BOOL:
    case SCV.U32:
    case SCV.I32:
    case SCV.U64:
    case SCV.I64:
    case SCV.TIMEPOINT:
    case SCV.DURATION:
    case SCV.U128:
    case SCV.I128:
    case SCV.U256:
    case SCV.I256:
      return XDR_DISCRIMINANT_BYTES + fixedPayloadWidth(typeTag);
    case SCV.BYTES:
    case SCV.STRING:
    case SCV.SYMBOL:
      return XDR_DISCRIMINANT_BYTES + align4(XDR_DISCRIMINANT_BYTES + decoded.readUInt32BE(payload));
    case SCV.ADDRESS:
      // Account addresses nest an extra PublicKey union discriminant.
      return (
        XDR_DISCRIMINANT_BYTES * 2 +
        (decoded.readInt32BE(payload) === SC_ADDRESS_TYPE.ACCOUNT ? XDR_DISCRIMINANT_BYTES : 0) +
        STRKEY_PAYLOAD_BYTES
      );
    case SCV.VEC: {
      if (!isPresentO(decoded.subarray(offset))) return XDR_DISCRIMINANT_BYTES + XDR_DISCRIMINANT_BYTES;
      const { length } = scanVec(decoded, offset);
      return length;
    }
    case SCV.MAP: {
      if (!isPresentO(decoded.subarray(offset))) return XDR_DISCRIMINANT_BYTES * 2;
      const { length } = scanMap(decoded, offset);
      return length;
    }
    default:
      // Unknown or self-describing type: consume the rest of the buffer.
      return decoded.length - offset;
  }
}

function fixedPayloadWidth(typeTag: number): number {
  switch (typeTag) {
    case SCV.BOOL:
    case SCV.U32:
    case SCV.I32:
      return 4;
    case SCV.U64:
    case SCV.I64:
    case SCV.TIMEPOINT:
    case SCV.DURATION:
      return 8;
    case SCV.U128:
    case SCV.I128:
      return 16;
    case SCV.U256:
    case SCV.I256:
      return 32;
    default:
      return 0;
  }
}

/**
 * Byte offset of the element-count field of a `ScVec`/`ScMap` payload.
 *
 * `ScVec` is `VecO<ScVal>` and `ScMap` is `MapO<ScMapEntry>`, so the layout is
 * ScVal tag, then a presence discriminant, then the count.
 */
const XDR_O_CONTAINER_COUNT_OFFSET = XDR_DISCRIMINANT_BYTES * 3;

/**
 * Walk a `ScVec` and report the total encoded length plus the element offsets.
 */
function scanVec(
  decoded: Buffer,
  base: number
): { length: number; offsets: number[] } {
  const start = base + XDR_O_CONTAINER_COUNT_OFFSET;
  const count = decoded.readUInt32BE(base + XDR_PAYLOAD_OFFSET * 2);
  const offsets: number[] = [];

  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset >= decoded.length) break;
    offsets.push(offset);
    offset += scValEncodedLength(decoded, offset);
  }

  return { length: offset - base, offsets };
}

/**
 * Walk a `ScMap` and report the total encoded length plus the key/value offsets.
 */
function scanMap(
  decoded: Buffer,
  base: number
): { length: number; entries: { key: number; value: number }[] } {
  const start = base + XDR_O_CONTAINER_COUNT_OFFSET;
  const count = decoded.readUInt32BE(base + XDR_PAYLOAD_OFFSET * 2);
  const entries: { key: number; value: number }[] = [];

  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset >= decoded.length) break;
    const key = offset;
    offset += scValEncodedLength(decoded, key);
    if (offset >= decoded.length) break;
    const value = offset;
    offset += scValEncodedLength(decoded, value);
    entries.push({ key, value });
  }

  return { length: offset - base, entries };
}

function parseScVec(decoded: Buffer): unknown[] {
  if (!isPresentO(decoded)) return [];
  const { offsets } = scanVec(decoded, 0);
  return offsets.map((offset) => parseScVal(decoded.subarray(offset).toString('base64')));
}

function parseScMap(decoded: Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!isPresentO(decoded)) return result;

  const { entries } = scanMap(decoded, 0);
  for (const { key, value } of entries) {
    const keyName = parseScVal(decoded.subarray(key).toString('base64')) as string;
    if (typeof keyName !== 'string') continue;
    result[keyName] = parseScVal(decoded.subarray(value).toString('base64'));
  }
  return result;
}

/**
 * Parse a `ScAddress` out of an ScVal buffer and return its Stellar strkey.
 *
 * XDR layout (every enum discriminant is 4 bytes, big-endian):
 *   [0..4)   ScVal discriminant         — SCV_ADDRESS (18)
 *   [4..8)   ScAddressType discriminant — 0 = account, 1 = contract
 *   [8..12)  PublicKey discriminant     — accounts only; an ed25519 `AccountID`
 *            is itself a `PublicKey` union, so account addresses carry one extra
 *            discriminant that contract addresses (a bare `Hash`) do not.
 *   [12..)   32-byte ed25519 key (accounts) or 32-byte contract hash
 *
 * @param decoded - Buffer positioned at the ScVal discriminant.
 * @returns `G...` for account addresses, `C...` for contract addresses.
 */
function parseScAddress(decoded: Buffer): string {
  const typeOffset = XDR_PAYLOAD_OFFSET;
  if (decoded.length < typeOffset + XDR_DISCRIMINANT_BYTES) return '';

  const addressType = decoded.readInt32BE(typeOffset);
  const payloadOffset =
    typeOffset +
    XDR_DISCRIMINANT_BYTES +
    (addressType === SC_ADDRESS_TYPE.ACCOUNT ? XDR_DISCRIMINANT_BYTES : 0);

  if (decoded.length < payloadOffset + STRKEY_PAYLOAD_BYTES) return '';

  const payload = decoded.subarray(payloadOffset, payloadOffset + STRKEY_PAYLOAD_BYTES);

  if (addressType === SC_ADDRESS_TYPE.CONTRACT) {
    return encodeScContractAddress(payload);
  }

  return encodeEd25519PublicKey(payload);
}

// ---------------------------------------------------------------------------
// Contract Read Functions
// ---------------------------------------------------------------------------

/**
 * Convert raw Soroban pool data to the Pool type used by the UI.
 */
function normalizePool(raw: RawSorobanPool | null, poolId: number): Pool | null {
  if (!raw) return null;

  const toNumber = (v: bigint | number | string | undefined): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    return v || 0;
  };

  // Handle winning_outcome which can be Option<u32>
  let winningOutcome: number | undefined;
  if (raw.winning_outcome !== undefined && raw.winning_outcome !== null) {
    winningOutcome = typeof raw.winning_outcome === 'number'
      ? raw.winning_outcome
      : Number(raw.winning_outcome);
  }

  // Handle settled status - could be boolean or derived from status enum
  let settled = raw.settled ?? false;
  let status: Pool['status'] = settled ? 'settled' : 'active';

  // Parse status enum if provided
  if (raw.status) {
    if (typeof raw.status === 'string') {
      if (raw.status === 'Settled' || raw.status === 'settled') {
        settled = true;
        status = 'settled';
      } else if (raw.status === 'Open' || raw.status === 'open') {
        settled = false;
        status = 'active';
      } else if (raw.status === 'Voided' || raw.status === 'Cancelled') {
        settled = true;
        status = 'settled';
      } else if (raw.status === 'Frozen' || raw.status === 'frozen') {
        settled = false;
        status = 'frozen';
      } else if (raw.status === 'Disputed' || raw.status === 'disputed') {
        settled = true;
        status = 'disputed';
      }
    } else if (typeof raw.status === 'object' && 'tag' in raw.status) {
      const tag = raw.status.tag;
      if (tag === 'Settled') {
        settled = true;
        status = 'settled';
      } else if (tag === 'Open') {
        settled = false;
        status = 'active';
      } else if (tag === 'Frozen') {
        settled = false;
        status = 'frozen';
      } else if (tag === 'Disputed') {
        settled = true;
        status = 'disputed';
      } else if (tag === 'Voided' || tag === 'Cancelled') {
        // These are terminal states - treat as settled for UI purposes
        settled = true;
        status = 'settled';
      }
    }
  }

  return {
    id: poolId,
    title: raw.title ?? '',
    description: raw.description ?? '',
    creator: raw.creator ?? '',
    outcomeA: raw.outcome_a_name ?? '',
    outcomeB: raw.outcome_b_name ?? '',
    totalA: toNumber(raw.total_a),
    totalB: toNumber(raw.total_b),
    settled,
    winningOutcome,
    expiry: toNumber(raw.expiry),
    status,
    participant_count: raw.participant_count ?? 0,
  };
}

/**
 * Convert raw Soroban user bet data to the UserBetData type.
 */
function normalizeUserBet(raw: RawSorobanUserBet | null): UserBetData | null {
  if (!raw) return null;

  const toNumber = (v: bigint | number | string | undefined): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    return v || 0;
  };

  return {
    amountA: toNumber(raw.amount_a),
    amountB: toNumber(raw.amount_b),
    totalBet: toNumber(raw.total_bet),
  };
}

/**
 * Reads a single pool from the Soroban contract via `get_pool`.
 *
 * @param poolId - Numeric pool identifier (1-based in the Predinex contract).
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns {@link PoolReadResult} with normalized pool data or an error message.
 *
 * @example
 * ```ts
 * const { pool, error } = await getPoolFromSoroban(1);
 * if (pool) console.log(pool.title);
 * ```
 */
export async function getPoolFromSoroban(
  poolId: number,
  config?: SorobanReadConfig
): Promise<PoolReadResult> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return { pool: null, error: 'Soroban contract ID not configured' };
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_pool',
      [poolId]
    );

    if (rawResult === null) {
      // Pool doesn't exist
      return { pool: null };
    }

    // Parse the result based on its structure
    let rawPool: RawSorobanPool | null = null;

    if (typeof rawResult === 'object' && rawResult !== null) {
      if (Array.isArray(rawResult)) {
        // Option<Pool> - if Some, it's wrapped
        if (rawResult.length === 0) {
          return { pool: null }; // None
        }
        rawPool = rawResult[0] as RawSorobanPool;
      } else {
        rawPool = rawResult as RawSorobanPool;
      }
    }

    const pool = normalizePool(rawPool, poolId);
    return { pool };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error(`Failed to fetch pool ${poolId} from Soroban:`, error);
    return { pool: null, error };
  }
}

/**
 * Reads a contiguous range of pools in one RPC call via `get_pools_batch`.
 *
 * Reduces round-trips from N individual reads to a single batch simulation.
 *
 * @param startId - First pool ID in the range (inclusive).
 * @param count - Number of consecutive pools to fetch.
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns Array of normalized pools; shorter than `count` when some slots are empty.
 *
 * @example
 * ```ts
 * const total = await getPoolCountFromSoroban();
 * const pools = await getPoolsBatchFromSoroban(1, total);
 * ```
 */
export async function getPoolsBatchFromSoroban(
  startId: number,
  count: number,
  config?: SorobanReadConfig
): Promise<Pool[]> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return [];
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_pools_batch',
      [startId, count]
    );

    if (!rawResult || !Array.isArray(rawResult)) {
      return [];
    }

    const pools: Pool[] = [];
    for (let i = 0; i < rawResult.length; i++) {
      const rawPool = rawResult[i] as RawSorobanPool | null;
      if (rawPool) {
        const pool = normalizePool(rawPool, startId + i);
        if (pool) {
          pools.push(pool);
        }
      }
    }
    return pools;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error(`Failed to fetch pools batch (start: ${startId}, count: ${count}):`, error);
    throw e;
  }
}

/**
 * Reads a user's stake for a pool via `get_user_bet`.
 *
 * @param poolId - Numeric pool identifier.
 * @param userAddress - Stellar account address (`G...` strkey).
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns {@link UserBetReadResult} with per-outcome amounts or an error message.
 */
export async function getUserBetFromSoroban(
  poolId: number,
  userAddress: string,
  config?: SorobanReadConfig
): Promise<UserBetReadResult> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return { bet: null, error: 'Soroban contract ID not configured' };
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_user_bet',
      [poolId, userAddress]
    );

    if (rawResult === null) {
      return { bet: null };
    }

    let rawBet: RawSorobanUserBet | null = null;

    if (typeof rawResult === 'object' && rawResult !== null) {
      if (Array.isArray(rawResult)) {
        if (rawResult.length === 0) {
          return { bet: null }; // None
        }
        rawBet = rawResult[0] as RawSorobanUserBet;
      } else {
        rawBet = rawResult as RawSorobanUserBet;
      }
    }

    const bet = normalizeUserBet(rawBet);
    return { bet };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error(`Failed to fetch user bet for pool ${poolId} from Soroban:`, error);
    return { bet: null, error };
  }
}

/**
 * Reads per-pool bet limits via `get_pool_bet_limits`.
 *
 * @param poolId - Numeric pool identifier.
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns Min/max bet limits, or `null` when the pool is missing or the read fails.
 */
export async function getPoolBetLimitsFromSoroban(
  poolId: number,
  config?: SorobanReadConfig
): Promise<PoolBetLimits | null> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return null;
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_pool_bet_limits',
      [poolId]
    );

    if (rawResult === null) {
      return null;
    }

    let rawLimits: RawSorobanBetLimits | null = null;

    if (typeof rawResult === 'object' && rawResult !== null) {
      if (Array.isArray(rawResult)) {
        // Option<PoolBetLimits> style: Some(value) => [value], None => []
        if (rawResult.length === 0) return null;
        rawLimits = rawResult[0] as RawSorobanBetLimits;
      } else {
        rawLimits = rawResult as RawSorobanBetLimits;
      }
    }

    const toNumber = (v: bigint | number | string | undefined): number => {
      if (v === undefined || v === null) return 0;
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'string') return Number(v) || 0;
      return v || 0;
    };

    return {
      minBet: toNumber(rawLimits?.min_bet),
      maxBet: toNumber(rawLimits?.max_bet),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error(`Failed to fetch pool bet limits for pool ${poolId} from Soroban:`, error);
    throw e;
  }
}

/**
 * Reads the total number of pools via `get_pool_count`.
 *
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns Total pool count, or `0` when unconfigured or on RPC failure.
 */
export async function getPoolCountFromSoroban(
  config?: SorobanReadConfig
): Promise<number> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return 0;
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_pool_count',
      []
    );

    if (typeof rawResult === 'number') {
      return rawResult;
    }

    if (typeof rawResult === 'bigint') {
      return Number(rawResult);
    }

    return 0;
  } catch (e) {
    log.error('Failed to fetch pool count from Soroban:', e);
    throw e;
  }
}

/**
 * Reads the freeze admin address via `get_freeze_admin`.
 *
 * @param config - Optional RPC/contract override; defaults to `getRuntimeConfig().soroban`.
 * @returns Freeze admin address string (`G...`), or null if not set or on RPC failure.
 */
export async function getFreezeAdminFromSoroban(
  config?: SorobanReadConfig
): Promise<string | null> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return null;
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_freeze_admin',
      []
    );

    if (rawResult === null) {
      return null;
    }

    // rawResult could be an array if it's an Option<Address>
    let addressVal: unknown = rawResult;
    if (Array.isArray(rawResult)) {
      if (rawResult.length === 0) return null;
      addressVal = rawResult[0];
    }

    if (typeof addressVal === 'string' && addressVal.startsWith('G')) {
      return addressVal;
    }

    return null;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error('Failed to fetch freeze admin from Soroban:', error);
    throw e;
  }
}

export async function getAdminFromSoroban(
  config?: SorobanReadConfig
): Promise<string | null> {
  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      return null;
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_admin',
      []
    );

    if (rawResult === null) {
      return null;
    }

    let addressVal: unknown = rawResult;
    if (Array.isArray(rawResult)) {
      if (rawResult.length === 0) return null;
      addressVal = rawResult[0];
    }

    if (typeof addressVal === 'string' && addressVal.startsWith('G')) {
      return addressVal;
    }

    return null;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.error('Failed to fetch admin from Soroban:', error);
    throw e;
  }
}

/**
 * Get Soroban configuration from runtime config.
 */
function getSorobanConfig(): SorobanReadConfig {
  const cfg = getRuntimeConfig();
  return {
    rpcUrl: cfg.soroban.rpcUrl,
    contractId: cfg.soroban.contractId,
  };
}

// ---------------------------------------------------------------------------
// LP Read Functions
// ---------------------------------------------------------------------------

export interface LpPositionData {
  shares: number;
  rewardDebt: number;
}

export async function getLpPositionFromSoroban(
  poolId: number,
  userAddress: string,
  config?: SorobanReadConfig,
): Promise<LpPositionData | null> {
  const toNum = (v: bigint | number | string | undefined): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    return v;
  };
  try {
    const cfg = config ?? getSorobanConfig();
    if (!cfg.contractId) return null;

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_lp_position',
      [poolId, userAddress],
    );

    if (rawResult === null || typeof rawResult !== 'object') return null;
    const raw = rawResult as Record<string, unknown>;
    return {
      shares: toNum(raw.shares ?? raw[0]),
      rewardDebt: toNum(raw.reward_debt ?? raw[1]),
    };
  } catch (e) {
    log.error(`Failed to fetch LP position for pool ${poolId}:`, e);
    throw e;
  }
}

export async function getPendingLpRewardsFromSoroban(
  poolId: number,
  userAddress: string,
  config?: SorobanReadConfig,
): Promise<number> {
  const toNum = (v: bigint | number | string | undefined): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    return v;
  };
  try {
    const cfg = config ?? getSorobanConfig();
    if (!cfg.contractId) return 0;

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_pending_lp_rewards',
      [poolId, userAddress],
    );

    return toNum(rawResult as bigint | number | string | undefined);
  } catch (e) {
    log.error(`Failed to fetch pending LP rewards for pool ${poolId}:`, e);
    throw e;
  }
}

export async function getLpStakeFromSoroban(
  poolId: number,
  userAddress: string,
  config?: SorobanReadConfig,
): Promise<{ shares: number; lockUntil: number } | null> {
  const toNum = (v: bigint | number | string | undefined): number => {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    return v;
  };
  try {
    const cfg = config ?? getSorobanConfig();
    if (!cfg.contractId) return null;

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_lp_stake',
      [poolId, userAddress],
    );

    if (rawResult === null) return null;
    if (typeof rawResult !== 'object') return null;
    const raw = rawResult as Record<string, unknown>;
    return {
      shares: toNum(raw.shares),
      lockUntil: toNum(raw.lock_until),
    };
  } catch (e) {
    log.error(`Failed to fetch LP stake for pool ${poolId}:`, e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Claim-state enum mirrored from the contract's `ClaimStatus`.
 */
export type ClaimStatus =
  | 'NeverBet'
  | 'Claimable'
  | 'RefundClaimable'
  | 'NotEligible'
  | 'AlreadyClaimed';

/**
 * #1056 — Per-pool snapshot returned by `getUserPortfolioFromSoroban`.
 * Combines bet position, LP stake, pending rewards, and claim status so
 * dashboard screens need only a single batched call.
 */
export interface UserPoolSnapshot {
  /** Pool identifier. */
  poolId: number;
  /** User's stake on outcome A (raw stroops). */
  amountA: number;
  /** User's stake on outcome B (raw stroops). */
  amountB: number;
  /** Total stake (amountA + amountB). */
  totalBet: number;
  /** LP shares held by the user; 0 if none. */
  lpShares: number;
  /** Accrued but unclaimed LP rewards in raw token units. */
  pendingRewards: number;
  /** Whether the user can claim winnings or a refund. */
  claimStatus: ClaimStatus;
}

/**
 * #1056 — Batched portfolio query.
 *
 * Calls the contract's `get_user_portfolio` function which returns one
 * `UserPoolSnapshot` per pool where the user has a bet position or LP stake.
 * Falls back to an empty result when the contract ID is not configured.
 *
 * @param userAddress - Stellar account address (`G...` strkey).
 * @param startId - First pool ID to scan (inclusive, defaults to 1).
 * @param count - Maximum pools to scan (capped server-side at 50).
 * @param config - Optional RPC/contract override.
 * @returns Array of snapshots for pools where the user has activity.
 */
export async function getUserPortfolioFromSoroban(
  userAddress: string,
  startId = 1,
  count = 50,
  config?: SorobanReadConfig,
): Promise<UserPoolSnapshot[]> {
  const toNum = (v: unknown): number => {
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') return Number(v) || 0;
    if (typeof v === 'number') return v;
    return 0;
  };

  const normalizeClaimStatus = (raw: unknown): ClaimStatus => {
    // Contract returns an enum tag, e.g. { tag: 'Claimable' } or the string itself.
    if (typeof raw === 'string') {
      const valid: ClaimStatus[] = [
        'NeverBet', 'Claimable', 'RefundClaimable', 'NotEligible', 'AlreadyClaimed',
      ];
      if (valid.includes(raw as ClaimStatus)) return raw as ClaimStatus;
    }
    if (typeof raw === 'object' && raw !== null) {
      const tag = (raw as Record<string, unknown>).tag;
      if (typeof tag === 'string') return normalizeClaimStatus(tag);
    }
    return 'NeverBet';
  };

  try {
    const cfg = config ?? getSorobanConfig();

    if (!cfg.contractId) {
      // Contract not configured — return empty rather than fanning out.
      return [];
    }

    const rawResult = await simulateContractRead(
      cfg.rpcUrl,
      cfg.contractId,
      'get_user_portfolio',
      [userAddress, startId, count],
    );

    if (!rawResult || !Array.isArray(rawResult)) {
      return [];
    }

    return (rawResult as Record<string, unknown>[]).map((item) => ({
      poolId: toNum(item.pool_id),
      amountA: toNum(item.amount_a),
      amountB: toNum(item.amount_b),
      totalBet: toNum(item.total_bet),
      lpShares: toNum(item.lp_shares),
      pendingRewards: toNum(item.pending_rewards),
      claimStatus: normalizeClaimStatus(item.claim_status),
    }));
  } catch (e) {
    log.error('Failed to fetch user portfolio from Soroban:', e);
    throw e;
  }
}

/**
 * Canonical Soroban read API object for pool and user-bet data.
 *
 * Prefer this namespace (or the named exports) over deprecated Stacks reads in `stacks-api.ts`.
 *
 * @example
 * ```ts
 * const count = await sorobanReadApi.getPoolCount();
 * const { pool } = await sorobanReadApi.getPool(1);
 * ```
 */
export const sorobanReadApi = {
  getPool: getPoolFromSoroban,
  getUserBet: getUserBetFromSoroban,
  getPoolBetLimits: getPoolBetLimitsFromSoroban,
  getPoolCount: getPoolCountFromSoroban,
  getPoolsBatch: getPoolsBatchFromSoroban,
  getLpPosition: getLpPositionFromSoroban,
  getPendingLpRewards: getPendingLpRewardsFromSoroban,
  getLpStake: getLpStakeFromSoroban,
  /** #1056 — Batched portfolio query (replaces N fan-out reads). */
  getUserPortfolio: getUserPortfolioFromSoroban,
};

/** Shared pool and bet types used by both legacy Stacks and Soroban read layers. */
export type { Pool, UserBetData };

// ---------------------------------------------------------------------------
// getMarkets — delegates to Soroban read layer
// ---------------------------------------------------------------------------

/**
 * Lists pools with optional settlement filtering.
 * Internally delegates to Soroban batch reads.
 *
 * @param filter - Which pools to include: 'active', 'settled', or 'all' (default 'all').
 * @returns Array of matching pools; empty when count is unavailable or no pools match.
 */
export async function getMarkets(filter: 'active' | 'settled' | 'all' = 'all'): Promise<Pool[]> {
  const count = await getPoolCountFromSoroban();
  if (count === 0) return [];

  const rawPools = await getPoolsBatchFromSoroban(1, count);
  const pools: Pool[] = [];

  for (const pool of rawPools) {
    if (pool) {
      if (filter === 'active' && pool.settled) continue;
      if (filter === 'settled' && !pool.settled) continue;
      pools.push(pool);
    }
  }
  return pools;
}

/**
 * Computes total volume across all pools by summing totalA + totalB.
 * Replaces the deprecated Stacks-only getTotalVolume from stacks-api.ts.
 */
export async function getTotalVolume(): Promise<number> {
  const count = await getPoolCountFromSoroban();
  if (count === 0) return 0;
  const pools = await getPoolsBatchFromSoroban(1, count);
  return pools.reduce((sum, p) => sum + (p?.totalA ?? 0) + (p?.totalB ?? 0), 0);
}

// ---------------------------------------------------------------------------
// #721 — Extended pool metadata
// ---------------------------------------------------------------------------

/** Decoded extended pool metadata from `get_pool_ext_metadata`. */
export interface PoolExtendedMetadata {
  resolutionCriteria?: string;
  externalLinks?: string;
  coverImage?: string;
}

/**
 * Read optional extended metadata for a pool via `get_pool_ext_metadata`.
 * Returns null when no metadata is stored or the read fails.
 */
export async function getPoolExtMetadataFromSoroban(
  poolId: number,
  config?: SorobanReadConfig,
): Promise<PoolExtendedMetadata | null> {
  const cfg = config ?? getSorobanConfig();
  if (!cfg.contractId) return null;
  try {
    const rawResult = await simulateContractRead(cfg.rpcUrl, cfg.contractId, 'get_pool_ext_metadata', [poolId]);
    if (rawResult === null || typeof rawResult !== 'object') return null;
    const raw = rawResult as Record<string, unknown>;
    return {
      resolutionCriteria: typeof raw['resolution_criteria'] === 'string' ? raw['resolution_criteria'] : undefined,
      externalLinks: typeof raw['external_links'] === 'string' ? raw['external_links'] : undefined,
      coverImage: typeof raw['cover_image'] === 'string' ? raw['cover_image'] : undefined,
    };
  } catch (e) {
    log.error('Failed to fetch pool ext metadata from Soroban:', e);
    throw e;
  }
}
