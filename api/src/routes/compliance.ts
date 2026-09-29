/**
 * Compliance API Route.
 * Technical Scope: api/src/routes/compliance.ts
 */

import { Router, Request, Response } from 'express';
import {
  ApiResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ComplianceRecordDto,
  RegisterParticipantRequest,
} from '../types/index.js';
import { ComplianceEngine } from '../services/compliance-engine.js';
import { SecuritySanitizer } from '../middleware/security.js';
import { authMiddleware, requireComplianceOfficer } from '../middleware/auth.js';
import {
  rateLimitMiddleware,
  strictRateLimitMiddleware,
} from '../middleware/rate-limit.js';

export class ComplianceRouteHandler {
  private engine: ComplianceEngine;

  constructor(engine?: ComplianceEngine) {
    this.engine = engine || new ComplianceEngine();
  }

  public handleVerifyTransaction(body: any): ApiResponse<ComplianceCheckResponse> {
    if (!body || !body.participantAddress || !body.action) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Participant address and action are required' },
        timestamp: Date.now(),
      };
    }

    const request: ComplianceCheckRequest = {
      participantAddress: String(body.participantAddress),
      action: body.action,
      amountUsd: SecuritySanitizer.sanitizePositiveNumber(body.amountUsd, 0),
    };

    const result = this.engine.verifyTransaction(request);
    return {
      success: true,
      data: result,
      timestamp: Date.now(),
    };
  }

  public handleRegister(body: any): ApiResponse<ComplianceRecordDto> {
    if (!body || !body.participantAddress || !body.tier) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Participant address and tier are required' },
        timestamp: Date.now(),
      };
    }

    const request: RegisterParticipantRequest = {
      officerAddress: String(body.officerAddress || 'admin'),
      participantAddress: String(body.participantAddress),
      tier: body.tier,
      kycExpiryTimestamp: parseInt(body.kycExpiryTimestamp) || Math.floor(Date.now() / 1000) + 31_536_000,
      jurisdictionCode: parseInt(body.jurisdictionCode) || 840,
      customDailyLimitUsd: body.customDailyLimitUsd ? parseFloat(body.customDailyLimitUsd) : undefined,
    };

    const record = this.engine.registerParticipant(request);
    return {
      success: true,
      data: record,
      timestamp: Date.now(),
    };
  }

  public handleGetStatus(address: string): ApiResponse<ComplianceRecordDto> {
    const record = this.engine.getRecord(address);
    if (!record) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Compliance record not found' },
        timestamp: Date.now(),
      };
    }
    return {
      success: true,
      data: record,
      timestamp: Date.now(),
    };
  }
}

/**
 * Express router mounting compliance endpoints.
 * Mount at `/api/compliance` (see `src/app.ts`).
 */
export const complianceRouter = Router();

complianceRouter.use(authMiddleware);
complianceRouter.use(rateLimitMiddleware);

complianceRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Compliance API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

complianceRouter.post('/verify', (req: Request, res: Response) => {
  const handler = new ComplianceRouteHandler();
  const result = handler.handleVerifyTransaction(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

complianceRouter.post(
  '/register',
  strictRateLimitMiddleware,
  requireComplianceOfficer,
  (req: Request, res: Response) => {
    const handler = new ComplianceRouteHandler();
    const result = handler.handleRegister(req.body);
    res.status(result.success ? 200 : 400).json(result);
  }
);

complianceRouter.get('/status/:address', (req: Request, res: Response) => {
  const handler = new ComplianceRouteHandler();
  const result = handler.handleGetStatus(req.params.address);
  res.status(result.success ? 200 : 404).json(result);
});

export default complianceRouter;
