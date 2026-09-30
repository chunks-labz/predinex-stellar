import { Request, Response, Router } from 'express';
import { body, validationResult } from 'express-validator';
import { BigInt } from 'big-integer';
import { BudgetOptimizationResult } from '../../types';

const router = Router();

/**
 * Budget optimization endpoint
 */
router.post('/optimize-fees', [
  body('currentFeeBps')
    .isInt({ min: 0, max: 10000 })
    .withMessage('Current fee must be 0-10000 bps'),
  body('avgPoolSize').isInt({ min: 0 }).withMessage('Pool size must be positive'),
  body('competitorFees').isArray().withMessage('Competitor fees must be an array'),
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const request = req.body;
    const competitorFees = request.competitorFees || [];
    const marketAvg = competitorFees.length > 0
      ? competitorFees.reduce((sum, fee) => sum + fee, 0) / competitorFees.length
      : 0;

    const recommendedFee = marketAvg > 0 ? Math.round(marketAvg) : 50;

  /**
   * Retrieves the lender's current on-chain balance.
   */
  /**
   * Get lender's on-chain balance
   * Issue #1295: Throws when no provider configured instead of returning 0n
   */
  public async getLenderBalance(lenderAddress: string): Promise<bigint> {
    if (!this.balanceProvider) {
      throw new Error('Balance provider not configured');
    }
    return this.balanceProvider(lenderAddress);
  }

  /**
   * Check if balance provider is configured
   * Issue #1295: Allows routes to return 501 instead of misleading 400
   */
  public hasBalanceProvider(): boolean {
    return this.balanceProvider !== undefined;
  }
    // Guard against division by zero
    const feeChangePct = request.currentFeeBps > 0
      ? ((recommendedFee - request.currentFeeBps) / request.currentFeeBps) * 100
      : 0;
    const volumeImpactPct = feeChangePct * -2;
    const clampedVolumeImpact = Math.max(-99, Math.min(99, volumeImpactPct));

    const newVolume = (BigInt(request.avgPoolSize) * BigInt(100 + Math.floor(clampedVolumeImpact))) / BigInt(100);

    const competitiveness = marketAvg > 0
      ? (request.currentFeeBps - marketAvg) / marketAvg
      : 0;

    const result: BudgetOptimizationResult = {
      recommendedFee,
      feeChangePct,
      volumeImpactPct: clampedVolumeImpact,
      newVolume: newVolume.toString(),
      competitiveness,
      status: 'success'
    };

    res.json(result);
  } catch (error) {
    console.error('Budget optimization error:', error);
    res.status(500).json({ error: 'Failed to optimize fees' });
  }
});

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
        // Issue #1295: Return 501 when balance provider not wired
        if (!service.hasBalanceProvider()) {
          return res.status(501).json({
            success: false,
            error: 'On-chain balance provider not configured',
            hint: 'The server has not been configured to query on-chain balances. Contact the administrator.',
          });
        }

        const request: CreatePlanRequest = req.body;

        // Additional business logic validation
        const budgetBigInt = BigInt(request.totalBudget);
        if (budgetBigInt <= 0) {
          return res.status(400).json({
            success: false,
            error: 'Total budget must be positive',
          });
        }

        // Issue #1295: Check actual on-chain balance
        const availableBalance = await service.getLenderBalance(request.lenderAddress);
        if (budgetBigInt > availableBalance) {
          return res.status(400).json({
            success: false,
            error: 'Budget exceeds available on-chain balance',
            availableBalance: availableBalance.toString(),
            requestedBudget: request.totalBudget,
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
export default router;