/**
 * Sliding-Window Rate Limiting Middleware.
 * Prevents denial-of-service and brute-force attacks on simulation & transaction endpoints.
 *
 * The `RateLimiter` class below is the counting primitive; the Express
 * wrappers at the bottom of this file apply it to HTTP routes (see #1196).
 * Previously the limiter was exported from the barrel but never mounted.
 */

import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface ClientTracker {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private clients = new Map<string, ClientTracker>();
  private windowMs: number;
  private maxRequests: number;
  private nextCleanupAt = 0;

  constructor(options?: Partial<RateLimitOptions>) {
    this.windowMs = options?.windowMs ?? 60_000; // 1 minute
    this.maxRequests = options?.maxRequests ?? 100; // 100 req/min
  }

  public checkLimit(clientId: string, now: number = Date.now()): {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetMs: number;
  } {
    this.removeExpiredClients(now);
    const existing = this.clients.get(clientId);

    if (!existing || now >= existing.resetTime) {
      const tracker: ClientTracker = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      this.clients.set(clientId, tracker);
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: this.maxRequests - 1,
        resetMs: this.windowMs,
      };
    }

    if (existing.count >= this.maxRequests) {
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetMs: Math.max(0, existing.resetTime - now),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: this.maxRequests - existing.count,
      resetMs: Math.max(0, existing.resetTime - now),
    };
  }

  /** Periodically remove idle buckets so expired clients do not accumulate. */
  private removeExpiredClients(now: number): void {
    if (now < this.nextCleanupAt) return;
    for (const [clientId, tracker] of this.clients) {
      if (now >= tracker.resetTime) this.clients.delete(clientId);
    }
    this.nextCleanupAt = now + this.windowMs;
  }

  public reset(clientId?: string): void {
    if (clientId) {
      this.clients.delete(clientId);
    } else {
      this.clients.clear();
    }
  }
}

// ============================================================================
// Configuration (Issue #1423)
// ============================================================================

export interface RateLimitEnvConfig {
  windowMs: number;
  maxRequests: number;
  strictMaxRequests: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitEnvConfig = {
  windowMs: 60_000,
  maxRequests: 100,
  strictMaxRequests: 20,
};

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

/**
 * Reads limits from the environment, falling back to the defaults for any
 * value that is missing or not a positive integer:
 *   RATE_LIMIT_WINDOW_MS        window length in milliseconds (default 60000)
 *   RATE_LIMIT_MAX_REQUESTS     general requests per window (default 100)
 *   RATE_LIMIT_STRICT_MAX_REQUESTS  mutating/emergency requests per window (default 20)
 */
export function loadRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitEnvConfig {
  return {
    windowMs: parsePositiveIntEnv(env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_CONFIG.windowMs),
    maxRequests: parsePositiveIntEnv(
      env.RATE_LIMIT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_CONFIG.maxRequests
    ),
    strictMaxRequests: parsePositiveIntEnv(
      env.RATE_LIMIT_STRICT_MAX_REQUESTS,
      DEFAULT_RATE_LIMIT_CONFIG.strictMaxRequests
    ),
  };
}

const rateLimitConfig = loadRateLimitConfig();

/** Shared limiter for general API traffic (RATE_LIMIT_MAX_REQUESTS per window). */
export const sharedRateLimiter = new RateLimiter({
  windowMs: rateLimitConfig.windowMs,
  maxRequests: rateLimitConfig.maxRequests,
});

/** Stricter limiter for state-changing / emergency endpoints. */
export const strictRateLimiter = new RateLimiter({
  windowMs: rateLimitConfig.windowMs,
  maxRequests: rateLimitConfig.strictMaxRequests,
});

/**
 * Returns true when an API key is a verified identity (registered with the
 * auth layer). Only verified keys get their own bucket; anything else would
 * let a caller mint fresh buckets by rotating arbitrary header values.
 */
export type TokenVerifier = (apiKey: string) => boolean;

export interface RateLimitMiddlewareOptions {
  isKnownToken?: TokenVerifier;
}

let defaultTokenVerifier: TokenVerifier | undefined;

/**
 * Install the verifier used by middleware created without an explicit
 * `isKnownToken`, including the shared `rateLimitMiddleware` exports that
 * routers mount. Pass `undefined` to fall back to per-IP buckets only.
 */
export function setDefaultTokenVerifier(verifier: TokenVerifier | undefined): void {
  defaultTokenVerifier = verifier;
}

function clientIdFor(req: Request, isKnownToken?: TokenVerifier): string {
  const rawKey = req.headers?.['x-api-key'];
  const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
  if (apiKey && isKnownToken?.(apiKey)) {
    // Hash so raw keys never sit in the limiter's memory or in debug dumps.
    return `token:${createHash('sha256').update(apiKey).digest('hex').slice(0, 32)}`;
  }
  // Request headers are supplied by the caller and are not verified identities.
  // Express only trusts proxy headers when the app explicitly configures trusted
  // proxy hops; with the default configuration req.ip resolves to the socket.
  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

/**
 * Create Express middleware backed by a `RateLimiter`.
 * Sets `RateLimit-*` headers and returns 429 with `Retry-After` when the
 * window is exhausted. Buckets are per registered API key when
 * `isKnownToken` recognises the caller's `x-api-key`, otherwise per IP.
 */
export function createRateLimitMiddleware(
  limiter?: RateLimiter,
  options: RateLimitMiddlewareOptions = {}
) {
  const active = limiter || sharedRateLimiter;
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = clientIdFor(req, options.isKnownToken ?? defaultTokenVerifier);
    const result = active.checkLimit(clientId);
    const resetSecs = Math.ceil(result.resetMs / 1000);
    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(resetSecs));
    if (!result.allowed) {
      // RFC 9110 §10.2.3: delay-seconds; never advertise 0 for a throttled call.
      const retryAfter = Math.max(1, resetSecs);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests, please retry later',
          retryAfter,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    next();
  };
}

/** Default per-route limiter — `app.use(rateLimitMiddleware)` or per-router. */
export const rateLimitMiddleware = createRateLimitMiddleware(sharedRateLimiter);

/** Stricter limiter for emergency / mutating routes. */
export const strictRateLimitMiddleware =
  createRateLimitMiddleware(strictRateLimiter);
