export type MevProtectionDecision = 'allow' | 'review' | 'block';

export interface MevProtectionConfig {
  maxPriceImpactBps: number;
  maxSlippageBps: number;
  minOrderDelaySecs: number;
  actorCooldownSecs: number;
  staleQuoteSecs: number;
}

export interface PoolQuote {
  poolId: string;
  asset: string;
  quotedPrice: number;
  expectedExecutionPrice: number;
  liquidityDepth: number;
  observedAt: number;
}

export interface PendingLendingOperation {
  id: string;
  actor: string;
  poolId: string;
  asset: string;
  side: 'deposit' | 'withdraw' | 'borrow' | 'repay' | 'liquidate';
  amount: number;
  submittedAt: number;
  minAcceptablePrice?: number;
  maxAcceptablePrice?: number;
}

export interface ExecutedLendingOperation extends PendingLendingOperation {
  executedAt: number;
  executionPrice: number;
}

export interface MevProtectionResult {
  decision: MevProtectionDecision;
  reasons: string[];
  priceImpactBps: number;
  slippageBps: number;
  earliestExecutionAt: number;
}

const DEFAULT_CONFIG: MevProtectionConfig = {
  maxPriceImpactBps: 150,
  maxSlippageBps: 100,
  minOrderDelaySecs: 30,
  actorCooldownSecs: 20,
  staleQuoteSecs: 45,
};

export class MevProtectionService {
  private readonly config: MevProtectionConfig;
  private readonly actorExecutions = new Map<string, ExecutedLendingOperation>();

  constructor(config: Partial<MevProtectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  evaluateOperation(
    operation: PendingLendingOperation,
    quote: PoolQuote,
    now: number,
    recentExecutions: ExecutedLendingOperation[] = []
  ): MevProtectionResult {
    const reasons: string[] = [];
    const earliestExecutionAt = operation.submittedAt + this.config.minOrderDelaySecs;

    if (operation.amount <= 0) {
      reasons.push('amount must be positive');
    }

    if (quote.poolId !== operation.poolId || quote.asset !== operation.asset) {
      reasons.push('quote does not match operation pool and asset');
    }

    if (now - quote.observedAt > this.config.staleQuoteSecs) {
      reasons.push('quote is stale');
    }

    if (now < earliestExecutionAt) {
      reasons.push('minimum order delay has not elapsed');
    }

    const priorActorExecution = this.actorExecutions.get(operation.actor);
    if (
      priorActorExecution &&
      now - priorActorExecution.executedAt < this.config.actorCooldownSecs
    ) {
      reasons.push('actor cooldown has not elapsed');
    }

    const priceImpactBps = this.calculatePriceImpactBps(operation.amount, quote.liquidityDepth);
    if (priceImpactBps > this.config.maxPriceImpactBps) {
      reasons.push('price impact exceeds configured limit');
    }

    const slippageBps = this.calculateSlippageBps(quote.quotedPrice, quote.expectedExecutionPrice);
    if (slippageBps > this.config.maxSlippageBps) {
      reasons.push('expected slippage exceeds configured limit');
    }

    if (!this.isWithinUserPriceBounds(operation, quote.expectedExecutionPrice)) {
      reasons.push('expected execution price violates user price bounds');
    }

    if (this.hasSandwichPattern(operation, quote, now, recentExecutions)) {
      reasons.push('recent surrounding trades indicate sandwich risk');
    }

    return {
      decision: this.decide(reasons, priceImpactBps, slippageBps),
      reasons,
      priceImpactBps,
      slippageBps,
      earliestExecutionAt,
    };
  }

  recordExecution(operation: ExecutedLendingOperation): void {
    this.actorExecutions.set(operation.actor, operation);
  }

  private calculatePriceImpactBps(amount: number, liquidityDepth: number): number {
    if (liquidityDepth <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.round((amount / liquidityDepth) * 10_000);
  }

  private calculateSlippageBps(quotedPrice: number, executionPrice: number): number {
    if (quotedPrice <= 0 || executionPrice <= 0) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.round((Math.abs(executionPrice - quotedPrice) / quotedPrice) * 10_000);
  }

  private isWithinUserPriceBounds(
    operation: PendingLendingOperation,
    executionPrice: number
  ): boolean {
    if (
      operation.minAcceptablePrice !== undefined &&
      executionPrice < operation.minAcceptablePrice
    ) {
      return false;
    }

    if (
      operation.maxAcceptablePrice !== undefined &&
      executionPrice > operation.maxAcceptablePrice
    ) {
      return false;
    }

    return true;
  }

  private hasSandwichPattern(
    operation: PendingLendingOperation,
    quote: PoolQuote,
    now: number,
    recentExecutions: ExecutedLendingOperation[]
  ): boolean {
    const windowStart = now - this.config.minOrderDelaySecs;
    const surroundingTrades = recentExecutions.filter(
      (execution) =>
        execution.poolId === operation.poolId &&
        execution.asset === operation.asset &&
        execution.actor !== operation.actor &&
        execution.executedAt >= windowStart &&
        execution.executedAt <= now
    );

    if (surroundingTrades.length < 2) {
      return false;
    }

    const before = surroundingTrades.some(
      (trade) =>
        trade.executedAt <= operation.submittedAt &&
        this.calculateSlippageBps(quote.quotedPrice, trade.executionPrice) >
          this.config.maxSlippageBps
    );
    const after = surroundingTrades.some(
      (trade) =>
        trade.executedAt >= operation.submittedAt &&
        this.calculateSlippageBps(quote.quotedPrice, trade.executionPrice) >
          this.config.maxSlippageBps
    );

    return before && after;
  }

  private decide(
    reasons: string[],
    priceImpactBps: number,
    slippageBps: number
  ): MevProtectionDecision {
    const blockingReasons = new Set([
      'amount must be positive',
      'quote does not match operation pool and asset',
      'quote is stale',
      'price impact exceeds configured limit',
      'expected execution price violates user price bounds',
      'recent surrounding trades indicate sandwich risk',
    ]);

    if (reasons.some((reason) => blockingReasons.has(reason))) {
      return 'block';
    }

    if (
      reasons.length > 0 ||
      priceImpactBps > this.config.maxPriceImpactBps * 0.8 ||
      slippageBps > this.config.maxSlippageBps * 0.8
    ) {
      return 'review';
    }

    return 'allow';
  }
}

export function createMevProtectionService(
  config?: Partial<MevProtectionConfig>
): MevProtectionService {
  return new MevProtectionService(config);
}
