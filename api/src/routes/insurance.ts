/**
 * Insurance Marketplace API Route.
 * Technical Scope: api/src/routes/insurance.ts
 */

import {
  ApiResponse,
  ClaimSubmissionRequest,
  InsuranceClaimDto,
  InsurancePolicyDto,
  InsurancePoolDto,
  InsuranceQuoteRequest,
  InsuranceQuoteResponse,
  PolicyPurchaseRequest,
  SolvencyAuditDto,
} from '../types/index.js';
import { InsuranceEngine } from '../services/insurance-engine.js';
import { SecuritySanitizer } from '../middleware/security.js';

export class InsuranceRouteHandler {
  private engine: InsuranceEngine;

  constructor(engine?: InsuranceEngine) {
    this.engine = engine || new InsuranceEngine();
  }

  public handleListPools(): ApiResponse<InsurancePoolDto[]> {
    return {
      success: true,
      data: this.engine.listPools(),
      timestamp: Date.now(),
    };
  }

  public handleGetQuote(body: any): ApiResponse<InsuranceQuoteResponse> {
    if (!body || !body.poolId || !body.coverAmount || !body.durationSeconds) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMETERS', message: 'Missing required quote parameters' },
        timestamp: Date.now(),
      };
    }

    const request: InsuranceQuoteRequest = {
      poolId: parseInt(body.poolId),
      coverAmount: SecuritySanitizer.sanitizeBigIntString(String(body.coverAmount)),
      durationSeconds: Math.max(86400, Math.min(31536000, parseInt(body.durationSeconds) || 86400)),
      riskTier: body.riskTier || 'Safe',
    };

    try {
      const quote = this.engine.generateQuote(request);
      return {
        success: true,
        data: quote,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'QUOTE_FAILED', message: err.message },
        timestamp: Date.now(),
      };
    }
  }

  public handlePurchase(body: any): ApiResponse<InsurancePolicyDto> {
    if (!body || !body.poolId || !body.holderAddress || !body.coverAmount) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMETERS', message: 'Missing purchase arguments' },
        timestamp: Date.now(),
      };
    }

    const request: PolicyPurchaseRequest = {
      poolId: parseInt(body.poolId),
      holderAddress: String(body.holderAddress),
      coverAmount: SecuritySanitizer.sanitizeBigIntString(String(body.coverAmount)),
      durationSeconds: Math.max(86400, Math.min(31536000, parseInt(body.durationSeconds) || 86400)),
      riskTier: body.riskTier || 'Safe',
    };

    try {
      const policy = this.engine.purchasePolicy(request);
      return {
        success: true,
        data: policy,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'PURCHASE_FAILED', message: err.message },
        timestamp: Date.now(),
      };
    }
  }

  public handleSubmitClaim(body: any): ApiResponse<InsuranceClaimDto> {
    if (!body || !body.policyId || !body.claimantAddress || !body.lossAmount) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMETERS', message: 'Missing claim parameters' },
        timestamp: Date.now(),
      };
    }

    const request: ClaimSubmissionRequest = {
      policyId: parseInt(body.policyId),
      claimantAddress: String(body.claimantAddress),
      lossAmount: SecuritySanitizer.sanitizeBigIntString(String(body.lossAmount)),
      proofData: String(body.proofData || ''),
    };

    try {
      const claim = this.engine.submitClaim(request);
      return {
        success: true,
        data: claim,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'CLAIM_SUBMISSION_FAILED', message: err.message },
        timestamp: Date.now(),
      };
    }
  }

  public handleSolvencyAudit(poolId: number): ApiResponse<SolvencyAuditDto> {
    try {
      const audit = this.engine.getSolvencyAudit(poolId);
      return {
        success: true,
        data: audit,
        timestamp: Date.now(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'AUDIT_FAILED', message: err.message },
        timestamp: Date.now(),
      };
    }
  }
}
