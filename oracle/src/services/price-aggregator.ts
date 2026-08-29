export interface PriceSample {
  pair: string;
  price: number;
  liquidity: number;
  timestamp: number;
  source: string;
}

export interface TwapPolicy {
  minSamples: number;
  minWindowSecs: number;
  maxSampleAgeSecs: number;
  maxDeviationBps: number;
}

export interface TwapResult {
  pair: string;
  twap: number;
  samples: number;
  windowSecs: number;
  latestTimestamp: number;
}

const DEFAULT_TWAP_POLICY: TwapPolicy = {
  minSamples: 3,
  minWindowSecs: 300,
  maxSampleAgeSecs: 900,
  maxDeviationBps: 150,
};

export class PriceAggregator {
  private readonly policy: TwapPolicy;
  private readonly samples = new Map<string, PriceSample[]>();

  constructor(policy: Partial<TwapPolicy> = {}) {
    this.policy = { ...DEFAULT_TWAP_POLICY, ...policy };
  }

  addSample(sample: PriceSample): void {
    if (sample.price <= 0) {
      throw new Error('price must be positive');
    }

    if (sample.liquidity <= 0) {
      throw new Error('liquidity must be positive');
    }

    const existing = this.samples.get(sample.pair) ?? [];
    existing.push(sample);
    existing.sort((a, b) => a.timestamp - b.timestamp);
    this.samples.set(sample.pair, existing);
  }

  calculateTwap(pair: string, now: number): TwapResult {
    const activeSamples = this.getActiveSamples(pair, now);
    if (activeSamples.length < this.policy.minSamples) {
      throw new Error('insufficient price samples for TWAP');
    }

    const first = activeSamples[0];
    const last = activeSamples[activeSamples.length - 1];
    const windowSecs = last.timestamp - first.timestamp;
    if (windowSecs < this.policy.minWindowSecs) {
      throw new Error('TWAP window is too short');
    }

    const weightedSum = activeSamples.reduce(
      (sum, sample) => sum + sample.price * sample.liquidity,
      0
    );
    const totalLiquidity = activeSamples.reduce((sum, sample) => sum + sample.liquidity, 0);

    return {
      pair,
      twap: weightedSum / totalLiquidity,
      samples: activeSamples.length,
      windowSecs,
      latestTimestamp: last.timestamp,
    };
  }

  validateSpotPrice(pair: string, spotPrice: number, now: number): {
    valid: boolean;
    deviationBps: number;
    twap: TwapResult;
  } {
    const twap = this.calculateTwap(pair, now);
    const deviationBps = Math.round((Math.abs(spotPrice - twap.twap) / twap.twap) * 10_000);

    return {
      valid: deviationBps <= this.policy.maxDeviationBps,
      deviationBps,
      twap,
    };
  }

  private getActiveSamples(pair: string, now: number): PriceSample[] {
    return (this.samples.get(pair) ?? []).filter(
      (sample) => now - sample.timestamp <= this.policy.maxSampleAgeSecs
    );
  }
}
