/**
 * Structured logging + correlation ID tests (Issue #1491).
 */

import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithCorrelation } from '../src/lib/correlation.js';
import { logger, setLogLevel } from '../src/lib/logger.js';
import { requestContextMiddleware } from '../src/middleware/request-context.js';
import { apiErrorHandler, apiNotFoundHandler } from '../src/middleware/error-handler.js';
import { injectTraceHeaders } from '../src/middleware/tracing.js';
import { PositionIndexer } from '../src/services/position-indexer.js';
import { InMemoryPositionSource } from '../src/routes/positions.js';

function buildApp() {
  const app = express();
  app.use(requestContextMiddleware);
  app.get('/boom', () => {
    throw new Error('boom');
  });
  app.use(apiNotFoundHandler);
  app.use(apiErrorHandler);
  return app;
}

function captureStdio() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  return { stdout, stderr };
}

function parseLines(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

afterEach(() => {
  vi.restoreAllMocks();
  setLogLevel('info');
});

describe('request correlation (Issue #1491)', () => {
  it('echoes a supplied X-Correlation-ID and includes it in 404 responses', async () => {
    captureStdio();
    const res = await request(buildApp())
      .get('/missing')
      .set('X-Correlation-ID', 'caller-correlation-123');

    expect(res.status).toBe(404);
    expect(res.headers['x-correlation-id']).toBe('caller-correlation-123');
    expect(res.headers['x-request-id']).toBe('caller-correlation-123');
    expect(res.body.error.correlationId).toBe('caller-correlation-123');
  });

  it('accepts X-Request-ID and falls back to it for correlation', async () => {
    captureStdio();
    const res = await request(buildApp())
      .get('/missing')
      .set('X-Request-ID', 'request-id-456');

    expect(res.headers['x-correlation-id']).toBe('request-id-456');
    expect(res.body.error.correlationId).toBe('request-id-456');
  });

  it('generates a correlation ID when the caller does not supply one', async () => {
    captureStdio();
    const res = await request(buildApp()).get('/missing');

    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.error.correlationId).toBe(res.headers['x-correlation-id']);
  });

  it('includes the correlation ID in unhandled 500 responses and logs it', async () => {
    const { stderr } = captureStdio();
    const res = await request(buildApp())
      .get('/boom')
      .set('X-Correlation-ID', 'error-correlation-789');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      correlationId: 'error-correlation-789',
    });

    const errorLine = parseLines(stderr).find((line) => line.msg === 'unhandled_api_error');
    expect(errorLine).toMatchObject({
      level: 'error',
      service: 'predinex-api',
      correlationId: 'error-correlation-789',
      error: 'boom',
    });
  });

  it('propagates the correlation ID on outgoing headers', () => {
    const headers = runWithCorrelation(
      { correlationId: 'outgoing-corr', requestId: 'outgoing-req' },
      () => injectTraceHeaders({})
    );

    expect(headers['x-correlation-id']).toBe('outgoing-corr');
    expect(headers['x-request-id']).toBe('outgoing-req');
  });
});

describe('JSON logger (Issue #1491)', () => {
  it('writes one JSON object per line with the schema and active correlation ID', () => {
    const { stdout } = captureStdio();

    runWithCorrelation({ correlationId: 'log-corr', requestId: 'log-req' }, () => {
      logger.info('test_event', { marketId: 42, amount: 10n });
    });

    const [line] = parseLines(stdout);
    expect(line).toMatchObject({
      level: 'info',
      service: 'predinex-api',
      msg: 'test_event',
      correlationId: 'log-corr',
      requestId: 'log-req',
      marketId: 42,
      amount: '10',
    });
    expect(typeof line.ts).toBe('string');
  });

  it('honours LOG_LEVEL-style filtering', () => {
    const { stdout, stderr } = captureStdio();
    setLogLevel('warn');

    logger.info('debug_or_info_is_dropped');
    logger.warn('warn_is_kept');

    expect(parseLines(stdout)).toHaveLength(0);
    expect(parseLines(stderr)).toMatchObject([
      { level: 'warn', msg: 'warn_is_kept', service: 'predinex-api' },
    ]);
  });

  it('keeps correlation context authoritative and preserves it on serialization errors', () => {
    const { stdout } = captureStdio();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    runWithCorrelation({ correlationId: 'trusted-corr', requestId: 'trusted-req' }, () => {
      logger.info('correlation_cannot_be_overridden', { correlationId: 'untrusted-corr' });
      logger.info('serialization_fallback', cyclic);
    });

    expect(parseLines(stdout)).toMatchObject([
      { msg: 'correlation_cannot_be_overridden', correlationId: 'trusted-corr' },
      {
        msg: 'serialization_fallback',
        correlationId: 'trusted-corr',
        requestId: 'trusted-req',
        logSerializationError: true,
      },
    ]);
  });
});

describe('indexer correlation (Issue #1707)', () => {
  it('assigns one correlation ID to a batch and its event logs', async () => {
    const { stdout } = captureStdio();
    const indexer = new PositionIndexer(new InMemoryPositionSource());

    await indexer.processBatch([{
      market: 1,
      account: 'GABC1234ABCD5678EFGH9012IJKL3456MNOP7890QRST1234UVWX5678YZAB',
      outcome: 0,
      amount: '5000000',
      totalYes: '5000000',
      totalNo: '0',
      txHash: 'txhash_correlation_test',
      ledgerSeq: 100,
    }]);

    const lines = parseLines(stdout).filter((line) =>
      line.msg === 'indexer_event_processed' || line.msg === 'indexer_batch_processed'
    );
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.correlationId === lines[0].correlationId)).toBe(true);
    expect(lines[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
