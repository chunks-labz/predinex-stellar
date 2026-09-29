/**
 * Compliance API Routes
 * 
 * Handles KYC verification, sanctions checking, and freeze status.
 * 
 * SECURITY FIX (#1294):
 * - Full status details require compliance officer authentication
 * - Public endpoints return only boolean allowed/not-allowed
 * - Sensitive fields (isSanctioned, isFrozen, jurisdictionCode, limits) protected
 * 
 * Issue #1294: Prevent anonymous access to sensitive compliance data
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, requireComplianceOfficer, requireAuth } from '../middleware/authMiddleware';
import rateLimit from 'express-rate-limit';

// ============================================================================
// Types
// ============================================================================

interface ComplianceStatus {
  participant: string;
  tier: string;
  kycExpiry: number;
  jurisdictionCode: number;
  isSanctioned: boolean;
  isFrozen: boolean;
  dailyVolumeLimitUsd: number;
}

interface PublicComplianceStatus {
  participant: string;
  allowed: boolean;
  reason?: string;
}

interface VerifyRequest {
  participant: string;
  amount?: number;
  operation?: string;
}

interface VerifyResponse {
  allowed: boolean;
  reason?: string;
}

interface ComplianceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// ============================================================================
// Rate Limiting
// ============================================================================

const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================================================
// Compliance Handler
// ============================================================================

class ComplianceRouteHandler {
  /**
   * Get full compliance status - REQUIRES COMPLIANCE OFFICER
   * Issue #1294: Returns sensitive fields only to authorized users
   */
  handleGetFullStatus(address: string): ComplianceResponse<ComplianceStatus> {
    // TODO: Replace with actual database lookup
    // This is the hardcoded seed record mentioned in issue
    const status: ComplianceStatus = {
      participant: address,
      tier: 'Tier2_Accredited',
      kycExpiry: Date.now() / 1000 + 86400 * 365, // 1 year
      jurisdictionCode: 840, // USA
      isSanctioned: false,
      isFrozen: false,
      dailyVolumeLimitUsd: 250000,
    };

    return {
      success: true,
      data: status,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get public compliance status - NO AUTH REQUIRED
   * Issue #1294: Returns only boolean allowed/not-allowed
   */
  handleGetPublicStatus(address: string): ComplianceResponse<PublicComplianceStatus> {
    // TODO: Replace with actual database lookup
    const fullStatus: ComplianceStatus = {
      participant: address,
      tier: 'Tier2_Accredited',
      kycExpiry: Date.now() / 1000 + 86400 * 365,
      jurisdictionCode: 840,
      isSanctioned: false,
      isFrozen: false,
      dailyVolumeLimitUsd: 250000,
    };

    // Check if participant is allowed to interact
    const now = Date.now() / 1000;
    const allowed =
      !fullStatus.isSanctioned &&
      !fullStatus.isFrozen &&
      fullStatus.kycExpiry > now;

    let reason: string | undefined;
    if (!allowed) {
      if (fullStatus.isSanctioned) {
        reason = 'Account sanctioned';
      } else if (fullStatus.isFrozen) {
        reason = 'Account frozen';
      } else if (fullStatus.kycExpiry <= now) {
        reason = 'KYC expired';
      }
    }

    const publicStatus: PublicComplianceStatus = {
      participant: address,
      allowed,
      reason,
    };

    return {
      success: true,
      data: publicStatus,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Verify participant for operation - REQUIRES AUTH
   * Issue #1294: Protected endpoint, returns only boolean result
   */
  handleVerify(request: VerifyRequest, isComplianceOfficer: boolean): ComplianceResponse<VerifyResponse> {
    // TODO: Replace with actual verification logic
    const fullStatus: ComplianceStatus = {
      participant: request.participant,
      tier: 'Tier2_Accredited',
      kycExpiry: Date.now() / 1000 + 86400 * 365,
      jurisdictionCode: 840,
      isSanctioned: false,
      isFrozen: false,
      dailyVolumeLimitUsd: 250000,
    };

    const now = Date.now() / 1000;
    let allowed = !fullStatus.isSanctioned && !fullStatus.isFrozen && fullStatus.kycExpiry > now;
    let reason: string | undefined;

    // Check amount against daily limit if provided
    if (allowed && request.amount) {
      if (request.amount > fullStatus.dailyVolumeLimitUsd) {
        allowed = false;
        reason = 'Amount exceeds daily limit';
      }
    }

    if (!allowed && !reason) {
      if (fullStatus.isSanctioned) {
        reason = 'Account sanctioned';
      } else if (fullStatus.isFrozen) {
        reason = 'Account frozen';
      } else if (fullStatus.kycExpiry <= now) {
        reason = 'KYC expired';
      }
    }

    // Compliance officers get detailed reasons
    // Regular users get generic reasons for privacy
    if (!isComplianceOfficer && reason) {
      reason = 'Verification failed';
    }

    return {
      success: true,
      data: { allowed, reason },
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================================================
// Router Setup
// ============================================================================

export const complianceRouter = Router();

// Apply auth middleware to attach user context (doesn't block)
complianceRouter.use(authMiddleware);
complianceRouter.use(rateLimitMiddleware);

// ============================================================================
// Public Endpoints (No auth required, limited data)
// ============================================================================

/**
 * GET /api/compliance/check/:address
 * Public endpoint - returns only boolean allowed/not-allowed
 * Issue #1294: Safe for anonymous callers
 */
complianceRouter.get('/check/:address', (req: Request, res: Response) => {
  const handler = new ComplianceRouteHandler();
  const result = handler.handleGetPublicStatus(req.params.address);
  res.status(result.success ? 200 : 404).json(result);
});

// ============================================================================
// Protected Endpoints (Require authentication)
// ============================================================================

/**
 * POST /api/compliance/verify
 * Verify participant for operation - REQUIRES AUTH
 * Issue #1294: Authenticated users only, limited response data
 */
complianceRouter.post('/verify', requireAuth, (req: Request, res: Response) => {
  const handler = new ComplianceRouteHandler();
  const isComplianceOfficer = req.user?.role === 'compliance_officer' || req.user?.role === 'admin';
  const result = handler.handleVerify(req.body, isComplianceOfficer);
  res.status(result.success ? 200 : 400).json(result);
});

// ============================================================================
// Compliance Officer Only Endpoints (Full data access)
// ============================================================================

/**
 * GET /api/compliance/status/:address
 * Get full compliance status - REQUIRES COMPLIANCE OFFICER
 * Issue #1294: Full data only for authorized compliance officers
 */
complianceRouter.get(
  '/status/:address',
  requireComplianceOfficer,
  (req: Request, res: Response) => {
    const handler = new ComplianceRouteHandler();
    const result = handler.handleGetFullStatus(req.params.address);
    res.status(result.success ? 200 : 404).json(result);
  }
);

/**
 * POST /api/compliance/freeze/:address
 * Freeze an account - REQUIRES COMPLIANCE OFFICER
 */
complianceRouter.post(
  '/freeze/:address',
  requireComplianceOfficer,
  (req: Request, res: Response) => {
    // TODO: Implement freeze logic
    res.json({
      success: true,
      message: `Account ${req.params.address} frozen`,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * POST /api/compliance/unfreeze/:address
 * Unfreeze an account - REQUIRES COMPLIANCE OFFICER
 */
complianceRouter.post(
  '/unfreeze/:address',
  requireComplianceOfficer,
  (req: Request, res: Response) => {
    // TODO: Implement unfreeze logic
    res.json({
      success: true,
      message: `Account ${req.params.address} unfrozen`,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * GET /api/compliance/health
 * Health check endpoint
 */
complianceRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Compliance API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

export default complianceRouter;
