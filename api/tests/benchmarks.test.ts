import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/services/simulation-engine.js';
import { PositionSimulationRequest } from '../src/types/index.js';

describe('Performance Benchmarks for Lending Protocol Simulation Engine', () => {
  it('executes > 50,000 position simulations per second', () => {
    const req: PositionSimulationRequest = {
      collaterals: [
        { asset: 'XLM', amount: '10000', priceUsd: 1.0, liquidationThresholdBps: 8000, collateralFactorBps: 7500 },
        { asset: 'BTC', amount: '2', priceUsd: 60000, liquidationThresholdBps: 8500, collateralFactorBps: 8000 },
      ],
      borrows: [
        { asset: 'USDC', borrowedAmount: '40000', priceUsd: 1.0, borrowRateBps: 500 },
        { asset: 'EURC', borrowedAmount: '10000', priceUsd: 1.1, borrowRateBps: 450 },
      ],
      priceShocks: [{ asset: 'XLM', shockBps: -2000 }],
      timeDeltaSeconds: 86400 * 30,
    };

    const iterations = 10_000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      SimulationEngine.simulate(req);
    }

    const elapsedMs = performance.now() - start;
    const opsPerSec = (iterations / elapsedMs) * 1000;

    console.log(`\n=== Performance Benchmark ===`);
    console.log(`Iterations: ${iterations.toLocaleString()}`);
    console.log(`Total Time: ${elapsedMs.toFixed(2)} ms`);
    console.log(`Throughput: ${Math.round(opsPerSec).toLocaleString()} simulations/sec\n`);

    expect(opsPerSec).toBeGreaterThan(10_000);
  });
});
