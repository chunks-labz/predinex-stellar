/**
 * Webhook notification support.
 *
 * On successful settlement (or in dry-run mode) POSTs a JSON payload to
 * the configured WEBHOOK_URL. Optionally signs the payload body with an
 * HMAC-SHA256 signature derived from WEBHOOK_SECRET and includes it as the
 * `X-Predinex-Signature` header so receivers can verify authenticity.
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
import type { BotConfig } from "./config.js";
import type { SettlementAttempt } from "./types.js";
import { logger } from "./logger.js";

export interface WebhookPayload {
  event: "settlement_cycle";
  ts: string;
  network: string;
  contractId: string;
  dryRun: boolean;
  settlements: Array<{
    poolId: number;
    winningOutcome: number;
    txHash?: string;
    success: boolean;
    error?: string;
  }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * Build the signature header value for a given body string.
 * Format: sha256=<hex digest>
 */
function buildSignature(body: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf-8");
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Fire-and-forget webhook notification.
 * Errors are logged but never thrown so a webhook failure never kills the bot.
 */
export async function notify(
  config: BotConfig,
  settlements: SettlementAttempt[],
): Promise<void> {
  if (!config.webhookUrl) return;

  const payload: WebhookPayload = {
    event: "settlement_cycle",
    ts: new Date().toISOString(),
    network: config.network,
    contractId: config.contractId,
    dryRun: config.dryRun,
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

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000), // 10 s timeout
    });

    if (!response.ok) {
      logger.warn("Webhook delivery failed (non-2xx response)", {
        status: response.status,
        url: config.webhookUrl,
      });
    } else {
      logger.debug("Webhook delivered", {
        status: response.status,
        url: config.webhookUrl,
        settlements: payload.summary,
      });
    }
  } catch (err) {
    logger.warn("Webhook delivery error (will not retry)", {
      url: config.webhookUrl,
      error: String(err),
    });
  }
}
