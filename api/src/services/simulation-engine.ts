/**
 * Position Health Simulation Engine.
 * Implements high-precision lending calculations, price shocks, and stress scenarios.
 */

import {
  BorrowInput,
  CollateralInput,
  PositionSimulationRequest,
  PositionSimulationResponse,
  PriceShockInput,
  RiskTier,
  StressScenarioSummary,
} from '../types/index.js';
import { SecuritySanitizer } from '../middleware/security.js';

export const BPS_SCALING = 10_000n;
export const SECONDS_PER_YEAR = 31_536_000n;

export class SimulationEngine {
  /**
   * Evaluates position health and runs multi-dimensional simulations.
   */
  public static simulate(request: PositionSimulationRequest): PositionSimulationResponse {
    const computedAt = Date.now();

    // 1. Calculate Initial Position Health
    const initial = this.calculateHealth(request.collaterals, request.borrows);

    // 2. Clone and Apply Simulation Parameters (Price Shocks, Collateral Deltas, Debt Deltas, Time Deltas)
    const simulatedCollaterals: CollateralInput[] = request.collaterals.map(c => ({ ...c }));
    const simulatedBorrows: BorrowInput[] = request.borrows.map(b => ({ ...b }));

    // Apply Price Shocks
    if (request.priceShocks && Array.isArray(request.priceShocks)) {
      for (const shock of request.priceShocks) {
        // Clamp shock between -99.99% and +1000%
        const clampedShockBps = Math.max(-9999, Math.min(100_000, shock.shockBps));
        const multiplier = (10_000 + clampedShockBps) / 10_000;

        for (const col of simulatedCollaterals) {
          if (col.asset.toLowerCase() === shock.asset.toLowerCase()) {
            col.priceUsd = Math.max(0.0000001, col.priceUsd * multiplier);
          }
        }
        for (const b of simulatedBorrows) {
          if (b.asset.toLowerCase() === shock.asset.toLowerCase()) {
            b.priceUsd = Math.max(0.0000001, b.priceUsd * multiplier);
          }
        }
      }
    }

    // Apply Collateral Deltas
    if (request.collateralDeltas && Array.isArray(request.collateralDeltas)) {
      for (const delta of request.collateralDeltas) {
        const cleanDelta = BigInt(delta.deltaAmount || '0');
        for (const col of simulatedCollaterals) {
          if (col.asset.toLowerCase() === delta.asset.toLowerCase()) {
            const current = BigInt(col.amount);
            const updated = current + cleanDelta;
            col.amount = (updated > 0n ? updated : 0n).toString();
          }
        }
      }
    }

    // Apply Debt Deltas
    if (request.debtDeltas && Array.isArray(request.debtDeltas)) {
      for (const delta of request.debtDeltas) {
        const cleanDelta = BigInt(delta.deltaAmount || '0');
        for (const b of simulatedBorrows) {
          if (b.asset.toLowerCase() === delta.asset.toLowerCase()) {
            const current = BigInt(b.borrowedAmount);
            const updated = current + cleanDelta;
            b.borrowedAmount = (updated > 0n ? updated : 0n).toString();
          }
        }
      }
    }

    // Apply Time Delta & Accrued Interest
    const timeDeltaSeconds = BigInt(Math.max(0, request.timeDeltaSeconds ?? 0));
    if (timeDeltaSeconds > 0n) {
      for (const b of simulatedBorrows) {
        const principal = BigInt(b.borrowedAmount);
        const rateBps = BigInt(b.borrowRateBps);
        if (principal > 0n && rateBps > 0n) {
          const interestNum = principal * rateBps * timeDeltaSeconds;
          const interestDen = BPS_SCALING * SECONDS_PER_YEAR;
          const accrued = interestNum / interestDen;
          const existingAccrued = BigInt(b.accruedInterest || '0');
          b.accruedInterest = (existingAccrued + accrued).toString();
        }
      }
    }

    // 3. Compute Simulated Health
    const simulated = this.calculateHealth(simulatedCollaterals, simulatedBorrows);

    // 4. Run Standard Stress Test Scenarios
    const stressScenarios: StressScenarioSummary[] = [
      this.runStressScenario('Mild Market Dip (-10% Col, +5% Debt)', simulatedCollaterals, simulatedBorrows, -1000, 500),
      this.runStressScenario('Moderate Correction (-25% Col, +10% Debt)', simulatedCollaterals, simulatedBorrows, -2500, 1000),
      this.runStressScenario('Severe Black Swan (-50% Col, +20% Debt)', simulatedCollaterals, simulatedBorrows, -5000, 2000),
    ];

    // Liquidation Price calculation for primary collateral asset
    let liquidationPriceUsd: number | undefined = undefined;
    if (simulatedCollaterals.length === 1 && simulatedBorrows.length >= 1) {
      const col = simulatedCollaterals[0];
      const colAmount = parseFloat(col.amount);
      const liqThreshold = col.liquidationThresholdBps / 10_000;
      if (colAmount > 0 && liqThreshold > 0) {
        liquidationPriceUsd = simulated.simulatedDebtUsd / (colAmount * liqThreshold);
      }
    }

    const shortfallUsd = simulated.isLiquidatable
      ? Math.max(0, simulated.simulatedDebtUsd - simulated.simulatedLiquidationThresholdUsd)
      : 0;

    return {
      initialHealthFactorBps: initial.simulatedHealthFactorBps,
      initialHealthFactor: initial.simulatedHealthFactor,
      simulatedHealthFactorBps: simulated.simulatedHealthFactorBps,
      simulatedHealthFactor: simulated.simulatedHealthFactor,
      simulatedCollateralUsd: simulated.simulatedCollateralUsd,
      simulatedDebtUsd: simulated.simulatedDebtUsd,
      simulatedLiquidationThresholdUsd: simulated.simulatedLiquidationThresholdUsd,
      simulatedRiskTier: simulated.simulatedRiskTier,
      isLiquidatable: simulated.isLiquidatable,
      shortfallUsd,
      maxWithdrawableUsd: simulated.maxWithdrawableUsd,
      maxBorrowableUsd: simulated.maxBorrowableUsd,
      liquidationPriceUsd,
      stressScenarios,
      computedAt,
    };
  }

