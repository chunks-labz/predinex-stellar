/**
 * Insurance Marketplace & Underwriting Service Engine.
 */

import {
  ClaimSubmissionRequest,
  InsuranceClaimDto,
  InsurancePolicyDto,
  InsurancePoolDto,
  InsuranceQuoteRequest,
  InsuranceQuoteResponse,
  PolicyPurchaseRequest,
  RiskTier,
  SolvencyAuditDto,
} from '../types/index.js';

export class InsuranceEngine {
  private pools = new Map<number, InsurancePoolDto>();
  private policies = new Map<number, InsurancePolicyDto>();
  private claims = new Map<number, InsuranceClaimDto>();
  private nextPolicyId = 1;
  private nextClaimId = 1;

  constructor() {
    // Seed initial pools
    this.createPool({
      poolId: 1,
      underwritingAsset: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      totalStaked: '1000000000000', // 100,000 XLM
      totalShares: '1000000000000',
      activeCoverAmount: '200000000000', // 20,000 XLM
      availableReserves: '1000000000000',
      maxCapacity: '5000000000000', // 500,000 XLM
      minSolvencyRatioBps: 15000, // 150%
      basePremiumRateBps: 200, // 2%
      utilizationMultiplierBps: 500,
      isPaused: false,
    });
  }

  public createPool(pool: InsurancePoolDto): InsurancePoolDto {
    this.pools.set(pool.poolId, pool);
    return pool;
  }

  public getPool(poolId: number): InsurancePoolDto | undefined {
    return this.pools.get(poolId);
  }

  public listPools(): InsurancePoolDto[] {
    return Array.from(this.pools.values());
  }

  public generateQuote(request: InsuranceQuoteRequest, now: number = Date.now()): InsuranceQuoteResponse {
    const pool = this.pools.get(request.poolId);
    if (!pool) {
      throw new Error(`Insurance pool ${request.poolId} not found`);
    }

    const cover = BigInt(request.coverAmount);
    const staked = BigInt(pool.totalStaked);
    const activeCover = BigInt(pool.activeCoverAmount);

    const utilizationBps = staked === 0n ? 0n : (activeCover * 10000n) / staked;
    const utilComponent = (utilizationBps * BigInt(pool.utilizationMultiplierBps)) / 10000n;
    const annualRateBps = BigInt(pool.basePremiumRateBps) + utilComponent;

    const riskMultiplierBps = this.getRiskMultiplier(request.riskTier);

    // Premium = (cover * annualRate * duration * riskMult) / (10000 * 31536000 * 10000)
    const duration = BigInt(request.durationSeconds);
    const num = cover * annualRateBps * duration * riskMultiplierBps;
    const den = 10000n * 31536000n * 10000n;
    const premium = (num / den).toString();

    const solvencyRatioBps = activeCover === 0n ? 100000 : Number((staked * 10000n) / activeCover);

    return {
      poolId: pool.poolId,
      coverAmount: request.coverAmount,
      durationSeconds: request.durationSeconds,
      premiumAmount: premium === '0' ? '1' : premium,
      annualRateBps: Number(annualRateBps),
      solvencyRatioBps,
      quoteExpiry: now + 900_000, // 15 mins
    };
  }

  public purchasePolicy(request: PolicyPurchaseRequest, now: number = Date.now()): InsurancePolicyDto {
    const pool = this.pools.get(request.poolId);
    if (!pool) {
      throw new Error(`Pool ${request.poolId} not found`);
    }
    if (pool.isPaused) {
      throw new Error('Insurance pool is paused');
    }

    const quote = this.generateQuote(request, now);
    const coverBig = BigInt(request.coverAmount);
    const newActiveCover = BigInt(pool.activeCoverAmount) + coverBig;

    if (newActiveCover > BigInt(pool.maxCapacity)) {
      throw new Error('Pool cover capacity exceeded');
    }

    pool.activeCoverAmount = newActiveCover.toString();
    pool.availableReserves = (BigInt(pool.availableReserves) + BigInt(quote.premiumAmount)).toString();
    pool.totalStaked = (BigInt(pool.totalStaked) + BigInt(quote.premiumAmount)).toString();

    const policyId = this.nextPolicyId++;
    const policy: InsurancePolicyDto = {
      policyId,
      holder: request.holderAddress,
      poolId: pool.poolId,
      coverAmount: request.coverAmount,
      premiumPaid: quote.premiumAmount,
      startTime: Math.floor(now / 1000),
      expiryTime: Math.floor(now / 1000) + request.durationSeconds,
      isClaimed: false,
      isActive: true,
    };

    this.policies.set(policyId, policy);
    return policy;
  }

