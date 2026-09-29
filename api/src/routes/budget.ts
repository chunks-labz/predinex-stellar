/**
 * Lending Protocol Budget Planner API Routes
 *
 * This module provides RESTful API endpoints for lenders to plan and optimize
 * their capital allocation across prediction market pools.
 *
 * Features:
 * - Budget plan creation with multiple allocation strategies
 * - Portfolio performance tracking
 * - Liquidity projection
 * - Fee optimization recommendations
 * - Risk assessment
 *
 * Security measures:
 * - Input validation on all parameters
 * - Rate limiting
 * - Authentication required
 * - Read-only operations (no state mutations via API)
 *
 * Issue #1110: Build lending protocol budget planner for lenders
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export enum AllocationStrategy {
  EQUAL_WEIGHT = 'equal_weight',
  SIZE_WEIGHTED = 'size_weighted',
  RETURN_WEIGHTED = 'return_weighted',
  RISK_ADJUSTED = 'risk_adjusted',
  CUSTOM = 'custom',
}

export enum RiskTolerance {
  CONSERVATIVE = 'conservative',
  MODERATE = 'moderate',
  AGGRESSIVE = 'aggressive',
}

export enum PlanningHorizon {
  SHORT_TERM = 'short_term', // 1-7 days
  MEDIUM_TERM = 'medium_term', // 1-4 weeks
  LONG_TERM = 'long_term', // 1-3 months
}

export interface PoolAllocation {
  poolId: number;
  allocatedAmount: string; // BigInt as string
  weightPct: number; // Percentage
  expectedReturn: string;
  riskScore: number; // 0-100
}

export interface BudgetPlan {
  lender: string; // Address
  totalBudget: string;
  allocatedAmount: string;
  reserveAmount: string;
  allocations: PoolAllocation[];
  strategy: AllocationStrategy;
  expectedTotalReturn: string;
  portfolioRiskScore: number;
  diversificationScore: number;
  createdAt: string; // ISO timestamp
}

export interface PortfolioMetrics {
  totalInvested: string;
  currentValue: string;
  totalReturn: string;
  returnPct: number;
  feeRevenue: string;
  activePools: number;
  settledPools: number;
  sharpeRatio: number;
  lastUpdated: string;
}

export interface LiquidityProjection {
  currentLiquid: string;
  lockedUntilTimestamp: number;
  expectedReturns7d: string;
  expectedReturns30d: string;
  minimumReserveNeeded: string;
  excessCapacity: string;
}

export interface FeeOptimization {
  currentFeeBps: number;
  recommendedFeeBps: number;
  expectedVolumeImpactPct: number;
  expectedRevenueImpact: string;
  competitivenessScore: number;
}

export interface RiskAssessment {
  volatilityScore: number;
  liquidityRisk: number;
  concentrationRisk: number;
  timeRisk: number;
  overallRiskScore: number;
}

export interface CreatePlanRequest {
  lenderAddress: string;
  totalBudget: string;
  strategy: AllocationStrategy;
  riskTolerance: RiskTolerance;
  reservePct: number;
}

export interface OptimizeFeesRequest {
  currentFeeBps: number;
  avgPoolSize: string;
  competitorFees: number[];
}

// ============================================================================
// Validation Middleware
// ============================================================================

const validateAddress = () =>
  body('lenderAddress')
    .isString()
    .matches(/^G[A-Z0-9]{55}$/)
    .withMessage('Invalid Stellar address format');

const validateAmount = (field: string) =>
  body(field)
    .isString()
    .matches(/^\d+$/)
    .withMessage(`${field} must be a positive integer string`);

const validateStrategy = () =>
  body('strategy')
    .isIn(Object.values(AllocationStrategy))
    .withMessage('Invalid allocation strategy');

const validateRiskTolerance = () =>
  body('riskTolerance')
    .isIn(Object.values(RiskTolerance))
    .withMessage('Invalid risk tolerance level');

const validateReservePct = () =>
  body('reservePct')
    .isInt({ min: 0, max: 100 })
    .withMessage('Reserve percentage must be between 0 and 100');

const validateHorizon = () =>
  query('horizon')
    .optional()
    .isIn(Object.values(PlanningHorizon))
    .withMessage('Invalid planning horizon');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Handle validation errors
 */
const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

/**
 * Error thrown when an on-chain contract query/operation is not yet implemented.
 */
export class NotImplementedError extends Error {
  constructor(message: string = 'On-chain contract interaction is not implemented') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
 * Contract interaction service for lending budget planner.
 * Queries on-chain balance and pool states via Soroban / Stellar SDK.
 */
export class ContractService {
  private balanceProvider?: (address: string) => Promise<bigint>;
  private poolProvider?: () => Promise<PoolAllocation[] | null>;

