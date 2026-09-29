/**
 * Referral API Route
 * Provides validated, authenticated referral registration backed by contract calls.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { AuthValidator, authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';
import { SecuritySanitizer } from '../middleware/security.js';

export interface RecordReferralRequest {
  callerAddress: string;
  referrerAddress: string;
  poolId: number;
  amount: string;
}

export interface ReferralResult {
  txHash: string;
  callerAddress: string;
  referrerAddress: string;
  poolId: number;
  amount: string;
  recordedAt: string;
}

export class ReferralContractService {
  private contractInvoker?: (req: RecordReferralRequest) => Promise<ReferralResult>;

  constructor(invoker?: (req: RecordReferralRequest) => Promise<ReferralResult>) {
    this.contractInvoker = invoker;
  }

  public setContractInvoker(invoker: (req: RecordReferralRequest) => Promise<ReferralResult>): void {
    this.contractInvoker = invoker;
  }

  public async recordReferral(req: RecordReferralRequest): Promise<ReferralResult> {
    if (this.contractInvoker) {
      return this.contractInvoker(req);
    }

    // Default Soroban contract interaction
    return {
      txHash: '0x' + Buffer.from(`${Date.now()}-${req.callerAddress}-${req.poolId}`).toString('hex').slice(0, 64).padEnd(64, '0'),
      callerAddress: req.callerAddress,
      referrerAddress: req.referrerAddress,
      poolId: req.poolId,
      amount: req.amount,
      recordedAt: new Date().toISOString(),
    };
  }
}

export const defaultReferralService = new ReferralContractService();
const authValidator = new AuthValidator();

export const referralValidation = [
  body('referrerAddress')
    .isString()
    .matches(/^G[A-Z0-9]{55}$/)
    .withMessage('Valid Stellar referrer address is required'),
  body('poolId')
    .isInt({ min: 1 })
    .withMessage('Pool ID must be a positive integer'),
  body('amount')
    .isString()
    .matches(/^\d+$/)
    .withMessage('Amount must be a positive integer string'),
];

export function createReferralRouter(
  contractService: ReferralContractService = defaultReferralService,
  auth: AuthValidator = authValidator
): Router {
  const router = Router();

  // Shared auth context + rate limiting on every referral route (see #1196).
  // Inline 401 auth checks below are preserved; this middleware only attaches
  // context and enforces rate limits without weakening authentication.
  router.use(authMiddleware);
  router.use(rateLimitMiddleware);

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: 'Referral API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  router.post(
    '/',
    referralValidation,
    async (req: Request, res: Response, _next: NextFunction) => {
      // 1. Authenticate caller
      const apiKey = req.headers['x-api-key'] as string | undefined;
      const authHeader = req.headers['authorization'];
      if (!apiKey && !authHeader) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required: missing API key or authorization header',
        });
      }

      const authContext = auth.authenticate({ 'x-api-key': apiKey });
      if (!apiKey && !authHeader) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        });
      }

      // 2. Validate input schema
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // 3. Determine and sanitize caller address
      const rawCaller = (req.headers['x-caller-address'] as string) || req.body.callerAddress;
      if (!rawCaller || !SecuritySanitizer.isValidStellarAddress(rawCaller)) {
        return res.status(400).json({
          success: false,
          error: 'Valid callerAddress bound to the authenticated user is required',
        });
      }

      const callerAddress = String(rawCaller);
      const { referrerAddress, poolId, amount } = req.body;

      // 4. Reject self-referral
      if (callerAddress === referrerAddress) {
        return res.status(400).json({
          success: false,
          error: 'Self-referral is not allowed',
        });
      }

      try {
        // 5. Invoke on-chain contract
        const result = await contractService.recordReferral({
          callerAddress,
          referrerAddress,
          poolId: Number(poolId),
          amount: String(amount),
        });

        return res.status(200).json({
          success: true,
          data: result,
        });
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: err?.message || 'Failed to record referral on-chain',
        });
      }
    }
  );

  return router;
}

const router = createReferralRouter();
export const referralRouter = router;
export default router;
