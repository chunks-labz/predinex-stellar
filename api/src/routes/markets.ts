/**
 * Markets API Route (Issues #1420, #1432, #1436, #1437).
 *
 * GET  /api/markets?limit=&offset=&status=&sort=&order=
 *
 * Lists prediction markets one page at a time instead of returning every
 * market in a single response. Results are ordered by ascending market id by
 * default so pages are stable while new markets are appended.
 *
 * Status filtering (#1437):
 *   `status` accepts one or more statuses, either comma-separated
 *   (`status=open,settled`) or repeated (`status=open&status=settled`).
 *   `sort` (id|expiry|volume|title) and `order` (asc|desc) combine with the
 *   filter and pagination; totals always reflect the filtered set.
 *
 * Soft-deleted (cancelled) markets (#1436):
 *   Cancelling a market marks it with status `cancelled` and keeps the record,
 *   its audit trail and its links intact instead of deleting it. Cancelled
 *   markets are excluded from the default listing and are only visible to
 *   admins, who can list, restore, and inspect the audit history:
 *     GET  /api/markets/admin/cancelled
 *     GET  /api/markets/admin/audit
 *     POST /api/markets/:id/cancel
 *     POST /api/markets/:id/restore
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
import { rateLimitMiddleware, strictRateLimitMiddleware } from '../middleware/rate-limit.js';
import { buildPageMeta, parsePagination } from '../services/pagination.js';
import {
  MarketListQuery,
  MarketStatus,
  parseMarketListQuery,
} from '../services/market-query.js';
import { AuthContext, sharedAuthValidator } from '../middleware/auth.js';

export type { MarketStatus } from '../services/market-query.js';
export type {
  MarketListQuery,
  MarketSortField,
  SortOrder,
} from '../services/market-query.js';

export interface MarketSummary {
  id: number;
  title: string;
  outcomes: string[];
  status: MarketStatus;
  expiry: number;
  totalVolume: string;
  /** ISO timestamp of the settlement or resolution. */
  settledAt?: string;
  /** ISO timestamp of the cancellation; only present on cancelled markets. */
  cancelledAt?: string;
  /** Actor that cancelled the market; only present on cancelled markets. */
  cancelledBy?: string;
  /** Optional reason supplied when the market was cancelled. */
  cancelReason?: string;
  /** ISO timestamp of the archive action; only present on archived markets. */
  archivedAt?: string;
  /** Actor that archived the market; only present on archived markets. */
  archivedBy?: string;
}

export interface MarketMetrics {
  totalMarkets: number;
  openMarkets: number;
  settledMarkets: number;
  voidedMarkets: number;
  cancelledMarkets: number;
  archivedMarkets: number;
  totalVolume: string;
  topMarketsByVolume: MarketSummary[];
  topMarketsByParticipants: Array<MarketSummary & { participantCount?: number }>;
}

/**
 * One entry in a market's audit trail. Every cancellation and restoration is
 * recorded so history survives soft deletion and can be reviewed later.
 */
export interface MarketAuditEntry {
  id: number;
  marketId: number;
  action: 'cancelled' | 'restored';
  /** Subject address when known, otherwise the literal `admin`. */
  actor: string;
  reason?: string;
  fromStatus: MarketStatus;
  toStatus: MarketStatus;
  timestamp: string;
}

/**
 * Backing store for the market list. Implementations must return markets in
 * a stable order (ascending `id` by default) so offsets map to the same items
 * between requests, and must treat `cancel` as a status change rather than a
 * row removal.
 */
export interface MarketSource {
  /** Number of markets matching `query` (cancelled markets excluded by default). */
  count(query?: MarketListQuery): Promise<number>;
  /** One page of markets matching `query`, ordered by `query` (id ascending by default). */
  list(offset: number, limit: number, query?: MarketListQuery): Promise<MarketSummary[]>;
  /** Single market by id, including soft-deleted ones. */
  get?(id: number): Promise<MarketSummary | null>;
  getMetrics?(): Promise<MarketMetrics>;
  invalidateCache?(): void;
  /** Soft-delete: mark `cancelled`, keep the record, append an audit entry. */
  cancel?(id: number, actor: string, reason?: string): Promise<MarketSummary | null>;
  /** Restore a cancelled market to the status it had before cancellation. */
  restore?(id: number, actor: string): Promise<MarketSummary | null>;
  /** Archive resolved markets older than the configured retention window. */
  archiveResolvedOlderThan?(windowMs: number): Promise<number>;
  /** Cancellation/restoration history, newest first, optionally for one market. */
  getAuditLog?(marketId?: number): Promise<MarketAuditEntry[]>;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const DEFAULT_QUERY: MarketListQuery = { sortBy: 'id', order: 'asc' };

/** Maximum length of a cancellation reason, mirroring the contract's limit. */
export const MAX_CANCEL_REASON_LENGTH = 256;

/** In-memory source; keeps markets sorted by id with optional TTL-based caching. */
export class InMemoryMarketSource implements MarketSource {
  private markets: MarketSummary[];
  private audit: MarketAuditEntry[] = [];
  private nextAuditId = 1;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cacheTtlMs: number;

