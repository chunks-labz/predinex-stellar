/**
 * Positions API Route (Issue #1425).
 *
 * GET /api/positions
 *   Query parameters:
 *     market  – optional, filter by pool id
 *     account – optional, filter by Stellar account address
 *     outcome – optional, filter by outcome index
 *     limit   – page size (default 20, max 100)
 *     offset  – zero-based page start (default 0)
 *
 * Response envelope:
 *   {
 *     success:    true,
 *     data:       IndexedPosition[],
 *     pagination: { total, limit, offset, count, hasMore, nextOffset, prevOffset },
 *     timestamp:  string (ISO)
 *   }
 *
 * The route is intentionally read-only; positions are written exclusively by
 * the PositionIndexer service, which is called by the off-chain event
 * subscriber.
 *
 * The InMemoryPositionSource exported here is the in-process reference
 * implementation used in tests.  Production deployments should replace it
 * with a database-backed implementation that satisfies the PositionSource
 * interface in api/src/types/positions.ts.
 */

import { Router, Request, Response } from 'express';
import { buildPageMeta, parsePagination } from '../services/pagination.js';
import { logger, serializeError } from '../lib/logger.js';
import { withSpan } from '../middleware/tracing.js';
import { getPositionEventId } from '../types/positions.js';
import type {
  IndexedPosition,
  PlaceBetEvent,
  PositionEventCursor,
  PositionFilter,
  PositionSource,
} from '../types/positions.js';

export type {
  IndexedPosition,
  PlaceBetEvent,
  PositionEventCursor,
  PositionFilter,
  PositionSource,
};

// ---------------------------------------------------------------------------
// InMemoryPositionSource
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of {@link PositionSource}.
 *
 * Upserts are keyed on `(market, account, outcome)`. Event ids are tracked
 * globally so duplicate deliveries cannot apply a transition twice.
 *
 * Thread-safety: JavaScript is single-threaded; no locking is needed.
 */
export class InMemoryPositionSource implements PositionSource {
  /** Primary store: `${market}:${account}:${outcome}` → position. */
  private positions: Map<string, IndexedPosition> = new Map();
  private processedEvents: Map<string, string> = new Map();
  private events: Map<string, PlaceBetEvent> = new Map();

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private static positionKey(market: number, account: string, outcome: number): string {
    return `${market}:${account}:${outcome}`;
  }

  private matchesFilter(pos: IndexedPosition, filter?: PositionFilter): boolean {
    if (filter?.market !== undefined && pos.market !== filter.market) return false;
    if (filter?.account !== undefined && pos.account !== filter.account) return false;
    if (filter?.outcome !== undefined && pos.outcome !== filter.outcome) return false;
    return true;
  }

  /** Stable ordering: (market asc, account asc, outcome asc). */
  private static compare(a: IndexedPosition, b: IndexedPosition): number {
    if (a.market !== b.market) return a.market - b.market;
    const acc = a.account.localeCompare(b.account);
    if (acc !== 0) return acc;
    return a.outcome - b.outcome;
  }

  private static compareEvents(a: PlaceBetEvent, b: PlaceBetEvent): number {
    if (a.ledgerSeq !== b.ledgerSeq) return a.ledgerSeq - b.ledgerSeq;
    const eventIndex = (a.eventIndex ?? 0) - (b.eventIndex ?? 0);
    if (eventIndex !== 0) return eventIndex;
    return getPositionEventId(a).localeCompare(getPositionEventId(b));
  }

  private filtered(filter?: PositionFilter): IndexedPosition[] {
    const results: IndexedPosition[] = [];
    for (const pos of this.positions.values()) {
      if (this.matchesFilter(pos, filter)) results.push(pos);
    }
    return results.sort(InMemoryPositionSource.compare);
  }

  // -------------------------------------------------------------------------
  // PositionSource implementation
  // -------------------------------------------------------------------------

  async count(filter?: PositionFilter): Promise<number> {
    return withSpan('db.positions.count', async () => {
      return this.filtered(filter).length;
    });
  }

  async list(offset: number, limit: number, filter?: PositionFilter): Promise<IndexedPosition[]> {
    return withSpan('db.positions.list', async () => {
      return this.filtered(filter)
        .slice(offset, offset + limit)
        .map((p) => ({ ...p })); // shallow clone to prevent external mutation
    });
  }

  async listEvents(
    offset: number,
    limit: number,
    cursor?: PositionEventCursor
  ): Promise<PlaceBetEvent[]> {
    return withSpan('db.positions.list_events', async () => {
      const sorted = [...this.events.values()].sort(InMemoryPositionSource.compareEvents);
      const start = cursor
        ? sorted.findIndex((event) => InMemoryPositionSource.compareEvents(event, {
          ...event,
          ledgerSeq: cursor.ledgerSeq,
          eventIndex: cursor.eventIndex,
          eventId: cursor.eventId,
        }) > 0)
        : offset;
      const index = start < 0 ? sorted.length : start;
      return sorted.slice(index, index + limit).map((event) => ({ ...event }));
    });
  }

  async countEvents(): Promise<number> {
    return withSpan('db.positions.count_events', async () => this.events.size);
  }

