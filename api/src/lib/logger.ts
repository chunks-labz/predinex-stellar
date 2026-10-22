/**
 * Structured JSON logger for the Predinex API (Issue #1491).
 *
 * Every line is a single JSON object. When called while handling a request (or
 * a job that inherited a correlation context), the active `correlationId`,
 * `requestId`, and any trace IDs are attached automatically, so an operator can
 * grep one ID and follow the request across API handlers, workers, and
 * settlement steps.
 *
 * Schema (also documented in docs/LOGGING.md):
 *   ts            ISO-8601 timestamp
 *   level         debug | info | warn | error
 *   service       always "predinex-api"
 *   msg           stable, machine-readable event name / message
 *   correlationId request/job correlation ID (when in scope)
 *   requestId     client request ID (when in scope)
 *   traceId       W3C trace ID (when known)
 *   spanId        W3C parent span ID (when known)
 *   ...fields     event-specific fields
 */

import { getCorrelationContext } from './correlation.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SERVICE_NAME = 'predinex-api';

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error'
    ? normalized
    : 'info';
}

let currentLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function serializableReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function writeLine(level: LogLevel, line: string): void {
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const context = getCorrelationContext();
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    msg,
    ...(context
      ? {
          correlationId: context.correlationId,
          requestId: context.requestId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
          ...(context.spanId ? { spanId: context.spanId } : {}),
        }
      : {}),
    ...fields,
  };

  let line: string;
  try {
    line = JSON.stringify(entry, serializableReplacer);
  } catch {
    line = JSON.stringify({
      ts: entry.ts,
      level,
      service: SERVICE_NAME,
      msg,
      logSerializationError: true,
    });
  }

  writeLine(level, line);
}

/** Extracts a log-safe error shape without leaking non-enumerable details. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      error: error.message,
      errorName: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { error: String(error) };
}

export const logger = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    emit('debug', msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit('error', msg, fields);
  },
};