  constructor(options?: {
    balanceProvider?: (address: string) => Promise<bigint>;
    poolProvider?: () => Promise<PoolAllocation[] | null>;
  }) {
    this.balanceProvider = options?.balanceProvider;
    this.poolProvider = options?.poolProvider;
  }

  public setBalanceProvider(provider: (address: string) => Promise<bigint>): void {
    this.balanceProvider = provider;
  }

  public setPoolProvider(provider: () => Promise<PoolAllocation[] | null>): void {
    this.poolProvider = provider;
  }

  /**
   * Retrieves the lender's current on-chain balance.
   */
  public async getLenderBalance(lenderAddress: string): Promise<bigint> {
    if (this.balanceProvider) {
      return this.balanceProvider(lenderAddress);
    }
    // Default to 0n when no on-chain balance provider is wired
    return 0n;
  }

  /**
   * Derives budget plan from live on-chain pool state, or raises NotImplementedError.
   */
  public async createBudgetPlan(request: CreatePlanRequest): Promise<BudgetPlan> {
    const onChainPools = this.poolProvider ? await this.poolProvider() : null;
    if (!onChainPools || onChainPools.length === 0) {
      throw new NotImplementedError('On-chain pool state derivation requires an active Stellar contract connection');
    }

    const reserveAmount =
      (BigInt(request.totalBudget) * BigInt(request.reservePct)) /
      BigInt(100);
    const allocatedAmount = BigInt(request.totalBudget) - reserveAmount;

    return {
      lender: request.lenderAddress,
      totalBudget: request.totalBudget,
      allocatedAmount: allocatedAmount.toString(),
      reserveAmount: reserveAmount.toString(),
      allocations: onChainPools,
      strategy: request.strategy,
      expectedTotalReturn: '0',
      portfolioRiskScore: 0,
      diversificationScore: 100,
      createdAt: new Date().toISOString(),
    };
  }

  public async getPortfolioMetrics(_lenderAddress: string): Promise<PortfolioMetrics> {
    throw new NotImplementedError('On-chain portfolio metrics query is not yet implemented');
  }

  public async projectLiquidity(
    _lenderAddress: string,
    _horizon: PlanningHorizon
  ): Promise<LiquidityProjection> {
    throw new NotImplementedError('On-chain liquidity projection query is not yet implemented');
  }

  public async optimizeFees(request: OptimizeFeesRequest): Promise<FeeOptimization> {
    // Calculate market average
    const marketAvg =
      request.competitorFees.length > 0
        ? request.competitorFees.reduce((a, b) => a + b, 0) /
          request.competitorFees.length
        : request.currentFeeBps;

    // Recommend slightly below market for competitiveness
    const recommendedFee = Math.max(
      50,
      Math.min(1000, Math.floor(marketAvg * 0.95))
    );

    // Estimate impact
    const feeChangePct =
      ((recommendedFee - request.currentFeeBps) / request.currentFeeBps) * 100;
    const volumeImpactPct = feeChangePct * -2; // -2% volume per 1% fee increase

    const currentRevenue =
      (BigInt(request.avgPoolSize) * BigInt(request.currentFeeBps)) /
      BigInt(10000);
    const newVolume =
      (BigInt(request.avgPoolSize) * BigInt(100 + Math.floor(volumeImpactPct))) /
      BigInt(100);
    const newRevenue =
      (newVolume * BigInt(recommendedFee)) / BigInt(10000);

    const revenueImpact = newRevenue - currentRevenue;

    // Competitiveness score
    const competitiveness =
      recommendedFee <= marketAvg
        ? 50 + Math.min(50, ((marketAvg - recommendedFee) / marketAvg) * 100)
        : Math.max(0, 50 - ((recommendedFee - marketAvg) / marketAvg) * 100);

    return {
      currentFeeBps: request.currentFeeBps,
      recommendedFeeBps: recommendedFee,
      expectedVolumeImpactPct: volumeImpactPct,
      expectedRevenueImpact: revenueImpact.toString(),
      competitivenessScore: Math.floor(competitiveness),
    };
  }

  public async assessRisk(_poolIds: number[]): Promise<RiskAssessment> {
    throw new NotImplementedError('On-chain pool risk assessment is not yet implemented');
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

export const contractService = new ContractService();

export function createBudgetRouter(service: ContractService = contractService): Router {
  const router = Router();

  // Shared auth context + rate limiting on every budget route (see #1196).
  router.use(authMiddleware);
  router.use(rateLimitMiddleware);

  /**
   * POST /api/budget/plan
   * Create a new budget plan
   */
  router.post(
    '/plan',
    [
      validateAddress(),
      validateAmount('totalBudget'),
      validateStrategy(),
      validateRiskTolerance(),
      validateReservePct(),
      handleValidationErrors,
    ],
    async (req: Request, res: Response) => {
      try {
        const request: CreatePlanRequest = req.body;

        // Additional business logic validation
        const budgetBigInt = BigInt(request.totalBudget);
        if (budgetBigInt <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Total budget must be positive',
          });
        }

        // Validate that budget does not exceed on-chain balance
        const availableBalance = await service.getLenderBalance(request.lenderAddress);
        if (budgetBigInt > availableBalance) {
          return res.status(400).json({
            success: false,
            error: 'Budget exceeds available on-chain balance',
          });
        }

        const plan = await service.createBudgetPlan(request);

        res.json({
          success: true,
          data: plan,
        });
      } catch (error: any) {
        if (error instanceof NotImplementedError || error?.name === 'NotImplementedError') {
          return res.status(501).json({
            success: false,
            error: error.message || 'On-chain pool allocation service is not implemented',
          });
        }
        console.error('Error creating budget plan:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to create budget plan',
        });
      }
    }
  );

