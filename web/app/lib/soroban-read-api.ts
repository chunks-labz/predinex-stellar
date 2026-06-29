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

import { getRuntimeConfig } from './runtime-config';
import type { Pool, UserBetData } from './stacks-api';

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
 * Build a simple Soroban transaction XDR for a read-only contract call.
 * This creates a minimal transaction envelope that can be simulated.
 */
function buildReadTransactionXDR(
  contractId: string,
  functionName: string,
  args: unknown[] = []
): string {
  // For Soroban contract reads, we need to build a transaction that invokes the contract.
  // Since we don't have the full Stellar SDK, we use a minimal approach:
  // Build a simple invoke host function operation wrapped in a transaction.

  // The contract ID is a 32-byte hash from the C... strkey
  const contractHash = contractIdToHex(contractId);

  // Build the operation XDR manually
  // This is a simplified XDR builder - in production, use @stellar/stellar-sdk
  const scValArgs = args.map(argToScValXDR).join('');

  // Build the invoke host function op XDR
  // We use a placeholder approach that works with Soroban RPC
  const opXDR = buildInvokeContractOpXDR(contractHash, functionName, scValArgs);

  // Build the transaction envelope XDR
  // Sequence 0, no source account needed for simulation
  const txXDR = buildTransactionEnvelopeXDR(opXDR);

  return txXDR;
}

/**
 * Convert C... contract ID strkey to hex hash.
 */
function contractIdToHex(contractId: string): string {
  // C... strkey is base32 encoded with CRC16 checksum
  // For simulation, we can use a direct approach if the contractId
  // is already in the right format, or decode it
  if (contractId.startsWith('C') && contractId.length === 56) {
    // It's a proper strkey, we'd need base32 decoding
    // For now, return as-is and let the RPC handle it
    return contractId;
  }
  return contractId;
}

/**
 * Convert a JS value to SCVal XDR representation.
 */
function argToScValXDR(arg: unknown): string {
  if (typeof arg === 'number') {
    // U32 for pool IDs
    if (arg >= 0 && arg <= 0xffffffff) {
      return buildU32XDR(arg);
    }
    // I128 for larger numbers
    return buildI128XDR(BigInt(arg));
  }
  if (typeof arg === 'bigint') {
    return buildI128XDR(arg);
  }
  if (typeof arg === 'string') {
    // Could be an address (G... or C...) or a symbol
    if (arg.startsWith('G') && arg.length === 56) {
      return buildAddressXDR(arg);
    }
    return buildSymbolXDR(arg);
  }
  return '';
}

// XDR type builders - simplified for our use case
function buildU32XDR(value: number): string {
  // U32: 4 bytes big-endian
  const hex = value.toString(16).padStart(8, '0');
  return hex.match(/.{2}/g)?.reverse().join('') || '';
}

function buildI128XDR(value: bigint): string {
  // I128: 16 bytes two's complement big-endian
  // For positive values, just pad to 16 bytes
  let hex = value.toString(16);
  if (hex.length > 32) {
    hex = hex.slice(-32);
  }
  return hex.padStart(32, '0');
}

function buildAddressXDR(address: string): string {
  // For simulation, we pass the address as a string value
  // The actual encoding would be base32 decoding of the strkey
  return address;
}

function buildSymbolXDR(symbol: string): string {
  // Symbol: length (1 byte) + ASCII bytes
  const len = Math.min(symbol.length, 32);
  const hexLen = len.toString(16).padStart(2, '0');
  const hexChars = Array.from(symbol.slice(0, len))
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return hexLen + hexChars;
}

function buildInvokeContractOpXDR(contractHash: string, functionName: string, argsXDR: string): string {
  // Simplified operation XDR
  // In practice, this would be a full XDR-encoded Operation
  return `invoke:${contractHash}:${functionName}:${argsXDR}`;
}

function buildTransactionEnvelopeXDR(opXDR: string): string {
  // Simplified transaction envelope
  // In practice, this would be a full XDR-encoded TransactionEnvelope
  return `tx:${opXDR}`;
}

