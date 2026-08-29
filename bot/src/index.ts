/**
 * Predinex Settlement Bot — Entry Point
 *
 * Usage:
 *   node dist/index.js           # normal run
 *   DRY_RUN=true node dist/index.js  # dry-run mode
 *
 * Environment variables are loaded from .env (if present).
 * See .env.example for the full configuration reference.
 */

import { loadConfig } from "./config.js";
import { setLogLevel, logger } from "./logger.js";
import { Poller } from "./poller.js";
import { HealthServer } from "./health.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info("Predinex Settlement Bot initialising", {
    version: "1.0.0",
    network: config.network,
    contractId: config.contractId,
    dryRun: config.dryRun,
    autoSettleEnabled: config.autoSettleEnabled,
    pollIntervalMs: config.pollIntervalMs,
    batchSize: config.batchSize,
    maxRetries: config.maxRetries,
    webhook: config.webhookUrl ? "configured" : "disabled",
    healthCheck: config.healthCheckEnabled
      ? `enabled on port ${config.healthCheckPort}`
      : "disabled",
  });

  if (config.dryRun) {
    logger.warn(
      "DRY-RUN mode is active — no transactions will be submitted",
    );
  }

  if (!config.autoSettleEnabled) {
    logger.warn(
      "AUTO_SETTLE_ENABLED=false — bot will log expired pools but NOT settle them. " +
        "Set AUTO_SETTLE_ENABLED=true to enable automatic settlement.",
    );
  }

  const poller = new Poller(config);

  let healthServer: HealthServer | null = null;
  if (config.healthCheckEnabled) {
    healthServer = new HealthServer(poller, config.healthCheckPort);
    await healthServer.start();
  } else {
    logger.info("Health check server disabled (HEALTH_CHECK_ENABLED=false)");
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;
  let hadErrors = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully…`);
    poller.stop();
    void healthServer?.stop();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    hadErrors = true;
    logger.error("Uncaught exception", {
      error: String(err),
      stack: err.stack,
    });
    // Give the logger a chance to flush, then exit with error code
    setTimeout(() => process.exit(1), 200);
  });

  process.on("unhandledRejection", (reason) => {
    hadErrors = true;
    logger.error("Unhandled promise rejection", { reason: String(reason) });
    setTimeout(() => process.exit(1), 200);
  });

  await poller.start();

  const { errorCount } = poller.getMetrics();
  const exitCode = hadErrors || errorCount > 0 ? 1 : 0;
  if (exitCode !== 0) {
    logger.warn("Exiting with non-zero status due to errors during operation", {
      uncaughtErrors: hadErrors,
      settlementErrors: errorCount,
    });
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