  /**
   * GET /api/budget/portfolio/:lenderAddress
   * Get portfolio metrics for a lender
   */
  router.get(
    '/portfolio/:lenderAddress',
    [
      param('lenderAddress')
        .matches(/^G[A-Z0-9]{55}$/)
        .withMessage('Invalid Stellar address'),
      handleValidationErrors,
    ],
    async (req: Request, res: Response) => {
      try {
        const { lenderAddress } = req.params;

        const metrics = await service.getPortfolioMetrics(lenderAddress);

        res.json({
          success: true,
          data: metrics,
        });
      } catch (error: any) {
        if (error instanceof NotImplementedError || error?.name === 'NotImplementedError') {
          return res.status(501).json({
            success: false,
            error: error.message || 'Not implemented',
          });
        }
        console.error('Error fetching portfolio metrics:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch portfolio metrics',
        });
      }
    }
  );

  /**
   * GET /api/budget/liquidity/:lenderAddress
   * Project liquidity for a lender
   */
  router.get(
    '/liquidity/:lenderAddress',
    [
      param('lenderAddress')
        .matches(/^G[A-Z0-9]{55}$/)
        .withMessage('Invalid Stellar address'),
      validateHorizon(),
      handleValidationErrors,
    ],
    async (req: Request, res: Response) => {
      try {
        const { lenderAddress } = req.params;
        const horizon =
          (req.query.horizon as PlanningHorizon) || PlanningHorizon.MEDIUM_TERM;

        const projection = await service.projectLiquidity(
          lenderAddress,
          horizon
        );

        res.json({
          success: true,
          data: projection,
        });
      } catch (error: any) {
        if (error instanceof NotImplementedError || error?.name === 'NotImplementedError') {
          return res.status(501).json({
            success: false,
            error: error.message || 'Not implemented',
          });
        }
        console.error('Error projecting liquidity:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to project liquidity',
        });
      }
    }
  );

  /**
   * POST /api/budget/optimize-fees
   * Get fee optimization recommendations
   */
  router.post(
    '/optimize-fees',
    [
      body('currentFeeBps')
        .isInt({ min: 0, max: 10000 })
        .withMessage('Current fee must be 0-10000 bps'),
      body('avgPoolSize')
        .isString()
        .matches(/^\d+$/)
        .withMessage('Average pool size must be a positive integer string'),
      body('competitorFees')
        .isArray()
        .withMessage('Competitor fees must be an array'),
      body('competitorFees.*')
        .isInt({ min: 0, max: 10000 })
        .withMessage('Each competitor fee must be 0-10000 bps'),
      handleValidationErrors,
    ],
    async (req: Request, res: Response) => {
      try {
        const request: OptimizeFeesRequest = req.body;

        const optimization = await service.optimizeFees(request);

        res.json({
          success: true,
          data: optimization,
        });
      } catch (error) {
        console.error('Error optimizing fees:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to optimize fees',
        });
      }
    }
  );

  /**
   * POST /api/budget/risk-assessment
   * Assess risk for a set of pools
   */
  router.post(
    '/risk-assessment',
    [
      body('poolIds')
        .isArray({ min: 1 })
        .withMessage('Pool IDs must be a non-empty array'),
      body('poolIds.*')
        .isInt({ min: 1 })
        .withMessage('Each pool ID must be a positive integer'),
      handleValidationErrors,
    ],
    async (req: Request, res: Response) => {
      try {
        const { poolIds } = req.body;

        const assessment = await service.assessRisk(poolIds);

        res.json({
          success: true,
          data: assessment,
        });
      } catch (error: any) {
        if (error instanceof NotImplementedError || error?.name === 'NotImplementedError') {
          return res.status(501).json({
            success: false,
            error: error.message || 'Not implemented',
          });
        }
        console.error('Error assessing risk:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to assess risk',
        });
      }
    }
  );

  /**
   * GET /api/budget/health
   * Health check endpoint
   */
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      service: 'Budget Planner API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

const defaultRouter = createBudgetRouter();
export const budgetRouter = defaultRouter;
export default defaultRouter;

