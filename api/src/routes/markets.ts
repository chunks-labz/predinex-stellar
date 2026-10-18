/**
 * Markets API Route (Issue #1420).
 *
 * GET /api/markets?limit=&offset=
 *
 * Lists prediction markets one page at a time instead of returning every
 * market in a single response. Results are ordered by ascending market id so
 * pages are stable while new markets are appended.
 *
 * POST /api/markets
 *
 * Validates a market creation payload (Issue #1434) with the shared rules in
 * `services/market-validation.ts` and hands valid payloads, unchanged, to the
 * configured `MarketCreator`. Invalid payloads get a structured 400 with
 * field-level `details`. Until an on-chain creator is wired in, valid
 * payloads receive 501, mirroring the referral route.
 *
 * Response envelope:
 *   {
 *     success: true,
 *     data: MarketSummary[],
 *     pagination: { total, limit, offset, count, hasMore, nextOffset, prevOffset },
 *     timestamp
 *   }
 */

import { Router, Request, Response, NextFunction } from 'express';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { buildPageMeta, parsePagination } from '../services/pagination.js';
import { requireAdmin, AuthContext, sharedAuthValidator } from '../middleware/auth.js';

export type MarketStatus = 'open' | 'settled' | 'voided' | 'cancelled';

export interface MarketSummary {
  id: number;
  title: string;
  outcomes: string[];
  status: MarketStatus;
  expiry: number;
  totalVolume: string;
}

export interface MarketMetrics {
  totalMarkets: number;
  openMarkets: number;
  settledMarkets: number;
  voidedMarkets: number;
  cancelledMarkets: number;
  totalVolume: string;
  topMarketsByVolume: MarketSummary[];
  topMarketsByParticipants: Array<MarketSummary & { participantCount?: number }>;
}

/**
 * Backing store for the market list. Implementations must return markets in
 * ascending `id` order so offsets map to the same items between requests.
 */
export interface MarketSource {
  count(): Promise<number>;
  list(offset: number, limit: number): Promise<MarketSummary[]>;
  getMetrics?(): Promise<MarketMetrics>;
  invalidateCache?(): void;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/** In-memory source; keeps markets sorted by id with optional TTL-based caching. */
export class InMemoryMarketSource implements MarketSource {
  private markets: MarketSummary[];
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cacheTtlMs: number;

  constructor(markets: MarketSummary[] = [], cacheTtlMs: number = 300000) {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
    this.cacheTtlMs = cacheTtlMs;
  }

  public setMarkets(markets: MarketSummary[]): void {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
    this.invalidateCache();
  }

  public invalidateCache(): void {
    this.cache.clear();
  }

  private isCacheValid<T>(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return Date.now() < entry.expiresAt;
  }

  private getFromCache<T>(key: string): T | null {
    if (!this.isCacheValid(key)) {
      this.cache.delete(key);
      return null;
    }
    return this.cache.get(key)?.data as T;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  public async count(): Promise<number> {
    return this.markets.length;
  }

  public async list(offset: number, limit: number): Promise<MarketSummary[]> {
    return this.markets.slice(offset, offset + limit);
  }

  public async getMetrics(): Promise<MarketMetrics> {
    const cacheKey = 'metrics';
    const cached = this.getFromCache<MarketMetrics>(cacheKey);
    if (cached) return cached;

    const metrics: MarketMetrics = {
      totalMarkets: this.markets.length,
      openMarkets: this.markets.filter((m) => m.status === 'open').length,
      settledMarkets: this.markets.filter((m) => m.status === 'settled').length,
      voidedMarkets: this.markets.filter((m) => m.status === 'voided').length,
      cancelledMarkets: this.markets.filter((m) => m.status === 'cancelled').length,
      totalVolume: this.markets
        .reduce((sum, m) => sum + BigInt(m.totalVolume || '0'), BigInt(0))
        .toString(),
      topMarketsByVolume: [...this.markets]
        .sort((a, b) => BigInt(b.totalVolume || '0') - BigInt(a.totalVolume || '0'))
        .slice(0, 10),
      topMarketsByParticipants: [...this.markets].slice(0, 10),
    };

    this.setCache(cacheKey, metrics);
    return metrics;
  }
}

/** Submits a validated market creation request and returns the created market. */
export type MarketCreator = (req: CreateMarketRequest) => Promise<MarketSummary>;

export const defaultMarketSource = new InMemoryMarketSource();

export function createMarketsRouter(
  source: MarketSource = defaultMarketSource,
  creator?: MarketCreator
): Router {
  const router = Router();
  router.use(rateLimitMiddleware);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const parsed = parsePagination(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid pagination parameters',
          details: parsed.errors,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const { params } = parsed;
      const total = await source.count();
      const data = params.offset < total ? await source.list(params.offset, params.limit) : [];
      res.json({
        success: true,
        data,
        pagination: buildPageMeta(total, params, data.length),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // Admin-only metrics endpoint (#1432)
  router.get('/admin/metrics', async (req: Request, res: Response, next: NextFunction) => {
    const authContext: AuthContext = sharedAuthValidator.authenticate(
      req.headers as Record<string, string | undefined>
    );

    if (authContext.role !== 'Admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const metrics = source.getMetrics ? await source.getMetrics() : {
        totalMarkets: await source.count(),
        openMarkets: 0,
        settledMarkets: 0,
        voidedMarkets: 0,
        cancelledMarkets: 0,
        totalVolume: '0',
        topMarketsByVolume: [],
        topMarketsByParticipants: [],
      };

      res.json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const marketsRouter = createMarketsRouter();
