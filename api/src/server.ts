/**
 * Predinex API - HTTP server bootstrap (see #1194).
 *
 * Single documented entrypoint that binds a port and serves every route
 * module mounted in `src/app.ts`:
 *
 *   npm start      -> node dist/server.js   (production, after `npm run build`)
 *   npm run dev    -> ts-node-dev src/server.ts (development with reload)
 *
 * Endpoints:
 *   GET /health         dependency readiness probe (200/503)
 *   GET /api/health     dependency readiness probe under the API prefix
 *   /api/budget/*, /api/compliance/*, /api/emergency/*, /api/gas-estimate/*,
 *   /api/insurance/*, /api/referral/*, /api/reputation/*, /api/simulation/*
 *
 * Configuration via environment:
 *   PORT                 HTTP port (default 3001)
 *   AUTH_SECRET          HMAC secret for payload signing (required; the
 *                        process exits at startup when it is unset)
 *   ADMIN_API_KEYS       comma-separated Admin API keys
 *   OFFICER_API_KEYS     comma-separated ComplianceOfficer keys
 *   ASSESSOR_API_KEYS    comma-separated Assessor keys
 *   OTEL_TRACING_ENABLED set to "true" to export OpenTelemetry traces
 *                        (disabled by default; see src/middleware/tracing.ts)
 *   HEALTH_*_URL        optional database, RPC, and queue health URLs
 *   HEALTH_CACHE_MS     dependency probe cache duration (default 5000)
 */

import 'dotenv/config';
import { createApp } from './app.js';
import { initTracing, shutdownTracing } from './middleware/tracing.js';
import { logger, serializeError } from './lib/logger.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

initTracing();

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info('server_started', {
    version: '1.0.0',
    port: PORT,
    health: 'GET /health',
  });
});

function shutdown(signal: string) {
  logger.info('server_stopping', { signal });
  server.close(() => {
    shutdownTracing()
      .catch((error) => logger.error('tracing_shutdown_failed', serializeError(error)))
      .finally(() => {
        logger.info('server_stopped');
        process.exit(0);
      });
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