  constructor(markets: MarketSummary[] = [], cacheTtlMs: number = 300000) {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
    this.cacheTtlMs = cacheTtlMs;
  }

  public setMarkets(markets: MarketSummary[]): void {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
    // The replaced dataset has no history; keeping stale entries would
    // attribute actions to market ids that now mean something else.
    this.audit = [];
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

  private clone(market: MarketSummary): MarketSummary {
    return { ...market, outcomes: [...market.outcomes] };
  }

  /**
   * Visibility + status filter. Without an explicit `statuses` list every
   * non-cancelled market matches, so soft-deleted markets stay hidden from
   * default listings.
   */
  private matchesQuery(market: MarketSummary, query?: MarketListQuery): boolean {
    if (query?.statuses && query.statuses.length > 0) {
      return query.statuses.includes(market.status);
    }
    return market.status !== 'cancelled' && market.status !== 'archived';
  }

  private compareVolume(a: string, b: string): number {
    let aValue: bigint;
    let bValue: bigint;
    try {
      aValue = BigInt(a || '0');
    } catch {
      aValue = BigInt(0);
    }
    try {
      bValue = BigInt(b || '0');
    } catch {
      bValue = BigInt(0);
    }
    if (aValue === bValue) return 0;
    return aValue < bValue ? -1 : 1;
  }

  /** Sort a filtered list; id ascending always breaks ties for stable pages. */
  private sortMarkets(markets: MarketSummary[], query: MarketListQuery): MarketSummary[] {
    const direction = query.order === 'desc' ? -1 : 1;
    return [...markets].sort((a, b) => {
      let primary: number;
      switch (query.sortBy) {
        case 'expiry':
          primary = a.expiry - b.expiry;
          break;
        case 'volume':
          primary = this.compareVolume(a.totalVolume, b.totalVolume);
          break;
        case 'title':
          primary = a.title.localeCompare(b.title);
          break;
        default:
          primary = a.id - b.id;
      }
      if (primary !== 0) return primary * direction;
      return a.id - b.id;
    });
  }

  public async count(query?: MarketListQuery): Promise<number> {
    return this.markets.filter((market) => this.matchesQuery(market, query)).length;
  }

  public async list(
    offset: number,
    limit: number,
    query: MarketListQuery = DEFAULT_QUERY
  ): Promise<MarketSummary[]> {
    const filtered = this.markets.filter((market) => this.matchesQuery(market, query));
    return this.sortMarkets(filtered, query)
      .slice(offset, offset + limit)
      .map((market) => this.clone(market));
  }

  public async get(id: number): Promise<MarketSummary | null> {
    const market = this.markets.find((candidate) => candidate.id === id);
    return market ? this.clone(market) : null;
  }

  public async cancel(id: number, actor: string, reason?: string): Promise<MarketSummary | null> {
    const market = this.markets.find((candidate) => candidate.id === id);
    if (!market) return null;

    // Idempotent: cancelling an already-cancelled market neither rewrites the
    // record nor appends a duplicate audit entry.
    if (market.status === 'cancelled') return this.clone(market);

    const fromStatus = market.status;
    market.status = 'cancelled';
    market.cancelledAt = new Date().toISOString();
    market.cancelledBy = actor;
    if (reason !== undefined) market.cancelReason = reason;

    this.audit.push({
      id: this.nextAuditId++,
      marketId: id,
      action: 'cancelled',
      actor,
      ...(reason !== undefined ? { reason } : {}),
      fromStatus,
      toStatus: 'cancelled',
      timestamp: market.cancelledAt,
    });
    this.invalidateCache();
    return this.clone(market);
  }

  /** Status the market had before it was cancelled, from the audit trail. */
  private statusBeforeCancel(id: number): MarketStatus {
    for (let i = this.audit.length - 1; i >= 0; i -= 1) {
      const entry = this.audit[i];
      if (entry.marketId === id && entry.action === 'cancelled') return entry.fromStatus;
    }
    return 'open';
  }

  public async restore(id: number, actor: string): Promise<MarketSummary | null> {
    const market = this.markets.find((candidate) => candidate.id === id);
    if (!market) return null;
    if (market.status !== 'cancelled') return this.clone(market);

    const restoredStatus = this.statusBeforeCancel(id);
    market.status = restoredStatus;
    delete market.cancelledAt;
    delete market.cancelledBy;
    delete market.cancelReason;

    this.audit.push({
      id: this.nextAuditId++,
      marketId: id,
      action: 'restored',
      actor,
      fromStatus: 'cancelled',
      toStatus: restoredStatus,
      timestamp: new Date().toISOString(),
    });
    this.invalidateCache();
    return this.clone(market);
  }

  public async archiveResolvedOlderThan(windowMs: number): Promise<number> {
    const cutoff = Date.now() - windowMs;
    let archivedCount = 0;

    for (const market of this.markets) {
      if (market.status !== 'settled' && market.status !== 'voided') {
        continue;
      }
      if (!market.settledAt) {
        continue;
      }

      const resolvedAt = Date.parse(market.settledAt);
      if (Number.isNaN(resolvedAt) || resolvedAt >= cutoff) {
        continue;
      }

      market.status = 'archived';
      market.archivedAt = new Date().toISOString();
      market.archivedBy = 'system';
      archivedCount += 1;
    }

    if (archivedCount > 0) {
      this.invalidateCache();
    }

    return archivedCount;
  }

  public async getAuditLog(marketId?: number): Promise<MarketAuditEntry[]> {
    return this.audit
      .filter((entry) => marketId === undefined || entry.marketId === marketId)
      .map((entry) => ({ ...entry }))
      .reverse();
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
      archivedMarkets: this.markets.filter((m) => m.status === 'archived').length,
      totalVolume: this.markets
        .reduce((sum, m) => sum + BigInt(m.totalVolume || '0'), BigInt(0))
        .toString(),
      topMarketsByVolume: [...this.markets]
        .sort((a, b) => this.compareVolume(b.totalVolume, a.totalVolume))
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
    const parsedPage = parsePagination(req.query as Record<string, unknown>);
    const parsedQuery = parseMarketListQuery(req.query as Record<string, unknown>);

    if (!parsedPage.ok || !parsedQuery.ok) {
      const details = [
        ...(parsedPage.ok ? [] : parsedPage.errors),
        ...(parsedQuery.ok ? [] : parsedQuery.errors),
      ];
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid market query parameters', details);
      return;
    }

    const query = parsedQuery.params;
    const auth = authenticate(req);

    // Cancelled markets are admin-only. Non-admins may filter among the
    // visible statuses, but requesting the soft-deleted set is refused
    // outright rather than silently returning an empty page.
    if (query.statuses?.includes('cancelled') && auth.role !== 'Admin') {
      sendError(
        res,
        403,
        'FORBIDDEN',
        'Admin access required to include cancelled markets'
      );
      return;
    }

    try {
      const { params } = parsedPage;
      const total = await source.count(query);
      const data =
        params.offset < total ? await source.list(params.offset, params.limit, query) : [];
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
    const auth = authenticate(req);
    if (auth.role !== 'Admin') {
      sendError(res, 403, 'FORBIDDEN', 'Admin access required');
      return;
    }

    try {
      const metrics = source.getMetrics ? await source.getMetrics() : {
        totalMarkets: await source.count(),
        openMarkets: 0,
        settledMarkets: 0,
        voidedMarkets: 0,
        cancelledMarkets: 0,
        archivedMarkets: 0,
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

  // Admin-only: soft-deleted markets, with the same sort/pagination controls
  // as the public listing (#1436).
  router.get(
    '/admin/cancelled',
    async (req: Request, res: Response, next: NextFunction) => {
      const auth = authenticate(req);
      if (auth.role !== 'Admin') {
        sendError(res, 403, 'FORBIDDEN', 'Admin access required');
        return;
      }

      const parsedPage = parsePagination(req.query as Record<string, unknown>);
      const parsedQuery = parseMarketListQuery(req.query as Record<string, unknown>);
      if (!parsedPage.ok || !parsedQuery.ok) {
        const details = [
          ...(parsedPage.ok ? [] : parsedPage.errors),
          ...(parsedQuery.ok ? [] : parsedQuery.errors),
        ];
        sendError(res, 400, 'VALIDATION_ERROR', 'Invalid market query parameters', details);
        return;
      }

      try {
        const { params } = parsedPage;
        const query: MarketListQuery = {
          ...parsedQuery.params,
          statuses: ['cancelled'],
        };
        const total = await source.count(query);
        const data =
          params.offset < total ? await source.list(params.offset, params.limit, query) : [];
        res.json({
          success: true,
          data,
          pagination: buildPageMeta(total, params, data.length),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Admin-only: cancellation/restoration history (#1436).
  router.get('/admin/audit', async (req: Request, res: Response, next: NextFunction) => {
    const auth = authenticate(req);
    if (auth.role !== 'Admin') {
      sendError(res, 403, 'FORBIDDEN', 'Admin access required');
      return;
    }

    const parsedPage = parsePagination(req.query as Record<string, unknown>);
    if (!parsedPage.ok) {
      sendError(res, 400, 'VALIDATION_ERROR', 'Invalid pagination parameters', parsedPage.errors);
      return;
    }

    let marketId: number | undefined;
    if (req.query.marketId !== undefined) {
      const raw = req.query.marketId;
      if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
        sendError(res, 400, 'VALIDATION_ERROR', 'marketId must be a non-negative integer');
        return;
      }
      marketId = Number(raw);
    }

    try {
      const { params } = parsedPage;
      const entries = source.getAuditLog
        ? await source.getAuditLog(marketId)
        : [];
      const page = entries.slice(params.offset, params.offset + params.limit);
      res.json({
        success: true,
        data: page,
        pagination: buildPageMeta(entries.length, params, page.length),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/archive-resolved', strictRateLimitMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    const auth = authenticate(req);
    if (auth.role !== 'Admin') {
      sendError(res, 403, 'FORBIDDEN', 'Admin access required');
      return;
    }

    if (!source.archiveResolvedOlderThan) {
      sendError(res, 501, 'NOT_IMPLEMENTED', 'This market source does not support archiving');
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const suppliedWindowDays = body.windowDays === undefined ? undefined : parsePositiveInteger(body.windowDays);
    if (body.windowDays !== undefined && suppliedWindowDays === null) {
      sendError(res, 400, 'VALIDATION_ERROR', 'windowDays must be a positive integer');
      return;
    }

    const windowDays = suppliedWindowDays ?? loadArchiveWindowDays();

    try {
      const archivedCount = await source.archiveResolvedOlderThan(archiveWindowMs(windowDays));
      console.info(`Archived ${archivedCount} resolved markets older than ${windowDays} day(s)`);
      res.json({
        success: true,
        data: { archivedCount, windowDays },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // Soft-delete (cancel) a market without removing the record (#1436).
  router.post('/:id/cancel', strictRateLimitMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    const auth = authenticate(req);
    if (auth.role !== 'Admin') {
      sendError(res, 403, 'FORBIDDEN', 'Admin access required');
      return;
    }

    const parsedId = parseMarketId(req.params.id);
    if (!parsedId.ok) {
      sendError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = body.reason;
    if (reason !== undefined && typeof reason !== 'string') {
      sendError(res, 400, 'VALIDATION_ERROR', 'reason must be a string');
      return;
    }
    if (typeof reason === 'string' && reason.length > MAX_CANCEL_REASON_LENGTH) {
      sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `reason must be at most ${MAX_CANCEL_REASON_LENGTH} characters`
      );
      return;
    }

    if (!source.cancel) {
      sendError(res, 501, 'NOT_IMPLEMENTED', 'This market source does not support cancellation');
      return;
    }

    try {
      const market = await source.cancel(parsedId.id, auditActor(auth), reason);
      if (!market) {
        sendError(res, 404, 'NOT_FOUND', `Market ${parsedId.id} not found`);
        return;
      }
      res.json({ success: true, data: market, timestamp: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  // Restore a soft-deleted market (#1436).
  router.post('/:id/restore', strictRateLimitMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    const auth = authenticate(req);
    if (auth.role !== 'Admin') {
      sendError(res, 403, 'FORBIDDEN', 'Admin access required');
      return;
    }

    const parsedId = parseMarketId(req.params.id);
    if (!parsedId.ok) {
      sendError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
      return;
    }

    if (!source.restore || !source.get) {
      sendError(res, 501, 'NOT_IMPLEMENTED', 'This market source does not support restoration');
      return;
    }

    try {
      const existing = await source.get(parsedId.id);
      if (!existing) {
        sendError(res, 404, 'NOT_FOUND', `Market ${parsedId.id} not found`);
        return;
      }
      if (existing.status !== 'cancelled') {
        sendError(res, 409, 'NOT_CANCELLED', `Market ${parsedId.id} is not cancelled`);
        return;
      }

      const market = await source.restore(parsedId.id, auditActor(auth));
      res.json({ success: true, data: market, timestamp: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const marketsRouter = createMarketsRouter();
