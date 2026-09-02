/**
 * Sliding-Window Rate Limiting Middleware.
 * Prevents denial-of-service and brute-force attacks on simulation & transaction endpoints.
 */

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

  public reset(clientId?: string): void {
    if (clientId) {
      this.clients.delete(clientId);
    } else {
      this.clients.clear();
    }
  }
}
