/**
 * Structured logger for the settlement bot.
 *
 * Outputs JSON-formatted log lines to stdout/stderr so they are easily parsed
 * by log aggregators (Datadog, Logtail, etc.).
 *
 * Every line includes the active correlation ID (inherited from the API request
 * that enqueued the job, or generated once per settlement cycle), so API and
 * worker logs can be joined on a single ID. See docs/LOGGING.md.
 *
 * Format:
 *   { "ts": "<ISO-8601>", "level": "info", "service": "predinex-settlement-bot",
 *     "msg": "...", "correlationId": "...", "traceId": "...", ...fields }
 */

import type { LogLevel } from "./config.js";
import { getActiveSpanContext } from "./tracing.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SERVICE_NAME = "predinex-settlement-bot";

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function serializableReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function emit(
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const spanCtx = getActiveSpanContext();
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    msg,
    ...(spanCtx
      ? {
          correlationId: spanCtx.correlationId,
          traceId: spanCtx.traceId,
          spanId: spanCtx.spanId,
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

  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
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
    emit("debug", msg, fields);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit("error", msg, fields);
  },
};
