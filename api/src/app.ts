/**
 * Predinex API — Express application factory.
 *
 * Builds the HTTP server that mounts all eight route modules under `/api/*`
 * (see #1194, #1197) with authentication and rate limiting applied to every
 * route (see #1196):
 *
 *   /api/budget       budget planner (plan, portfolio, liquidity, fees, risk)
 *   /api/compliance   compliance checks + officer-gated registration
 *   /api/emergency    emergency controls (admin-gated mutations, real txs)
 *   /api/gas-estimate gas estimation + optimization suggestions
 *   /api/insurance    insurance pools, quotes, purchases, claims
 *   /api/markets      paginated market list (limit/offset, see #1420)
 *   /api/positions    indexed place_bet positions (see #1425)
 *   /api/referral     validated, authenticated referral registration
 *   /api/reputation   reputation profiles, simulation, leaderboard
 *   /api/simulation   position-health simulation
 *
 * CORS uses the explicit allowlist in `config/cors.ts` (see #1200, no
 * wildcard origins). Health:
 *   GET /health      dependency readiness probe (200 healthy / 503 degraded)
 *   GET /api/health  same payload under the API prefix
 *   GET /api/openapi.json  OpenAPI document served from config/swagger
 *
 * Issue #1295: Balance provider is wired before mounting budget router
 */

import express, { Express, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsMiddleware } from './config/cors.js';
import { createBudgetRouter, contractService } from './routes/budget.js';
import { complianceRouter } from './routes/compliance.js';
import { emergencyRouter } from './routes/emergency.js';
import { gasEstimateRouter } from './routes/gasEstimate.js';
import { insuranceRouter } from './routes/insurance.js';
import { marketsRouter } from './routes/markets.js';
import { positionsRouter } from './routes/positions.js';
import { createReferralRouter, defaultReferralService } from './routes/referral.js';
import { reputationRouter } from './routes/reputation.js';
import { simulationRouter } from './routes/simulation.js';
import { rateLimitMiddleware, setDefaultTokenVerifier } from './middleware/rate-limit.js';
import { sharedAuthValidator } from './middleware/auth.js';
import { tracingMiddleware } from './middleware/tracing.js';
import { versioningMiddleware } from './middleware/versioning.js';
import { openApiDoc } from './config/swagger.js';
import { getHealthReport } from './services/health.js';

export const API_VERSION = '1.0.0';

async function healthPayload() {
  const report = await getHealthReport();
  return {
    success: report.status === 'healthy',
    status: report.status,
    service: 'predinex-api',
    version: API_VERSION,
    uptimeSecs: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: report.dependencies,
    healthCachedAt: report.cachedAt,
  };
}

// ============================================================================
// Balance Provider Wiring (Issue #1295)
// ============================================================================

/**
 * Example balance provider using Stellar SDK
 * Replace with actual implementation
 * 
 * Issue #1295: This must be wired before mounting budget router
 */
async function getStellarBalance(address: string): Promise<bigint> {
  // TODO: Implement actual Stellar SDK call
  // Example:
  // const server = new Server('https://horizon.stellar.org');
  // const account = await server.loadAccount(address);
  // const xlmBalance = account.balances.find(b => b.asset_type === 'native');
  // return BigInt(Math.floor(parseFloat(xlmBalance?.balance || '0') * 10000000));
  
  // Temporary mock for development
  return BigInt(1000000000000); // 100,000 XLM in stroops
}

// Wire the balance provider before creating app
// Issue #1295: Required for /api/budget/plan to work
contractService.setBalanceProvider(getStellarBalance);

/**
 * Creates and configures the Express application instance.
 * Installs CORS ahead of routes with explicit configuration.
 */
export function createApp(tradeHistorySource?: TradeHistorySource): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());

  // 1. Install CORS middleware ahead of all routes (explicit allowlist, no '*').
  app.use(corsMiddleware);

  // 2. Request body parsing + logging.
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('combined'));

  // Opt-in OpenTelemetry request spans (see #1426); a no-op unless tracing is
  // enabled via OTEL_TRACING_ENABLED.
  app.use(tracingMiddleware);

  // API versioning & deprecation policy (URI `/api/v1/*` + header negotiation
  // and RFC 8594 `Deprecation` / `Sunset` headers on deprecated endpoints).
  app.use(versioningMiddleware);

  // Global rate limiting; routers add auth + stricter per-route limits.
  // Registered API keys get their own bucket; everyone else is limited per IP
  // (see #1423).
  setDefaultTokenVerifier((apiKey) => sharedAuthValidator.isRegisteredKey(apiKey));
  app.use(rateLimitMiddleware);

  // 3. Health / readiness probes (#1429).
  //
  // /healthz  — liveness probe. Always 200 when the process is up. Used by
  //             Kubernetes livenessProbe / Docker HEALTHCHECK to decide when
  //             to restart a container.
  //
  // /readyz   — readiness probe. 200 only when all required configuration is
  //             present and the service can handle traffic. Returns 503 with a
  //             JSON body listing failing checks when the service is not ready.
  //             Used by Kubernetes readinessProbe to gate traffic routing.
  //
  // /health and /api/health are kept as backwards-compatible aliases.
  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/readyz', (_req: Request, res: Response) => {
    const checks: Record<string, { ok: boolean; reason?: string }> = {};

    // Check 1 — required environment variables are set.
    const missingEnv: string[] = [];
    const required = ['NODE_ENV'];
    for (const key of required) {
      if (!process.env[key]) missingEnv.push(key);
    }
    checks.config = missingEnv.length === 0
      ? { ok: true }
      : { ok: false, reason: `missing env vars: ${missingEnv.join(', ')}` };

    // Check 2 — API version constant is reachable (module-level sanity).
    checks.api = { ok: Boolean(API_VERSION) };

    const allOk = Object.values(checks).every((c) => c.ok);
    const statusCode = allOk ? 200 : 503;
    res.status(statusCode).json({
      status: allOk ? 'ok' : 'unavailable',
      checks,
      ...(allOk ? {} : { timestamp: new Date().toISOString() }),
    });
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json(healthPayload());
  // 3. Health checks.
  app.get('/health', async (_req: Request, res: Response) => {
    const payload = await healthPayload();
    res.status(payload.status === 'healthy' ? 200 : 503).json(payload);
  });
  app.get('/api/health', async (_req: Request, res: Response) => {
    const payload = await healthPayload();
    res.status(payload.status === 'healthy' ? 200 : 503).json(payload);
  });
  app.get('/api/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiDoc);
  });

  // 4. Mount routes (all eight modules).
  // Issue #1295: Balance provider wired above before mounting budget router
  app.use('/api/budget', createBudgetRouter(contractService));
  app.use('/api/compliance', complianceRouter);
  app.use('/api/emergency', emergencyRouter);
  app.use('/api/gas-estimate', gasEstimateRouter);
  app.use('/api/insurance', insuranceRouter);
  app.use('/api/markets', marketsRouter);
  app.use('/api/positions', positionsRouter);
  app.use('/api/referral', createReferralRouter(defaultReferralService));
  app.use('/api/reputation', reputationRouter);
  app.use('/api/simulation', simulationRouter);

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Unknown API route' },
      timestamp: new Date().toISOString(),
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('Unhandled API error:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err?.message || 'Internal server error',
      },
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

export const app = createApp();
export default app;
