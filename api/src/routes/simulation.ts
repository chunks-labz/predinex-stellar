/**
 * Position Health Simulation API Route.
 * Technical Scope: api/src/routes/simulation.ts
 */

import { PositionSimulationRequest, ApiResponse, PositionSimulationResponse } from '../types/index.js';
import { SimulationEngine } from '../services/simulation-engine.js';
import { SecuritySanitizer } from '../middleware/security.js';

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

    // Input validation and sanitation
    const collaterals = body.collaterals.map((c: any) => ({
      asset: String(c.asset || 'XLM'),
      amount: SecuritySanitizer.sanitizeBigIntString(String(c.amount || '0')),
      priceUsd: SecuritySanitizer.sanitizePositiveNumber(c.priceUsd, 1.0),
      liquidationThresholdBps: Math.min(10_000, Math.max(0, parseInt(c.liquidationThresholdBps) || 8000)),
      collateralFactorBps: Math.min(10_000, Math.max(0, parseInt(c.collateralFactorBps) || 7500)),
    }));

    const borrows = body.borrows.map((b: any) => ({
      asset: String(b.asset || 'USDC'),
      borrowedAmount: SecuritySanitizer.sanitizeBigIntString(String(b.borrowedAmount || '0')),
      priceUsd: SecuritySanitizer.sanitizePositiveNumber(b.priceUsd, 1.0),
      borrowRateBps: Math.min(10_000, Math.max(0, parseInt(b.borrowRateBps) || 500)),
      accruedInterest: SecuritySanitizer.sanitizeBigIntString(String(b.accruedInterest || '0')),
      lastAccrualTime: parseInt(b.lastAccrualTime) || 0,
    }));

    const priceShocks = Array.isArray(body.priceShocks)
      ? body.priceShocks.map((s: any) => ({
          asset: String(s.asset || ''),
          shockBps: Math.max(-9999, Math.min(100_000, parseInt(s.shockBps) || 0)),
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
        data: result,
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
