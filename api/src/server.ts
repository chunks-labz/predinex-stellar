/**
 * Predinex API — HTTP server bootstrap (see #1194).
 *
 * Single documented entrypoint that binds a port and serves every route
 * module mounted in `src/app.ts`:
 *
 *   npm start      -> node dist/server.js   (production, after `npm run build`)
 *   npm run dev    -> ts-node-dev src/server.ts (development with reload)
 *
 * Endpoints:
 *   GET /health         200 liveness probe
 *   GET /api/health     200 liveness probe under the API prefix
 *   /api/budget/*, /api/compliance/*, /api/emergency/*, /api/gas-estimate/*,
 *   /api/insurance/*, /api/referral/*, /api/reputation/*, /api/simulation/*
 *
 * Configuration via environment:
 *   PORT                 HTTP port (default 3001)
 *   AUTH_SECRET          HMAC secret for payload signing
 *   ADMIN_API_KEYS       comma-separated Admin API keys
 *   OFFICER_API_KEYS     comma-separated ComplianceOfficer keys
 *   ASSESSOR_API_KEYS    comma-separated Assessor keys
 */

import 'dotenv/config';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

const app = createApp();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `predinex-api v1.0.0 listening on :${PORT} (health: GET /health)`
  );
});

function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down predinex-api...`);
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log('predinex-api stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
