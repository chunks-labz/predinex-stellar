import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SimulationEngine } from '../src/services/simulation-engine.js';
import { SimulationRouteHandler } from '../src/routes/simulation.js';
import { PositionSimulationRequest } from '../src/types/index.js';

describe('SimulationEngine Unit & Integration Tests', () => {
  it('correctly calculates healthy position (HF > 1.5 => Safe)', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        {
          asset: 'XLM',
          amount: '10000',
          priceUsd: 1.0,
          liquidationThresholdBps: 8000, // 80% = $8,000
          collateralFactorBps: 7500,     // 75% = $7,500
        },
      ],
      borrows: [
        {
          asset: 'USDC',
          borrowedAmount: '4000',
          priceUsd: 1.0,
          borrowRateBps: 500,
        },
      ],
    };

    const res = SimulationEngine.simulate(request);

    // HF = $8000 / $4000 = 2.0 (20000 bps)
    expect(res.initialHealthFactor).toBe(2.0);
    expect(res.initialHealthFactorBps).toBe(20000);
    expect(res.simulatedRiskTier).toBe('Safe');
    expect(res.isLiquidatable).toBe(false);
    expect(res.shortfallUsd).toBe(0);
    expect(res.maxBorrowableUsd).toBe(3500); // 7500 - 4000
    expect(res.maxWithdrawableUsd).toBe(4000); // 8000 - 4000
    expect(res.liquidationPriceUsd).toBe(0.5); // $4000 / (10000 * 0.8)
  });

  it('correctly flags liquidatable position when HF < 1.0', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        {
          asset: 'XLM',
          amount: '1000',
          priceUsd: 1.0,
          liquidationThresholdBps: 8000, // $800
          collateralFactorBps: 7500,
        },
      ],
      borrows: [
        {
          asset: 'USDC',
          borrowedAmount: '900', // $900 debt > $800 threshold => HF = 0.8888
          priceUsd: 1.0,
          borrowRateBps: 500,
        },
      ],
    };

    const res = SimulationEngine.simulate(request);
    expect(res.initialHealthFactor).toBeLessThan(1.0);
    expect(res.simulatedRiskTier).toBe('Liquidatable');
    expect(res.isLiquidatable).toBe(true);
    expect(res.shortfallUsd).toBe(100);
  });

  it('simulates price shock on collateral and debt accurately', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        {
          asset: 'XLM',
          amount: '10000',
          priceUsd: 1.0,
          liquidationThresholdBps: 8000,
          collateralFactorBps: 7500,
        },
      ],
      borrows: [
        {
          asset: 'USDC',
          borrowedAmount: '4000',
          priceUsd: 1.0,
          borrowRateBps: 500,
        },
      ],
      priceShocks: [
        { asset: 'XLM', shockBps: -3000 }, // -30% drop in XLM price -> $0.70
      ],
    };

    const res = SimulationEngine.simulate(request);

    // Initial: $8000 / $4000 = 2.0
    expect(res.initialHealthFactor).toBe(2.0);
    // Simulated Col = $7000, Liq Threshold = $5600 -> HF = $5600 / $4000 = 1.4
    expect(res.simulatedCollateralUsd).toBe(7000);
    expect(res.simulatedHealthFactor).toBe(1.4);
    expect(res.simulatedRiskTier).toBe('Caution');
  });

  it('simulates time delta with accrued interest', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        {
          asset: 'XLM',
          amount: '10000',
          priceUsd: 1.0,
          liquidationThresholdBps: 8000,
          collateralFactorBps: 7500,
        },
      ],
      borrows: [
        {
          asset: 'USDC',
          borrowedAmount: '5000',
          priceUsd: 1.0,
          borrowRateBps: 1000, // 10% APY
        },
      ],
      timeDeltaSeconds: 31536000, // 1 year
    };

    const res = SimulationEngine.simulate(request);
    // 10% of 5000 is 500 interest -> Simulated Debt = $5500
    expect(res.simulatedDebtUsd).toBe(5500);
    // Simulated HF = 8000 / 5500 = 1.4545
    expect(res.simulatedHealthFactor).toBeCloseTo(1.4545, 2);
    expect(res.simulatedHealthFactorBps).toBe(14545);
  });

  it('handles multi-asset portfolio with stress test scenarios', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        { asset: 'XLM', amount: '5000', priceUsd: 1.0, liquidationThresholdBps: 8000, collateralFactorBps: 7500 },
        { asset: 'BTC', amount: '1', priceUsd: 50000, liquidationThresholdBps: 8500, collateralFactorBps: 8000 },
      ],
      borrows: [
        { asset: 'USDC', borrowedAmount: '20000', priceUsd: 1.0, borrowRateBps: 500 },
        { asset: 'EURC', borrowedAmount: '5000', priceUsd: 1.1, borrowRateBps: 400 },
      ],
    };

    const res = SimulationEngine.simulate(request);
    expect(res.stressScenarios.length).toBe(3);
    expect(res.stressScenarios[0].name).toContain('Mild Market Dip');
    expect(res.stressScenarios[1].name).toContain('Moderate Correction');
    expect(res.stressScenarios[2].name).toContain('Severe Black Swan');
  });

  it('rejects malformed requests gracefully via RouteHandler', () => {
    const res1 = SimulationRouteHandler.handleSimulate({});
    expect(res1.success).toBe(false);
    expect(res1.error?.code).toBe('MISSING_COLLATERALS');

    const res2 = SimulationRouteHandler.handleSimulate({
      collaterals: [{ asset: 'XLM', amount: '100', priceUsd: -5 }],
    });
    // Sanitizer clamps negative price to default
    expect(res2.success).toBe(true);
  });

  it('Property Test: Health factor is strictly positive for any positive collateral and debt', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 1000, max: 9500 }),
        (colAmount, debtAmount, liqBps) => {
          const req: PositionSimulationRequest = {
            collaterals: [{ asset: 'XLM', amount: colAmount.toString(), priceUsd: 1.0, liquidationThresholdBps: liqBps, collateralFactorBps: liqBps - 500 }],
            borrows: [{ asset: 'USDC', borrowedAmount: debtAmount.toString(), priceUsd: 1.0, borrowRateBps: 500 }],
          };
          const res = SimulationEngine.simulate(req);
          expect(res.simulatedHealthFactor).toBeGreaterThan(0);
          expect(res.simulatedHealthFactorBps).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Simulation Engine Extended Coverage', () => {
  it('applies collateral deltas and debt deltas', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        { asset: 'XLM', amount: '10000', priceUsd: 1.0, liquidationThresholdBps: 8000, collateralFactorBps: 7500 },
      ],
      borrows: [
        { asset: 'USDC', borrowedAmount: '4000', priceUsd: 1.0, borrowRateBps: 500 },
      ],
      collateralDeltas: [
        { asset: 'XLM', deltaAmount: '-2000' }, // Withdraw 2000 XLM -> 8000 left
      ],
      debtDeltas: [
        { asset: 'USDC', deltaAmount: '1000' }, // Borrow 1000 more -> 5000 debt
      ],
    };

    const res = SimulationEngine.simulate(request);
    expect(res.simulatedCollateralUsd).toBe(8000);
    expect(res.simulatedDebtUsd).toBe(5000);
    expect(res.simulatedLiquidationThresholdUsd).toBe(6400);
    expect(res.simulatedHealthFactor).toBe(1.28);
    expect(res.simulatedRiskTier).toBe('Caution');
  });

  it('handles multiple assets with price shock in opposite directions', () => {
    const request: PositionSimulationRequest = {
      collaterals: [
        { asset: 'XLM', amount: '10000', priceUsd: 1.0, liquidationThresholdBps: 8000, collateralFactorBps: 7500 },
        { asset: 'ETH', amount: '1', priceUsd: 3000, liquidationThresholdBps: 8500, collateralFactorBps: 8000 },
      ],
      borrows: [
        { asset: 'USDC', borrowedAmount: '5000', priceUsd: 1.0, borrowRateBps: 500 },
      ],
      priceShocks: [
        { asset: 'XLM', shockBps: 5000 }, // +50% surge
        { asset: 'ETH', shockBps: -5000 }, // -50% plunge
      ],
    };

    const res = SimulationEngine.simulate(request);
    // XLM: 10000 * 1.5 = 15000. ETH: 1 * 1500 = 1500. Total = 16500
    expect(res.simulatedCollateralUsd).toBe(16500);
    expect(res.simulatedHealthFactor).toBeGreaterThan(2.0);
  });
});