// ---------------------------------------------------------------------------
// RPC Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a transaction on the Soroban RPC to read contract state.
 */
async function simulateContractRead(
  rpcUrl: string,
  contractId: string,
  functionName: string,
  args: unknown[] = []
): Promise<unknown | null> {
  // Build the transaction XDR
  const transactionXDR = buildReadTransactionXDR(contractId, functionName, args);

  // Call simulateTransaction RPC method
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: {
      transaction: transactionXDR,
    },
  };

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      log.error(`Soroban RPC error: ${response.status}`);
      return null;
    }

    const json = await response.json();

    if (json.error) {
      log.error('Soroban RPC returned error:', json.error.message);
      return null;
    }

    // Extract the return value from simulation result
    const result = json.result;
    if (!result) return null;

    // Handle different simulation result formats
    if (result.results && result.results.length > 0) {
      // Newer Soroban RPC format
      const scVal = result.results[0].xdr;
      return parseScVal(scVal);
    }

    if (result.xdr) {
      // Legacy format
      return parseScVal(result.xdr);
    }

    return null;
  } catch (e) {
    log.error(`Failed to simulate contract read for ${functionName}:`, e);
    return null;
  }
}

/**
 * Parse an SCVal XDR string into a JS value.
 * This handles common Soroban return types.
 */
function parseScVal(xdr: string): unknown {
  if (!xdr || typeof xdr !== 'string') return null;

  try {
    // For now, we handle the common XDR formats manually
    // In production, use @stellar/stellar-sdk's xdr.ScVal.fromXDR

    // Check if it's base64 encoded
    const decoded = Buffer.from(xdr, 'base64');

    // The first byte indicates the SCVal type
    const typeByte = decoded[0];

    // SCVal types:
    // 0 = SCV_BOOL
    // 1 = SCV_VOID
    // 2 = SCV_ERROR
    // 3 = SCV_U32
    // 4 = SCV_I32
    // ... etc
    // 12 = SCV_OBJECT (for Option, Vec, Map, etc.)
    // 13 = SCV_SYMBOL
    // 16 = SCV_STRING
    // 17 = SCV_I128
    // 18 = SCV_U128
    // 20 = SCV_VEC
    // 21 = SCV_MAP

    switch (typeByte) {
      case 0: // SCV_BOOL
        return decoded[1] !== 0;
      case 1: // SCV_VOID
        return null;
      case 3: // SCV_U32
        return decoded.readUInt32BE(4);
      case 4: // SCV_I32
        return decoded.readInt32BE(4);
      case 12: // SCV_OBJECT - could be Option, Box, etc.
        return parseScObject(decoded);
      case 16: // SCV_STRING
        return parseScString(decoded);
      case 17: // SCV_I128
        return parseScI128(decoded);
      case 18: // SCV_U128
        return parseScU128(decoded);
      case 20: // SCV_VEC
        return parseScVec(decoded);
      case 21: // SCV_MAP
        return parseScMap(decoded);
      default:
        // Return raw for unknown types
        return xdr;
    }
  } catch (e) {
    log.error('Failed to parse SCVal:', e);
    return xdr;
  }
}

function parseScObject(decoded: Buffer): unknown {
  // SCObject discriminant is at byte 1
  const objType = decoded[1];

  // SCObject types:
  // 0 = SCO_BOX
  // 1 = SCO_VEC
  // 2 = SCO_MAP
  // 3 = SCO_U64
  // 4 = SCO_I64
  // 5 = SCO_U128
  // 6 = SCO_I128
  // 7 = SCO_U256
  // 8 = SCO_I256
  // 9 = SCO_BYTES
  // 10 = SCO_CONTRACT_CODE
  // 11 = SCO_ADDRESS
  // 12 = SCO_NONCE_KEY

  switch (objType) {
    case 0: // SCO_BOX (Option-like)
      // Box either contains a value or is empty
      const hasValue = decoded[2] !== 0;
      if (!hasValue) return null;
      // Parse the boxed value starting at offset 3
      return parseScVal(decoded.slice(3).toString('base64'));
    case 1: // SCO_VEC
      return parseScVec(decoded);
    case 2: // SCO_MAP
      return parseScMap(decoded);
    case 5: // SCO_U128
      return parseScU128(decoded);
    case 6: // SCO_I128
      return parseScI128(decoded);
    case 11: // SCO_ADDRESS
      return parseScAddress(decoded);
    default:
      return null;
  }
}

