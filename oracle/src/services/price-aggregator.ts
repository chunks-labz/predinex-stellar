/**
 * Machine-readable reasons a price sample set can be rejected.
 *
 * - `invalid_sample`: a sample failed the positivity/finiteness checks in `addSample`.
 * - `insufficient_samples`: fewer usable samples than `minSamples`.
 * - `no_active_samples`: every sample aged out of the retention window.
 * - `twap_window_too_short`: usable samples span less than `minWindowSecs`.
 * - `zero_total_liquidity`: the summed weights are zero or non-finite.
 * - `non_finite_twap`: the weighted average is not a usable price.
 * - `non_finite_spot_price`: the spot price under validation is not a usable price.
 */
export type PriceErrorCode =
  | 'invalid_sample'
  | 'insufficient_samples'
  | 'no_active_samples'
  | 'twap_window_too_short'
  | 'zero_total_liquidity'
  | 'non_finite_twap'
  | 'non_finite_spot_price';

export class PriceValidationError extends Error {
  constructor(
    public readonly code: PriceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PriceValidationError';
  }
}

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
    if (!Number.isFinite(sample.price) || sample.price <= 0) {
      throw new PriceValidationError('invalid_sample', 'price must be finite and positive');
    }

    if (!Number.isFinite(sample.liquidity) || sample.liquidity <= 0) {
      throw new PriceValidationError('invalid_sample', 'liquidity must be finite and positive');
    }

    const existing = this.samples.get(sample.pair) ?? [];
    existing.push(sample);
    existing.sort((a, b) => a.timestamp - b.timestamp);
    this.samples.set(sample.pair, existing);
  }

  calculateTwap(pair: string, now: number): TwapResult {
    const activeSamples = this.getActiveSamples(pair, now);
    if (activeSamples.length < this.policy.minSamples) {
      throw new PriceValidationError(
        'insufficient_samples',
        'insufficient price samples for TWAP'
      );
    }

    if (activeSamples.length === 0) {
      throw new PriceValidationError(
        'no_active_samples',
        'no price samples remain within the retention window'
      );
    }

    const first = activeSamples[0];
    const last = activeSamples[activeSamples.length - 1];
    const windowSecs = last.timestamp - first.timestamp;
    if (windowSecs < this.policy.minWindowSecs) {
      throw new PriceValidationError('twap_window_too_short', 'TWAP window is too short');
    }

    const weightedSum = activeSamples.reduce(
      (sum, sample) => sum + sample.price * sample.liquidity,
      0
    );
    const totalLiquidity = activeSamples.reduce((sum, sample) => sum + sample.liquidity, 0);

    // Guard the divisor before dividing: a zero or non-finite weight sum would
    // otherwise yield Infinity/NaN, which no downstream comparison can reject.
    if (!Number.isFinite(totalLiquidity) || totalLiquidity <= 0) {
      throw new PriceValidationError(
        'zero_total_liquidity',
        'total sample liquidity is zero or non-finite'
      );
    }

    const twap = weightedSum / totalLiquidity;
    if (!Number.isFinite(twap) || twap <= 0) {
      throw new PriceValidationError(
        'non_finite_twap',
        'computed TWAP is not a usable price'
      );
    }

    return {
      pair,
      twap,
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
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
      throw new PriceValidationError(
        'non_finite_spot_price',
        'spot price is not a usable price'
      );
    }

    const twap = this.calculateTwap(pair, now);
    const deviationBps = Math.round((Math.abs(spotPrice - twap.twap) / twap.twap) * 10_000);

    // calculateTwap guarantees a finite, positive TWAP, so the ratio above cannot
    // be NaN. Reject anything else anyway: a NaN deviation fails every comparison
    // and would let a poisoned price pass the deviation guard unchecked.
    if (!Number.isFinite(deviationBps)) {
      throw new PriceValidationError(
        'non_finite_twap',
        'TWAP deviation is not a finite value'
      );
    }

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