  public submitClaim(request: ClaimSubmissionRequest, now: number = Date.now()): InsuranceClaimDto {
    const policy = this.policies.get(request.policyId);
    if (!policy) {
      throw new Error(`Policy ${request.policyId} not found`);
    }
    if (!policy.isActive || policy.isClaimed) {
      throw new Error('Policy is not active or has already been claimed');
    }
    if (policy.holder.toLowerCase() !== request.claimantAddress.toLowerCase()) {
      throw new Error('Claimant does not own this policy');
    }

    const lossBig = BigInt(request.lossAmount);
    const coverBig = BigInt(policy.coverAmount);
    const payoutBig = lossBig < coverBig ? lossBig : coverBig;

    const claimId = this.nextClaimId++;
    const claim: InsuranceClaimDto = {
      claimId,
      policyId: policy.policyId,
      claimant: request.claimantAddress,
      lossAmount: request.lossAmount,
      payoutAmount: payoutBig.toString(),
      filingTime: Math.floor(now / 1000),
      isApproved: false,
      isPaid: false,
    };

    this.claims.set(claimId, claim);
    return claim;
  }

  public processClaimPayout(claimId: number, approve: boolean, assessor: string): InsuranceClaimDto {
    const claim = this.claims.get(claimId);
    if (!claim) {
      throw new Error(`Claim ${claimId} not found`);
    }
    if (claim.isApproved || claim.isPaid) {
      throw new Error('Claim has already been processed');
    }

    claim.assessor = assessor;
    claim.isApproved = approve;

    if (approve) {
      const policy = this.policies.get(claim.policyId)!;
      const pool = this.pools.get(policy.poolId)!;

      const payoutBig = BigInt(claim.payoutAmount);
      const availableBig = BigInt(pool.availableReserves);

      // Max single payout limit (25% of reserves)
      const maxPayout = (availableBig * 2500n) / 10000n;
      const finalPayout = payoutBig < maxPayout ? payoutBig : maxPayout;

      pool.availableReserves = (availableBig - finalPayout).toString();
      pool.totalStaked = (BigInt(pool.totalStaked) - finalPayout).toString();
      pool.activeCoverAmount = (BigInt(pool.activeCoverAmount) - BigInt(policy.coverAmount)).toString();

      policy.isClaimed = true;
      policy.isActive = false;
      claim.isPaid = true;
      claim.payoutAmount = finalPayout.toString();
    }

    return claim;
  }

  public getSolvencyAudit(poolId: number): SolvencyAuditDto {
    const pool = this.pools.get(poolId);
    if (!pool) {
      throw new Error(`Pool ${poolId} not found`);
    }

    const available = BigInt(pool.availableReserves);
    const activeCover = BigInt(pool.activeCoverAmount);
    const solvencyRatioBps = activeCover === 0n ? 100000 : Number((available * 10000n) / activeCover);
    const isSolvent = solvencyRatioBps >= pool.minSolvencyRatioBps;
    const maxSinglePayout = ((available * 2500n) / 10000n).toString();
    const utilizationRateBps = available === 0n ? 0 : Number((activeCover * 10000n) / available);

    return {
      poolId,
      availableReserves: pool.availableReserves,
      activeCover: pool.activeCoverAmount,
      solvencyRatioBps,
      solvencyRatioPct: solvencyRatioBps / 100,
      isSolvent,
      maxSinglePayoutLimit: maxSinglePayout,
      utilizationRateBps,
    };
  }

  private getRiskMultiplier(riskTier: RiskTier): bigint {
    switch (riskTier) {
      case 'Safe': return 10000n;
      case 'Caution': return 13000n;
      case 'AtRisk': return 18000n;
      case 'Liquidatable': return 25000n;
      default: return 10000n;
    }
  }
}
