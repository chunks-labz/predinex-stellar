export interface RateObservation {
  asset: string;
  rateBps: number;
  utilizationBps: number;
  timestamp: number;
}

export interface RateValidationPolicy {
  maxRateBps: number;
  maxDeltaBps: number;
  maxUtilizationJumpBps: number;
  maxStaleSecs: number;
}

export interface RateValidationResult {
  valid: boolean;
  reasons: string[];
  rateDeltaBps: number;
  utilizationDeltaBps: number;
}

const DEFAULT_RATE_POLICY: RateValidationPolicy = {
  maxRateBps: 8_000,
  maxDeltaBps: 250,
  maxUtilizationJumpBps: 1_500,
  maxStaleSecs: 300,
};

export class PriceValidator {
  private readonly policy: RateValidationPolicy;

  constructor(policy: Partial<RateValidationPolicy> = {}) {
    this.policy = { ...DEFAULT_RATE_POLICY, ...policy };
  }

  validateRateUpdate(
    previous: RateObservation,
    next: RateObservation,
    now: number
  ): RateValidationResult {
    const reasons: string[] = [];

    if (previous.asset !== next.asset) {
      reasons.push('asset mismatch');
    }

    if (next.rateBps < 0 || next.rateBps > this.policy.maxRateBps) {
      reasons.push('rate outside allowed bounds');
    }

    if (next.utilizationBps < 0 || next.utilizationBps > 10_000) {
      reasons.push('utilization outside allowed bounds');
    }

    if (now - next.timestamp > this.policy.maxStaleSecs) {
      reasons.push('rate observation is stale');
    }

    const rateDeltaBps = Math.abs(next.rateBps - previous.rateBps);
    if (rateDeltaBps > this.policy.maxDeltaBps) {
      reasons.push('rate delta exceeds manipulation threshold');
    }

    const utilizationDeltaBps = Math.abs(next.utilizationBps - previous.utilizationBps);
    if (utilizationDeltaBps > this.policy.maxUtilizationJumpBps) {
      reasons.push('utilization jump exceeds manipulation threshold');
    }

    return {
      valid: reasons.length === 0,
      reasons,
      rateDeltaBps,
      utilizationDeltaBps,
    };
  }
}
