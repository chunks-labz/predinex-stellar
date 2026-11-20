import { Router, Request, Response } from 'express';
import { logger, serializeError } from '../lib/logger.js';
import { parsePagination } from '../services/pagination.js';
import { getPositionEventId } from '../types/positions.js';
import type { PositionEventCursor, PositionSource } from '../types/positions.js';
import { defaultPositionSource } from './positions.js';

function encodeCursor(cursor: PositionEventCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: unknown): PositionEventCursor | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('ledgerSeq' in parsed)
      || !('eventIndex' in parsed)
      || !('eventId' in parsed)
      || typeof parsed.ledgerSeq !== 'number'
      || !Number.isSafeInteger(parsed.ledgerSeq)
      || parsed.ledgerSeq < 0
      || typeof parsed.eventIndex !== 'number'
      || !Number.isSafeInteger(parsed.eventIndex)
      || parsed.eventIndex < 0
      || typeof parsed.eventId !== 'string'
      || parsed.eventId.length === 0
      || Buffer.from(decoded, 'utf8').toString('base64url') !== value
    ) {
      return null;
    }

    return {
      ledgerSeq: parsed.ledgerSeq,
      eventIndex: parsed.eventIndex,
      eventId: parsed.eventId,
    };
  } catch {
    return null;
  }
}

export function createEventsRouter(source: PositionSource = defaultPositionSource): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const query = req.query as Record<string, unknown>;
    const paginationResult = parsePagination(query);
    const errors = paginationResult.ok ? [] : paginationResult.errors;
    const hasCursor = query.cursor !== undefined;
    const rawCursor = query.cursor;
    const cursor = rawCursor === '' ? undefined : decodeCursor(rawCursor);

    if (hasCursor && query.offset !== undefined) {
      errors.push('offset cannot be combined with cursor');
    }
    if (hasCursor && rawCursor !== '' && !cursor) {
      errors.push('cursor must be a valid opaque cursor');
    }
    if (errors.length > 0 || !paginationResult.ok) {
      const details = errors.length > 0 ? errors : ['invalid pagination parameters'];
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: details.join('; '),
          details,
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { params } = paginationResult;
    const after = cursor ?? undefined;
    try {
      const [total, fetched] = await Promise.all([
        source.countEvents(),
        source.listEvents(params.offset, params.limit + 1, after),
      ]);
      const hasMore = fetched.length > params.limit;
      const data = hasMore ? fetched.slice(0, params.limit) : fetched;
      const last = data[data.length - 1];
      const nextCursor = hasMore && last
        ? encodeCursor({
          ledgerSeq: last.ledgerSeq,
          eventIndex: last.eventIndex ?? 0,
          eventId: getPositionEventId(last),
        })
        : null;

      res.status(200).json({
        success: true,
        data,
        pagination: {
          total,
          limit: params.limit,
          offset: hasCursor ? null : params.offset,
          count: data.length,
          hasMore,
          nextOffset: hasCursor || !hasMore ? null : params.offset + data.length,
          cursor: cursor ? encodeCursor(cursor) : null,
          nextCursor,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('events_list_failed', serializeError(err));
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to retrieve events',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}

export const eventsRouter = createEventsRouter(defaultPositionSource);
