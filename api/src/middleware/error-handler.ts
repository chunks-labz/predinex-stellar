/**
 * Terminal 404 / error handlers that include the request correlation ID
 * (Issue #1491). Exported separately so tests can mount them on a minimal app.
 */

import type { NextFunction, Request, Response } from 'express';
import { logger, serializeError } from '../lib/logger.js';
import { getRequestCorrelationId } from './request-context.js';

export function apiNotFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Unknown route',
      correlationId: getRequestCorrelationId(res),
    },
    timestamp: new Date().toISOString(),
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function apiErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = getRequestCorrelationId(res);
  logger.error('unhandled_api_error', {
    ...serializeError(err),
    method: req.method,
    path: req.originalUrl ?? req.url,
  });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      correlationId,
    },
    timestamp: new Date().toISOString(),
  });
}
