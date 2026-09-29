import { describe, it, expect, beforeEach } from 'vitest';
import { InsuranceEngine } from '../src/services/insurance-engine.js';
import { InsuranceRouteHandler } from '../src/routes/insurance.js';

describe('Insurance Marketplace & Underwriting Service Tests', () => {
  let engine: InsuranceEngine;
  let handler: InsuranceRouteHandler;

  beforeEach(() => {
    engine = new InsuranceEngine();
    handler = new InsuranceRouteHandler(engine);
  });

  it('lists existing insurance pools', () => {
    const res = handler.handleListPools();
    expect(res.success).toBe(true);
    expect(res.data?.length).toBeGreaterThan(0);
    expect(res.data?.[0].poolId).toBe(1);
  });

  it('generates dynamic quote scaling with risk tier and utilization', () => {
    const safeQuote = handler.handleGetQuote({
      poolId: 1,
      coverAmount: '10000',
      durationSeconds: 86400 * 30, // 30 days
      riskTier: 'Safe',
    });

    const atRiskQuote = handler.handleGetQuote({
      poolId: 1,
      coverAmount: '10000',
      durationSeconds: 86400 * 30,
      riskTier: 'AtRisk',
    });

    expect(safeQuote.success).toBe(true);
    expect(atRiskQuote.success).toBe(true);
    expect(BigInt(atRiskQuote.data!.premiumAmount)).toBeGreaterThan(BigInt(safeQuote.data!.premiumAmount));
  });

  it('handles policy purchase and updates pool reserves', () => {
    const purchaseRes = handler.handlePurchase({
      poolId: 1,
      holderAddress: 'GBND65XZ7...USER',
      coverAmount: '5000000',
      durationSeconds: 86400 * 90,
      riskTier: 'Caution',
    });

    expect(purchaseRes.success).toBe(true);
    expect(purchaseRes.data?.policyId).toBe(1);
    expect(purchaseRes.data?.isActive).toBe(true);
    expect(purchaseRes.data?.isClaimed).toBe(false);
  });

  it('submits and processes an approved claim with 25% single payout cap', () => {
    const purchase = handler.handlePurchase({
      poolId: 1,
      holderAddress: 'GBND65XZ7...USER',
      coverAmount: '100000000',
      durationSeconds: 86400 * 30,
      riskTier: 'Safe',
    });

    const claimRes = handler.handleSubmitClaim({
      policyId: purchase.data!.policyId,
      claimantAddress: 'GBND65XZ7...USER',
      lossAmount: '80000000',
      proofData: '0xdeadbeef_liquidation_shortfall_proof',
    });

    expect(claimRes.success).toBe(true);
    expect(claimRes.data?.isApproved).toBe(false);

    // Process approval
    const approved = engine.processClaimPayout(claimRes.data!.claimId, true, 'GA_ASSESSOR');
    expect(approved.isApproved).toBe(true);
    expect(approved.isPaid).toBe(true);
    expect(BigInt(approved.payoutAmount)).toBeGreaterThan(0n);
  });

  it('audits solvency health invariants', () => {
    const auditRes = handler.handleSolvencyAudit(1);
    expect(auditRes.success).toBe(true);
    expect(auditRes.data?.isSolvent).toBe(true);
    expect(auditRes.data?.solvencyRatioPct).toBeGreaterThanOrEqual(150);
  });

  it('handles missing parameters and error paths in routes', () => {
    expect(handler.handleGetQuote({}).success).toBe(false);
    expect(handler.handlePurchase({}).success).toBe(false);
    expect(handler.handleSubmitClaim({}).success).toBe(false);
    expect(handler.handleSolvencyAudit(99999).success).toBe(false);
  });

  it('handles non-existent pool in quote and purchase', () => {
    expect(() => engine.generateQuote({ poolId: 999, coverAmount: '100', durationSeconds: 86400, riskTier: 'Safe' })).toThrow();
    expect(() => engine.purchasePolicy({ poolId: 999, holderAddress: 'G1', coverAmount: '100', durationSeconds: 86400, riskTier: 'Safe' })).toThrow();
  });

  it('handles paused pool error', () => {
    const pool = engine.getPool(1)!;
    pool.isPaused = true;
    expect(() => engine.purchasePolicy({ poolId: 1, holderAddress: 'G1', coverAmount: '100', durationSeconds: 86400, riskTier: 'Safe' })).toThrow('paused');
    pool.isPaused = false;
  });

  it('validates claim conditions (inactive, already claimed, unauthorized claimant)', () => {
    expect(() => engine.submitClaim({ policyId: 999, claimantAddress: 'G1', lossAmount: '100', proofData: '' })).toThrow();
    expect(() => engine.processClaimPayout(999, true, 'GA')).toThrow();
  });
});