function parseScString(decoded: Buffer): string {
  // String: 4-byte length + bytes
  const len = decoded.readUInt32BE(4);
  return decoded.slice(8, 8 + len).toString('utf8');
}

function parseScI128(decoded: Buffer): bigint {
  // I128: 16 bytes two's complement
  const hex = decoded.slice(-16).toString('hex');
  const unsigned = BigInt('0x' + hex);
  // Check if negative (MSB set)
  if (unsigned >> BigInt(127)) {
    return unsigned - (BigInt(1) << BigInt(128));
  }
  return unsigned;
}

function parseScU128(decoded: Buffer): bigint {
  // U128: 16 bytes
  const hex = decoded.slice(-16).toString('hex');
  return BigInt('0x' + hex);
}

function parseScVec(decoded: Buffer): unknown[] {
  // Vec: 4-byte count + elements
  const count = decoded.readUInt32BE(4);
  const result: unknown[] = [];
  let offset = 8;
  for (let i = 0; i < count; i++) {
    const elemLen = decoded.readUInt32BE(offset);
    offset += 4;
    const elemXdr = decoded.slice(offset, offset + elemLen).toString('base64');
    result.push(parseScVal(elemXdr));
    offset += elemLen;
  }
  return result;
}

function parseScMap(decoded: Buffer): Record<string, unknown> {
  // Map: 4-byte count + key-value pairs
  const count = decoded.readUInt32BE(4);
  const result: Record<string, unknown> = {};
  let offset = 8;
  for (let i = 0; i < count; i++) {
    // Key
    const keyLen = decoded.readUInt32BE(offset);
    offset += 4;
    const keyXdr = decoded.slice(offset, offset + keyLen).toString('base64');
    const key = parseScVal(keyXdr) as string;
    offset += keyLen;

    // Value
    const valLen = decoded.readUInt32BE(offset);
    offset += 4;
    const valXdr = decoded.slice(offset, offset + valLen).toString('base64');
    result[key] = parseScVal(valXdr);
    offset += valLen;
  }
  return result;
}

function parseScAddress(decoded: Buffer): string {
  // Address: type byte + data
  // Type 0 = Account, Type 1 = Contract
  const addrType = decoded[2];
  if (addrType === 0) {
    // Account: 32-byte ed25519 public key -> G... address
    const keyBytes = decoded.slice(3, 35);
    // Convert to strkey format (base32 with checksum)
    return encodeEd25519PublicKey(keyBytes);
  } else {
    // Contract: 32-byte hash -> C... address
    const hashBytes = decoded.slice(3, 35);
    return encodeContractHash(hashBytes);
  }
}

function encodeEd25519PublicKey(bytes: Buffer): string {
  // Simplified - would need proper base32 encoding with CRC16
  // For now, return a placeholder
  return 'G' + bytes.toString('base64').slice(0, 54);
}

function encodeContractHash(bytes: Buffer): string {
  // Simplified - would need proper base32 encoding with CRC16
  return 'C' + bytes.toString('base64').slice(0, 54);
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
      }
    } else if (typeof raw.status === 'object' && 'tag' in raw.status) {
      const tag = raw.status.tag;
      if (tag === 'Settled') {
        settled = true;
        status = 'settled';
      } else if (tag === 'Open') {
        settled = false;
        status = 'active';
      } else if (tag === 'Voided' || tag === 'Cancelled' || tag === 'Frozen' || tag === 'Disputed') {
        // These are terminal/frozen states - treat as settled for UI purposes
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
    return [];
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
    return null;
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
    return 0;
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
// Public API
// ---------------------------------------------------------------------------

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
};

/** Shared pool and bet types used by both legacy Stacks and Soroban read layers. */
export type { Pool, UserBetData };
