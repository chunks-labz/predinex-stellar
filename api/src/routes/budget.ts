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
 * Mock contract interaction - replace with actual Stellar SDK calls
 */
class ContractService {
  async createBudgetPlan(request: CreatePlanRequest): Promise<BudgetPlan> {
    // TODO: Interact with Stellar contract
    // This is a placeholder implementation

    const reserveAmount =
      (BigInt(request.totalBudget) * BigInt(request.reservePct)) /
      BigInt(100);
    const allocatedAmount = BigInt(request.totalBudget) - reserveAmount;

    // Mock allocations
    const allocations: PoolAllocation[] = [
      {
        poolId: 1,
        allocatedAmount: (allocatedAmount / BigInt(3)).toString(),
        weightPct: 33.33,
        expectedReturn: '5000000',
        riskScore: 30,
      },
      {
        poolId: 2,
        allocatedAmount: (allocatedAmount / BigInt(3)).toString(),
        weightPct: 33.33,
        expectedReturn: '7000000',
        riskScore: 45,
      },
      {
        poolId: 3,
        allocatedAmount: (allocatedAmount / BigInt(3)).toString(),
        weightPct: 33.34,
        expectedReturn: '6000000',
        riskScore: 38,
      },
    ];

    return {
      lender: request.lenderAddress,
      totalBudget: request.totalBudget,
      allocatedAmount: allocatedAmount.toString(),
      reserveAmount: reserveAmount.toString(),
      allocations,
      strategy: request.strategy,
      expectedTotalReturn: '18000000',
      portfolioRiskScore: 38,
      diversificationScore: 75,
      createdAt: new Date().toISOString(),
    };
  }

  async getPortfolioMetrics(lenderAddress: string): Promise<PortfolioMetrics> {
    // TODO: Query contract for actual metrics
    return {
      totalInvested: '100000000000',
      currentValue: '108000000000',
      totalReturn: '8000000000',
      returnPct: 8.0,
      feeRevenue: '2000000000',
      activePools: 5,
      settledPools: 12,
      sharpeRatio: 1.25,
      lastUpdated: new Date().toISOString(),
    };
  }

  async projectLiquidity(
    lenderAddress: string,
    horizon: PlanningHorizon
  ): Promise<LiquidityProjection> {
    // TODO: Calculate projections from contract state
    return {
      currentLiquid: '25000000000',
      lockedUntilTimestamp: Date.now() / 1000 + 86400 * 7,
      expectedReturns7d: '1500000000',
      expectedReturns30d: '6000000000',
      minimumReserveNeeded: '10000000000',
      excessCapacity: '15000000000',
    };
  }

  async optimizeFees(request: OptimizeFeesRequest): Promise<FeeOptimization> {
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

  async assessRisk(poolIds: number[]): Promise<RiskAssessment> {
    // TODO: Calculate from contract data
    // This is a simplified mock implementation

    const volatilityScore = 35;
    const liquidityRisk = 25;
    const concentrationRisk = poolIds.length < 3 ? 60 : 30;
    const timeRisk = 20;

    const overallRiskScore =
      volatilityScore * 0.3 +
      liquidityRisk * 0.25 +
      concentrationRisk * 0.25 +
      timeRisk * 0.2;

    return {
      volatilityScore,
      liquidityRisk,
      concentrationRisk,
      timeRisk,
      overallRiskScore: Math.floor(overallRiskScore),
    };
  }
}

// ============================================================================
// Route Handlers
// ============================================================================

const router = Router();
const contractService = new ContractService();

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

      const plan = await contractService.createBudgetPlan(request);

      res.json({
        success: true,
        data: plan,
      });
    } catch (error) {
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

      const metrics = await contractService.getPortfolioMetrics(lenderAddress);

      res.json({
        success: true,
        data: metrics,
      });
    } catch (error) {
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

      const projection = await contractService.projectLiquidity(
        lenderAddress,
        horizon
      );

      res.json({
        success: true,
        data: projection,
      });
    } catch (error) {
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

      const optimization = await contractService.optimizeFees(request);

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

      const assessment = await contractService.assessRisk(poolIds);

      res.json({
        success: true,
        data: assessment,
      });
    } catch (error) {
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
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Budget Planner API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

export default router;
