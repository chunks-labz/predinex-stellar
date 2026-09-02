/**
 * Shared in-process rate limiter for Next.js API route handlers (#1061).
 *
 * Abuse posture
 * -------------
 * - All public API routes that accept user input or trigger external lookups
 *   MUST call `checkRateLimit` keyed by the most-specific available identifier
 *   (wallet address > forwarded IP > "anonymous").
 * - Routes that do not receive a wallet address should fall back to the
 *   client IP derived from the `x-forwarded-for` header.
 * - Limits are intentionally conservative; tighten per-route as traffic data
 *   becomes available.
 * - This helper is in-process only.  A Redis/KV-backed implementation should
 *   replace it before horizontal scaling (multiple serverless instances).
 *
 * Usage
 * -----
 * ```ts
 * import { checkRateLimit, rateLimitHeaders } from '@/app/lib/rate-limit';
 *
 * const rl = checkRateLimit(key, { max: 10, windowMs: 60 * 60 * 1000 });
 * if (!rl.allowed) {
 *   return NextResponse.json(
 *     { error: 'Rate limit exceeded.' },
 *     { status: 429, headers: rateLimitHeaders(rl) },
 *   );
 * }
 * ```
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitOptions {
  /** Maximum requests allowed per window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

// Global store shared across all callers in the same Node.js process.
const store = new Map<string, RateLimitEntry>();

/**
 * Check and update the rate-limit counter for `key`.
 *
 * @param key     Unique identifier for the caller (wallet address, IP, etc.)
 * @param options Rate-limit parameters.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { max, windowMs } = options;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs, limit: max };
  }

  if (entry.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.windowStart + windowMs,
      limit: max,
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: max - entry.count,
    resetAt: entry.windowStart + windowMs,
    limit: max,
  };
}

/**
 * Build standard RFC-7235-style rate-limit response headers from a result.
 */
export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
  };
}

/**
 * Parse a `limit`-style query parameter with a sensible default and hard cap.
 *
 * @param raw      Raw string value from `searchParams.get('limit')`.
 * @param fallback Default to use when the value is absent or invalid.
 * @param max      Hard cap — values above this are clamped down.
 */
export function parseLimitParam(raw: string | null, fallback = 20, max = 100): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(n, max);
}
