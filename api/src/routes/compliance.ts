/**
 * Compliance API Route.
 * Technical Scope: api/src/routes/compliance.ts
 */

import {
  ApiResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ComplianceRecordDto,
  RegisterParticipantRequest,
} from '../types/index.js';
import { ComplianceEngine } from '../services/compliance-engine.js';
import { SecuritySanitizer } from '../middleware/security.js';

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