  /**
   * Pure health calculation from collaterals and borrows.
   */
  public static calculateHealth(
    collaterals: CollateralInput[],
    borrows: BorrowInput[]
  ) {
    let totalCollateralUsd = 0;
    let liquidationThresholdUsd = 0;
    let maxBorrowUsd = 0;

    for (const col of collaterals) {
      const amount = Math.max(0, parseFloat(col.amount || '0'));
      const price = SecuritySanitizer.sanitizePositiveNumber(col.priceUsd, 0);
      const assetVal = amount * price;

      totalCollateralUsd += assetVal;
      liquidationThresholdUsd += (assetVal * (col.liquidationThresholdBps || 0)) / 10_000;
      maxBorrowUsd += (assetVal * (col.collateralFactorBps || 0)) / 10_000;
    }

    let totalDebtUsd = 0;
    for (const b of borrows) {
      const principal = Math.max(0, parseFloat(b.borrowedAmount || '0'));
      const accrued = Math.max(0, parseFloat(b.accruedInterest || '0'));
      const totalUnits = principal + accrued;
      const price = SecuritySanitizer.sanitizePositiveNumber(b.priceUsd, 0);
      totalDebtUsd += totalUnits * price;
    }

    let simulatedHealthFactorBps = 100_000; // 10.0 default if no debt
    let simulatedHealthFactor = 10.0;

    if (totalDebtUsd > 0) {
      simulatedHealthFactor = liquidationThresholdUsd / totalDebtUsd;
      simulatedHealthFactorBps = Math.min(100_000, Math.max(1, Math.floor(simulatedHealthFactor * 10_000)));
    }

    let simulatedRiskTier: RiskTier = 'Safe';
    if (simulatedHealthFactorBps < 10_000) {
      simulatedRiskTier = 'Liquidatable';
    } else if (simulatedHealthFactorBps < 12_000) {
      simulatedRiskTier = 'AtRisk';
    } else if (simulatedHealthFactorBps < 15_000) {
      simulatedRiskTier = 'Caution';
    } else {
      simulatedRiskTier = 'Safe';
    }

    const isLiquidatable = simulatedHealthFactorBps < 10_000;

    const maxBorrowableUsd = Math.max(0, maxBorrowUsd - totalDebtUsd);
    const maxWithdrawableUsd = totalDebtUsd === 0
      ? totalCollateralUsd
      : Math.max(0, liquidationThresholdUsd - totalDebtUsd);

    return {
      simulatedHealthFactorBps,
      simulatedHealthFactor: Math.max(0.0001, Math.round(simulatedHealthFactor * 10000) / 10000),
      simulatedCollateralUsd: Math.round(totalCollateralUsd * 100) / 100,
      simulatedDebtUsd: Math.round(totalDebtUsd * 100) / 100,
      simulatedLiquidationThresholdUsd: Math.round(liquidationThresholdUsd * 100) / 100,
      simulatedRiskTier,
      isLiquidatable,
      maxWithdrawableUsd: Math.round(maxWithdrawableUsd * 100) / 100,
      maxBorrowableUsd: Math.round(maxBorrowableUsd * 100) / 100,
    };
  }

  private static runStressScenario(
    name: string,
    collaterals: CollateralInput[],
    borrows: BorrowInput[],
    colShockBps: number,
    debtShockBps: number
  ): StressScenarioSummary {
    const stressedCols = collaterals.map(c => ({
      ...c,
      priceUsd: Math.max(0.0000001, c.priceUsd * ((10_000 + colShockBps) / 10_000)),
    }));
    const stressedBorrows = borrows.map(b => ({
      ...b,
      priceUsd: Math.max(0.0000001, b.priceUsd * ((10_000 + debtShockBps) / 10_000)),
    }));

    const res = this.calculateHealth(stressedCols, stressedBorrows);

    return {
      name,
      collateralShockPct: colShockBps / 100,
      debtShockPct: debtShockBps / 100,
      simulatedHealthFactorBps: res.simulatedHealthFactorBps,
      simulatedHealthFactor: res.simulatedHealthFactor,
      riskTier: res.simulatedRiskTier,
      isLiquidatable: res.isLiquidatable,
    };
  }
}
