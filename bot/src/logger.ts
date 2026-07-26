/**
 * Structured logger for the settlement bot.
 *
 * Outputs JSON-formatted log lines to stdout/stderr so they are easily parsed
 * by log aggregators (Datadog, Logtail, etc.).
 *
 * Format:
 *   { "ts": "<ISO-8601>", "level": "info", "msg": "...", ...fields }
 */

import type { LogLevel } from "./config.js";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function emit(
  level: LogLevel,
  msg: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };

  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
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
