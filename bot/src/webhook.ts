/**
 * Webhook notification support.
 *
 * On successful settlement (or in dry-run mode) POSTs a JSON payload to
 * the configured WEBHOOK_URL. Optionally signs the payload body with an
 * HMAC-SHA256 signature derived from WEBHOOK_SECRET and includes it as the
 * `X-Predinex-Signature` header so receivers can verify authenticity.
 *
 * Includes retry with exponential backoff (3 attempts with jittered delays)
 * and a file-based dead-letter queue for permanently failed deliveries.
 *
 * Payload format:
 * {
 *   "event": "settlement_cycle",
 *   "ts": "<ISO-8601>",
 *   "network": "testnet" | "mainnet",
 *   "contractId": "...",
 *   "dryRun": boolean,
 *   "settlements": [
 *     { "poolId": 1, "winningOutcome": 0, "txHash": "...", "success": true }
 *   ],
 *   "summary": { "attempted": 3, "succeeded": 3, "failed": 0 }
 * }
 */

import { createHmac } from "crypto";
import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { BotConfig } from "./config.js";
import type { SettlementAttempt, SettlementCycleContext } from "./types.js";
import { logger } from "./logger.js";
import { withRetry } from "./retry.js";

export interface WebhookPayload {
  event: "settlement_cycle";
  ts: string;
  network: string;
  contractId: string;
  dryRun: boolean;
  /** Which poller cycle produced this settlement. */
  cycleNumber: number;
  /** Which bot instance settled these pools. */
  instanceId: string;
  /** ISO 8601 timestamp of when settlement completed. */
  settlementTimestamp: string;
  settlements: Array<{
    poolId: number;
    winningOutcome: number;
    txHash?: string;
    success: boolean;
    error?: string;
    /** Estimated gas used from simulation, if available. */
    gasUsed?: number;
  }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

interface DeadLetterEntry {
  timestamp: string;
  url: string;
  payload: WebhookPayload;
  lastError: string;
}

// ---------------------------------------------------------------------------
// Failure metrics
// ---------------------------------------------------------------------------

let totalFailures = 0;

/** Returns the current webhook failure count (reset per process lifetime). */
export function getWebhookFailureCount(): number {
  return totalFailures;
}

// ---------------------------------------------------------------------------
// Dead-letter queue (append-only JSON-lines file)
// ---------------------------------------------------------------------------

const DEAD_LETTER_PATH = "data/webhook-dead-letter.jsonl";

function persistDeadLetter(
  url: string,
  payload: WebhookPayload,
  lastError: string,
): void {
  try {
    const dir = dirname(DEAD_LETTER_PATH);
    mkdirSync(dir, { recursive: true });

    const entry: DeadLetterEntry = {
      timestamp: new Date().toISOString(),
      url,
      payload,
      lastError,
    };
    appendFileSync(DEAD_LETTER_PATH, JSON.stringify(entry) + "\n", "utf-8");
    logger.warn("Webhook payload persisted to dead-letter queue", {
      path: DEAD_LETTER_PATH,
      cycleNumber: payload.cycleNumber,
    });
  } catch (writeErr) {
    logger.error("Failed to write webhook dead-letter entry", {
      error: String(writeErr),
    });
  }
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

/**
 * Build the signature header value for a given body string.
 * Format: sha256=<hex digest>
 */
function buildSignature(body: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf-8");
  return `sha256=${hmac.digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

const WEBHOOK_MAX_RETRIES = 3;
const WEBHOOK_RETRY_BASE_DELAY_MS = 1_000;

/**
 * Send a webhook notification with retry and dead-letter fallback.
 *
 * - Retries up to 3 times with exponential backoff + jitter.
 * - On final failure, persists the payload to a dead-letter file.
 * - Increments a failure counter for monitoring.
 * - Never throws, so a webhook failure never kills the bot.
 */
export async function notify(
  config: BotConfig,
  settlements: SettlementAttempt[],
  cycleContext: SettlementCycleContext,
): Promise<void> {
  if (!config.webhookUrl) return;

  const payload: WebhookPayload = {
    event: "settlement_cycle",
    ts: new Date().toISOString(),
    network: config.network,
    contractId: config.contractId,
    dryRun: config.dryRun,
    cycleNumber: cycleContext.cycleNumber,
    instanceId: cycleContext.instanceId,
    settlementTimestamp: cycleContext.settlementTimestamp,
    settlements: settlements.map((s) => ({
      poolId: s.poolId,
      winningOutcome: s.winningOutcome,
      txHash: s.txHash,
      success: s.success,
      error: s.error,
    })),
    summary: {
      attempted: settlements.length,
      succeeded: settlements.filter((s) => s.success).length,
      failed: settlements.filter((s) => !s.success).length,
    },
  };

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "predinex-settlement-bot/1.0",
  };

  if (config.webhookSecret) {
    headers["X-Predinex-Signature"] = buildSignature(body, config.webhookSecret);
  }

  let lastError: string | undefined;

  try {
    await withRetry(
      async () => {
        const response = await fetch(config.webhookUrl!, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(config.webhookTimeoutMs),
        });

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }

        logger.debug("Webhook delivered", {
          status: response.status,
          url: config.webhookUrl,
          settlements: payload.summary,
        });
      },
      {
        maxRetries: WEBHOOK_MAX_RETRIES,
        baseDelayMs: WEBHOOK_RETRY_BASE_DELAY_MS,
        label: "webhook-delivery",
        shouldRetry: (err) => {
          const msg = String(err);
          return !msg.includes("returned 4");
        },
      },
    );
  } catch (err) {
    lastError = String(err);
    totalFailures++;

    logger.error("Webhook delivery failed permanently after retries", {
      url: config.webhookUrl,
      attempts: WEBHOOK_MAX_RETRIES + 1,
      error: lastError,
      totalFailures,
      cycleNumber: payload.cycleNumber,
    });

    persistDeadLetter(config.webhookUrl, payload, lastError);
  }
}
