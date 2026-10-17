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
import { CreateMarketRequest, validateCreateMarket } from '../services/market-validation.js';
import { NotImplementedError } from './budget.js';

export type MarketStatus = 'open' | 'settled' | 'voided' | 'cancelled';

export interface MarketSummary {
  id: number;
  title: string;
  outcomes: string[];
  status: MarketStatus;
  expiry: number;
  totalVolume: string;
}

/**
 * Backing store for the market list. Implementations must return markets in
 * ascending `id` order so offsets map to the same items between requests.
 */
export interface MarketSource {
  count(): Promise<number>;
  list(offset: number, limit: number): Promise<MarketSummary[]>;
}

/** In-memory source; keeps markets sorted by id. */
export class InMemoryMarketSource implements MarketSource {
  private markets: MarketSummary[];

  constructor(markets: MarketSummary[] = []) {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
  }

  public setMarkets(markets: MarketSummary[]): void {
    this.markets = [...markets].sort((a, b) => a.id - b.id);
  }

  public async count(): Promise<number> {
    return this.markets.length;
  }

  public async list(offset: number, limit: number): Promise<MarketSummary[]> {
    return this.markets.slice(offset, offset + limit);
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

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const validated = validateCreateMarket(req.body);
    if (!validated.ok) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid market parameters',
          details: validated.errors,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      if (!creator) {
        throw new NotImplementedError('Market creation on-chain submission is not yet implemented');
      }
      const data = await creator(validated.value);
      res.status(201).json({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      if (err instanceof NotImplementedError || err?.name === 'NotImplementedError') {
        res.status(501).json({
          success: false,
          error: { code: 'NOT_IMPLEMENTED', message: err.message },
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    }
  });

  return router;
}

export const marketsRouter = createMarketsRouter();