  private applyEvent(event: PlaceBetEvent): IndexedPosition {
    const eventId = getPositionEventId(event);
    const processedPositionKey = this.processedEvents.get(eventId);
    if (processedPositionKey) {
      const processedPosition = this.positions.get(processedPositionKey);
      if (!processedPosition) {
        throw new Error(`Processed event ${eventId} has no indexed position`);
      }
      return { ...processedPosition };
    }

    const key = InMemoryPositionSource.positionKey(event.market, event.account, event.outcome);
    const existing = this.positions.get(key);

    // Reorg safety: do not let an older ledger replace newer canonical state.
    if (existing && event.ledgerSeq < existing.lastLedgerSeq) {
      return { ...existing };
    }

    const now = new Date().toISOString();
    const position: IndexedPosition = {
      market: event.market,
      account: event.account,
      outcome: event.outcome,
      amount: event.amount,
      totalYes: event.totalYes,
      totalNo: event.totalNo,
      lastTxHash: event.txHash,
      lastLedgerSeq: event.ledgerSeq,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.positions.set(key, position);
    this.processedEvents.set(eventId, key);
    this.events.set(eventId, { ...event, eventId });
    return { ...position };
  }

  async upsert(event: PlaceBetEvent): Promise<IndexedPosition> {
    return withSpan('db.positions.upsert', async () => {
      return this.applyEvent(event);
    });
  }

  async rollback(latestSafeSeq: number): Promise<number> {
    return withSpan('db.positions.rollback', async () => {
      const removed = [...this.positions.values()]
        .filter((position) => position.lastLedgerSeq > latestSafeSeq).length;
      for (const [eventId, event] of this.events.entries()) {
        if (event.ledgerSeq > latestSafeSeq) this.events.delete(eventId);
      }
      this.positions.clear();
      this.processedEvents.clear();
      const canonicalEvents = [...this.events.values()].sort(InMemoryPositionSource.compareEvents);
      for (const event of canonicalEvents) this.applyEvent(event);
      return removed;
    });
  }

  /** Test helper: remove all stored positions. */
  clear(): void {
    this.positions.clear();
    this.processedEvents.clear();
    this.events.clear();
  }

  /** Test helper: return a snapshot of all stored positions in stable order. */
  all(): IndexedPosition[] {
    return this.filtered();
  }
}

// ---------------------------------------------------------------------------
// Default store + factory
// ---------------------------------------------------------------------------

/** Singleton in-memory store shared by the default router. */
export const defaultPositionSource = new InMemoryPositionSource();

// ---------------------------------------------------------------------------
// Query parsing helpers
// ---------------------------------------------------------------------------

function parsePositionFilter(query: Record<string, unknown>): {
  ok: true;
  filter: PositionFilter;
} | {
  ok: false;
  errors: string[];
} {
  const errors: string[] = [];
  const filter: PositionFilter = {};

  if (query.market !== undefined) {
    const raw = Array.isArray(query.market) ? query.market[0] : query.market;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw as string)) {
      errors.push('market must be a non-negative integer');
    } else {
      filter.market = Number(raw);
    }
  }

  if (query.account !== undefined) {
    const raw = Array.isArray(query.account) ? query.account[0] : query.account;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      errors.push('account must be a non-empty string');
    } else {
      filter.account = (raw as string).trim();
    }
  }

  if (query.outcome !== undefined) {
    const raw = Array.isArray(query.outcome) ? query.outcome[0] : query.outcome;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw as string)) {
      errors.push('outcome must be a non-negative integer');
    } else {
      filter.outcome = Number(raw);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, filter };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates the `/api/positions` router backed by `source`.
 *
 * Passing an explicit source is the primary extension point for tests (pass an
 * `InMemoryPositionSource`) and production (pass a database-backed
 * `PositionSource`).  When no source is given the module-level singleton is
 * used.
 */
export function createPositionsRouter(source: PositionSource = defaultPositionSource): Router {
  const router = Router();

  /**
   * GET /api/positions
   *
   * Returns a paginated list of indexed positions. Supports optional
   * `market`, `account`, and `outcome` filters.
   */
  router.get('/', async (req: Request, res: Response) => {
    // 1. Parse + validate pagination params.
    const paginationResult = parsePagination(req.query as Record<string, unknown>);
    if (!paginationResult.ok) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: paginationResult.errors.join('; '),
          details: paginationResult.errors,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 2. Parse + validate filter params.
    const filterResult = parsePositionFilter(req.query as Record<string, unknown>);
    if (!filterResult.ok) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: filterResult.errors.join('; '),
          details: filterResult.errors,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { params } = paginationResult;
    const { filter } = filterResult;

    try {
      const [total, data] = await Promise.all([
        source.count(filter),
        source.list(params.offset, params.limit, filter),
      ]);

      const pagination = buildPageMeta(total, params, data.length);

      res.status(200).json({
        success: true,
        data,
        pagination,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('positions_list_failed', serializeError(err));
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve positions',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

/** Default router instance for use in app.ts. */
export const positionsRouter = createPositionsRouter(defaultPositionSource);
