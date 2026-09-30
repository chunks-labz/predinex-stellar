/**
 * Insurance Marketplace API Route.
 * Technical Scope: api/src/routes/insurance.ts
 */

import { Router, Request, Response } from 'express';
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
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';

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

    const holderAddress = SecuritySanitizer.readStellarAddress(body.holderAddress);
    if (!holderAddress) {
      return {
        success: false,
        error: { code: 'INVALID_ADDRESS', message: 'holderAddress must be a valid Stellar address' },
        timestamp: Date.now(),
      };
    }

    const request: PolicyPurchaseRequest = {
      poolId: parseInt(body.poolId),
      holderAddress,
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

    const claimantAddress = SecuritySanitizer.readStellarAddress(body.claimantAddress);
    if (!claimantAddress) {
      return {
        success: false,
        error: { code: 'INVALID_ADDRESS', message: 'claimantAddress must be a valid Stellar address' },
        timestamp: Date.now(),
      };
    }

    const request: ClaimSubmissionRequest = {
      policyId: parseInt(body.policyId),
      claimantAddress,
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

/**
 * Express router mounting insurance endpoints.
 * Mount at `/api/insurance` (see `src/app.ts`).
 */
export const insuranceRouter = Router();

// One handler (and engine) for the router's lifetime so state — records,
// policies, daily volume counters — persists across requests.
const handler = new InsuranceRouteHandler();

insuranceRouter.use(authMiddleware);
insuranceRouter.use(rateLimitMiddleware);

insuranceRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Insurance API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

insuranceRouter.get('/pools', (req: Request, res: Response) => {
  res.json(handler.handleListPools());
});

insuranceRouter.post('/quote', (req: Request, res: Response) => {
  const result = handler.handleGetQuote(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

insuranceRouter.post('/purchase', (req: Request, res: Response) => {
  const result = handler.handlePurchase(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

insuranceRouter.post('/claim', (req: Request, res: Response) => {
  const result = handler.handleSubmitClaim(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

insuranceRouter.get('/audit/:poolId', (req: Request, res: Response) => {
  const poolId = parseInt(req.params.poolId, 10);
  if (!Number.isInteger(poolId)) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_POOL_ID', message: 'poolId must be an integer' },
      timestamp: Date.now(),
    });
    return;
  }
  const result = handler.handleSolvencyAudit(poolId);
  res.status(result.success ? 200 : 400).json(result);
});

export default insuranceRouter;
