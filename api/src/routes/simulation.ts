/**
 * Position Health Simulation API Route.
 * Technical Scope: api/src/routes/simulation.ts
 */

import { Router, Request, Response } from 'express';
import { PositionSimulationRequest, ApiResponse, PositionSimulationResponse, SimulationWarning } from '../types/index.js';
import { SimulationEngine } from '../services/simulation-engine.js';
import { SecuritySanitizer } from '../middleware/security.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';

/** Documented defaults applied only when a parameter is absent or unparseable. */
export const DEFAULT_LIQUIDATION_THRESHOLD_BPS = 8000;
export const DEFAULT_COLLATERAL_FACTOR_BPS = 7500;
export const DEFAULT_BORROW_RATE_BPS = 500;

export class SimulationRouteHandler {
  /**
   * Handles POST /api/simulation/position-health
   */
  public static handleSimulate(body: any): ApiResponse<PositionSimulationResponse> {
    if (!SecuritySanitizer.isSafeJson(body)) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_INPUT',
          message: 'Invalid payload structure detected',
        },
        timestamp: Date.now(),
      };
    }

    if (!body.collaterals || !Array.isArray(body.collaterals) || body.collaterals.length === 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_COLLATERALS',
          message: 'Simulation requires at least one valid collateral asset',
        },
        timestamp: Date.now(),
      };
    }

    if (!body.borrows || !Array.isArray(body.borrows)) {
      body.borrows = [];
    }

    // Input validation and sanitation.
    //
    // Numeric parameters distinguish "absent or unparseable" (the documented
    // default applies, and is reported in `warnings`) from an explicit value.
    // `0` is an explicit value: `parseInt(x) || default` would turn it into the
    // default (issues #1214, #1215).
    const warnings: SimulationWarning[] = [];

    const collaterals = body.collaterals.map((c: any) => {
      const asset = String(c.asset || 'XLM');
      const liq = SecuritySanitizer.sanitizeBps(c.liquidationThresholdBps, DEFAULT_LIQUIDATION_THRESHOLD_BPS);
      const factor = SecuritySanitizer.sanitizeBps(c.collateralFactorBps, DEFAULT_COLLATERAL_FACTOR_BPS);

      if (liq.defaulted) {
        warnings.push({
          code: 'DEFAULT_APPLIED',
          asset,
          field: 'liquidationThresholdBps',
          appliedValue: liq.value,
          message: `liquidationThresholdBps was missing or invalid for ${asset}; the default ${liq.value} was used`,
        });
      } else if (liq.value === 0) {
        warnings.push({
          code: 'ZERO_LIQUIDATION_THRESHOLD',
          asset,
          field: 'liquidationThresholdBps',
          message: `${asset} has a liquidation threshold of 0 and contributes nothing to the position's safety margin`,
        });
      }
      if (factor.defaulted) {
        warnings.push({
          code: 'DEFAULT_APPLIED',
          asset,
          field: 'collateralFactorBps',
          appliedValue: factor.value,
          message: `collateralFactorBps was missing or invalid for ${asset}; the default ${factor.value} was used`,
        });
      } else if (factor.value === 0) {
        warnings.push({
          code: 'ZERO_COLLATERAL_FACTOR',
          asset,
          field: 'collateralFactorBps',
          message: `${asset} has a collateral factor of 0 and adds no borrowing capacity`,
        });
      }

      return {
        asset,
        amount: SecuritySanitizer.sanitizeBigIntString(String(c.amount || '0')),
        priceUsd: SecuritySanitizer.sanitizePositiveNumber(c.priceUsd, 1.0),
        liquidationThresholdBps: liq.value,
        collateralFactorBps: factor.value,
      };
    });

    const borrows = body.borrows.map((b: any) => {
      const asset = String(b.asset || 'USDC');
      const rate = SecuritySanitizer.sanitizeBps(b.borrowRateBps, DEFAULT_BORROW_RATE_BPS);
      if (rate.defaulted) {
        warnings.push({
          code: 'DEFAULT_APPLIED',
          asset,
          field: 'borrowRateBps',
          appliedValue: rate.value,
          message: `borrowRateBps was missing or invalid for ${asset}; the default ${rate.value} was used`,
        });
      }
      return {
        asset,
        borrowedAmount: SecuritySanitizer.sanitizeBigIntString(String(b.borrowedAmount || '0')),
        priceUsd: SecuritySanitizer.sanitizePositiveNumber(b.priceUsd, 1.0),
        borrowRateBps: rate.value,
        accruedInterest: SecuritySanitizer.sanitizeBigIntString(String(b.accruedInterest || '0')),
        lastAccrualTime: SecuritySanitizer.parseIntegerField(b.lastAccrualTime) ?? 0,
      };
    });

    const priceShocks = Array.isArray(body.priceShocks)
      ? body.priceShocks.map((s: any) => ({
          asset: String(s.asset || ''),
          shockBps: SecuritySanitizer.sanitizeBps(s.shockBps, 0, -9999, 100_000).value,
        }))
      : undefined;

    const request: PositionSimulationRequest = {
      positionId: body.positionId ? String(body.positionId) : undefined,
      userAddress: body.userAddress ? String(body.userAddress) : undefined,
      collaterals,
      borrows,
      priceShocks,
      collateralDeltas: body.collateralDeltas,
      debtDeltas: body.debtDeltas,
      timeDeltaSeconds: SecuritySanitizer.sanitizePositiveNumber(body.timeDeltaSeconds, 0),
    };

    try {
      const result = SimulationEngine.simulate(request);
      return {
        success: true,
        data: warnings.length > 0 ? { ...result, warnings } : result,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: 'SIMULATION_ERROR',
          message: err.message || 'Internal simulation error occurred',
        },
        timestamp: Date.now(),
      };
    }
  }
}

/**
 * Express router mounting simulation endpoints.
 * Mount at `/api/simulation` (see `src/app.ts`).
 */
export const simulationRouter = Router();

simulationRouter.use(authMiddleware);
simulationRouter.use(rateLimitMiddleware);

simulationRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Simulation API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

function sendSimulate(req: Request, res: Response): void {
  const result = SimulationRouteHandler.handleSimulate(req.body);
  res.status(result.success ? 200 : 400).json(result);
}

simulationRouter.post('/simulate', sendSimulate);
simulationRouter.post('/position-health', sendSimulate);

export default simulationRouter;
