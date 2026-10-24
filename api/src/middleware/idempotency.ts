import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/** Request header carrying the caller-supplied idempotency key (#1466). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Response header set to `true` when a stored result was replayed. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';

const MAX_KEY_LENGTH = 255;
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

interface StoredResult {
  payloadHash: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

/**
 * In-memory store of idempotency keys scoped per caller. Entries expire after
 * a TTL window; the map is bounded and prunes expired entries on access.
 */
export class IdempotencyStore {
  private entries = new Map<string, StoredResult>();
  private inFlight = new Set<string>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES
  ) {}

  private prune(now: number = Date.now()): void {
    for (const [composite, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(composite);
      }
    }
  }

  private composite(caller: string, key: string): string {
    return `${caller}\n${key}`;
  }

  /** Returns the stored result for a key, or `undefined` when unknown/expired. */
  get(caller: string, key: string): StoredResult | undefined {
    this.prune();
    return this.entries.get(this.composite(caller, key));
  }

  /**
   * Claim a key for processing. Returns:
   * - `started` when the key was free (or expired) and is now in flight;
   * - `in-flight` when an identical request is still being processed;
   * - `conflict` when the key was used with a different payload, or a
   *   completed result is already stored (callers should replay instead).
   */
  begin(caller: string, key: string, payloadHash: string): 'started' | 'in-flight' | 'conflict' {
    this.prune();
    const composite = this.composite(caller, key);
    if (this.inFlight.has(composite)) {
      return 'in-flight';
    }
    if (this.entries.has(composite)) {
      // A completed result exists; the middleware replays it via `get`.
      return 'conflict';
    }
    if (this.entries.size >= this.maxEntries) {
      // Bounded store: drop the oldest entry to make room.
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.inFlight.add(composite);
    return 'started';
  }

  /** Record the completed response for a key and release the in-flight claim. */
  complete(caller: string, key: string, payloadHash: string, status: number, body: unknown): void {
    const composite = this.composite(caller, key);
    this.inFlight.delete(composite);
    this.prune();
    this.entries.set(composite, {
      payloadHash,
      status,
      body,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Release the in-flight claim without storing a result (failed requests). */
  release(caller: string, key: string): void {
    this.inFlight.delete(this.composite(caller, key));
  }

  /** Drop every stored and in-flight entry (test helper). */
  reset(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

/** Default shared store used by routers created without an explicit store. */
export const sharedIdempotencyStore = new IdempotencyStore();

/**
 * Deterministic JSON with recursively sorted object keys, so semantically
 * equal payloads hash identically regardless of key order.
 */
export function canonicalizePayload(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizePayload(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizePayload(record[key])}`)
    .join(',')}}`;
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(canonicalizePayload(value)).digest('hex');
}

/** Caller identity for key scoping: hashed `x-api-key` when present, else IP. */
export function idempotencyCallerId(req: Request): string {
  const apiKey = req.headers?.['x-api-key'];
  const key = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  if (key) {
    // Hash so raw keys never sit in memory or in debug dumps (mirrors rate-limit.ts).
    return `token:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
  }
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function readKeyHeader(req: Request): string | undefined {
  const raw = req.headers[IDEMPOTENCY_KEY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface IdempotencyMiddlewareOptions {
  store?: IdempotencyStore;
  maxKeyLength?: number;
}

/**
 * Optional `Idempotency-Key` middleware for state-changing submission
 * endpoints (#1466).
 *
 * - Requests without the header pass through unchanged.
 * - The first request with a key runs normally; its completed response (any
 *   status below 500) is stored keyed by `key + caller` for the TTL window.
 * - Retries with the same key and payload replay the stored response and set
 *   `Idempotency-Replayed: true`.
 * - Reusing a key with a different payload is rejected with 409
 *   `IDEMPOTENCY_KEY_CONFLICT`; a concurrent duplicate is rejected with 409
 *   `IDEMPOTENCY_REQUEST_IN_PROGRESS`.
 * - 5xx responses release the key so the caller may safely retry.
 */
export function createIdempotencyMiddleware(options: IdempotencyMiddlewareOptions = {}) {
  const store = options.store ?? sharedIdempotencyStore;
  const maxKeyLength = options.maxKeyLength ?? MAX_KEY_LENGTH;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = readKeyHeader(req);
    if (!key) {
      next();
      return;
    }

    if (key.length > maxKeyLength) {
      res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_INVALID',
          message: `Idempotency-Key must be at most ${maxKeyLength} characters`,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const caller = idempotencyCallerId(req);
    const payloadHash = hashPayload(req.body);

    const stored = store.get(caller, key);
    if (stored) {
      if (stored.payloadHash !== payloadHash) {
        res.status(409).json({
          success: false,
          error: {
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'This Idempotency-Key was already used with a different payload',
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
      res.status(stored.status).json(stored.body);
      return;
    }

    const claim = store.begin(caller, key, payloadHash);
    if (claim === 'in-flight') {
      res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
          message: 'A request with this Idempotency-Key is still being processed',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (claim === 'conflict') {
      // Stored result with a different payload (raced past `get`).
      res.status(409).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'This Idempotency-Key was already used with a different payload',
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Capture the handler's response to store it once the handler finishes.
    const originalJson = res.json.bind(res);
    let settled = false;
    res.json = ((body: unknown) => {
      if (settled) {
        return originalJson(body);
      }
      settled = true;
      const status = res.statusCode;
      if (status >= 500) {
        // Transient server failure: do not burn the key.
        store.release(caller, key);
      } else {
        store.complete(caller, key, payloadHash, status, body);
      }
      return originalJson(body);
    }) as Response['json'];

    // If the handler fails without responding, release the claim so the key
    // is not stuck in flight (app-level error handlers respond via res.json,
    // but a hard crash should not poison the key either).
    res.on('close', () => {
      if (!settled) {
        settled = true;
        store.release(caller, key);
      }
    });

    next();
  };
}
