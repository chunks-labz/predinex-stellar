/**
 * Request correlation + structured access logging (Issue #1491).
 *
 * Installed before body parsing and routes so every request, including one
 * rejected by validation or an unhandled error, has a correlation ID. The ID is
 * echoed in the response headers and used by `logger` for the access line.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  getCorrelationContext,
  resolveCorrelationContext,
  runWithCorrelation,
} from '../lib/correlation.js';
import { logger } from '../lib/logger.js';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';
export const REQUEST_ID_HEADER = 'X-Request-ID';

/** Returns the correlation ID for the current request, even after headers are sent. */
export function getRequestCorrelationId(res?: Response): string | undefined {
  const header = res?.getHeader(CORRELATION_ID_HEADER);
  if (typeof header === 'string' && header.length > 0) return header;
  return getCorrelationContext()?.correlationId;
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { context } = resolveCorrelationContext(req.headers);

  res.setHeader(CORRELATION_ID_HEADER, context.correlationId);
  res.setHeader(REQUEST_ID_HEADER, context.requestId);

  const startedAt = process.hrtime.bigint();

  runWithCorrelation(context, () => {
    let logged = false;
    const logRequest = (aborted: boolean) => {
      if (logged) return;
      logged = true;

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : undefined;

      logger[level]('http_request', {
        method: req.method,
        path: req.originalUrl ?? req.url,
        ...(route ? { route } : {}),
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ...(aborted ? { aborted: true } : {}),
      });
    };

    res.on('finish', () => logRequest(false));
    res.on('close', () => logRequest(!res.writableEnded));

    next();
  });
}
