/**
 * Main exports for Stellar-Lend API package.
 *
 * Every route module under `src/routes/` is exported here and mounted on the
 * HTTP server in `src/app.ts` (see #1197). Previously `budget`, `emergency`,
 * `gasEstimate` and `referral` were omitted, leaving half the route surface
 * unreachable. `src/server.ts` is the runtime entrypoint; this barrel remains
 * the library entrypoint (`main: dist/index.js`).
 */

export * from './types/index.js';
export * from './config/cors.js';
export * from './app.js';
export * from './middleware/rate-limit.js';
export * from './middleware/auth.js';
export * from './middleware/security.js';
export * from './services/simulation-engine.js';
export * from './services/insurance-engine.js';
export * from './services/compliance-engine.js';
export * from './services/reputation-engine.js';
export * from './routes/simulation.js';
export * from './routes/insurance.js';
export * from './routes/compliance.js';
export * from './routes/reputation.js';
export * from './routes/budget.js';
export * from './routes/emergency.js';
export * from './routes/gasEstimate.js';
export * from './routes/referral.js';
export * from './config/swagger.js';
