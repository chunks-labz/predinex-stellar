/**
 * OpenAPI 3.1 Specification for PrediNx Budget Planner API
 * Generated and maintained automatically - see scripts/generate-sdk.sh
 *
 * Base path: /api
 * Version: 1.0.0
 * Contact: predinex-dev@stellar.org
 * License: Apache-2.0
 */



/**
 * Base Schemas - Shared across all modules
 */
export const baseSchemas = {
  // Error response structures
  Error400: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'VALIDATION_ERROR' },
          message: { type: 'string' },
          details: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific field validation errors',
          },
        },
        required: ['code', 'message'],
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
    required: ['success', 'error', 'timestamp'],
    additionalProperties: false,
  },

  Error401: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'UNAUTHORIZED' },
          message: { type: 'string' },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
    required: ['success', 'error', 'timestamp'],
    additionalProperties: false,
  },

  Error404: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'NOT_FOUND' },
          message: { type: 'string' },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
    required: ['success', 'error', 'timestamp'],
    additionalProperties: false,
  },

  Error429: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'RATE_LIMITED' },
          message: { type: 'string' },
          retryAfter: { type: 'integer', format: 'int32' },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
    required: ['success', 'error', 'timestamp'],
    additionalProperties: false,
  },

  Error500: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'INTERNAL_ERROR' },
          message: { type: 'string' },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' },
    },
    required: ['success', 'error', 'timestamp'],
    additionalProperties: false,
  },

  // Success response wrapper
  Success200: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { $ref: '#/components/schemas/GenericData' },
    },
    required: ['success', 'data'],
    additionalProperties: false,
  },

  Success201: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: { $ref: '#/components/schemas/GenericData' },
    },
    required: ['success', 'data'],
    additionalProperties: false,
  },

  // Generic data wrapper for 200/201 responses
  GenericData: {
    type: 'object',
    description: 'Generic data wrapper - actual type varies by endpoint',
    additionalProperties: true,
  },

  // Pagination metadata
  PaginationMeta: {
    type: 'object',
    properties: {
      page: { type: 'integer', format: 'int32', example: 1 },
      limit: { type: 'integer', format: 'int32', example: 20 },
      total: { type: 'integer', format: 'int32', example: 100 },
      totalPages: { type: 'integer', format: 'int32', example: 5 },
    },
    required: ['page', 'limit', 'total', 'totalPages'],
    additionalProperties: false,
  },

  // Timestamp type for BigInt/string serialization
  IsoTimestamp: {
    type: 'string',
    format: 'date-time',
    description: 'ISO 8601 timestamp - BigInt epoch milliseconds serialized as string',
  },

  // Stellar address type
  StellarAddress: {
    type: 'string',
    pattern: '^G[A-Z0-9]{55}$',
    description: 'Stellar account address (starting with G)',
  },
};

/**
 * Budget Module Schemas
 */
export const budgetSchemas = {
  CreatePlanRequest: {
    type: 'object',
    required: ['lenderAddress', 'totalBudget', 'strategy', 'riskTolerance', 'reservePct'],
    properties: {
      lenderAddress: { $ref: '#/components/schemas/StellarAddress' },
      totalBudget: { type: 'string', description: 'Total budget as string (BigInt serialization)' },
      strategy: {
        type: 'string',
        enum: ['equal_weight', 'size_weighted', 'return_weighted', 'risk_adjusted', 'custom'],
      },
      riskTolerance: {
        type: 'string',
        enum: ['conservative', 'moderate', 'aggressive'],
      },
      reservePct: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Reserve percentage (0-100)',
      },
    },
    additionalProperties: false,
  },

  BudgetPlanResponse: {
    type: 'object',
    description: 'Budget plan creation response',
    properties: {
      lender: { $ref: '#/components/schemas/StellarAddress' },
      totalBudget: { type: 'string' },
      allocatedAmount: { type: 'string' },
      reserveAmount: { type: 'string' },
      allocations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            poolId: { type: 'integer' },
            allocatedAmount: { type: 'string' },
            weightPct: { type: 'number' },
            expectedReturn: { type: 'string' },
            riskScore: { type: 'integer' },
          },
          required: ['poolId', 'allocatedAmount', 'weightPct', 'expectedReturn', 'riskScore'],
        },
      },
      strategy: {
        type: 'string',
        enum: ['equal_weight', 'size_weighted', 'return_weighted', 'risk_adjusted', 'custom'],
      },
      expectedTotalReturn: { type: 'string' },
      portfolioRiskScore: { type: 'integer' },
      diversificationScore: { type: 'integer' },
      createdAt: { $ref: '#/components/schemas/IsoTimestamp' },
    },
    required: ['lender', 'totalBudget', 'allocatedAmount', 'reserveAmount', 'allocations', 'strategy', 'expectedTotalReturn', 'portfolioRiskScore', 'diversificationScore', 'createdAt'],
  },

  PortfolioMetricsResponse: {
    type: 'object',
    properties: {
      totalInvested: { type: 'string' },
      currentValue: { type: 'string' },
      totalReturn: { type: 'string' },
      returnPct: { type: 'number' },
      feeRevenue: { type: 'string' },
      activePools: { type: 'integer' },
      settledPools: { type: 'integer' },
      sharpeRatio: { type: 'number' },
      lastUpdated: { $ref: '#/components/schemas/IsoTimestamp' },
    },
    required: ['totalInvested', 'currentValue', 'totalReturn', 'returnPct', 'feeRevenue', 'activePools', 'settledPools', 'sharpeRatio', 'lastUpdated'],
  },

  LiquidityProjectionResponse: {
    type: 'object',
    properties: {
      currentLiquid: { type: 'string' },
      lockedUntilTimestamp: { type: 'integer', format: 'int32' },
      expectedReturns7d: { type: 'string' },
      expectedReturns30d: { type: 'string' },
      minimumReserveNeeded: { type: 'string' },
      excessCapacity: { type: 'string' },
    },
    required: ['currentLiquid', 'lockedUntilTimestamp', 'expectedReturns7d', 'expectedReturns30d', 'minimumReserveNeeded', 'excessCapacity'],
  },

  FeeOptimizationResponse: {
    type: 'object',
    properties: {
      currentFeeBps: { type: 'integer' },
      recommendedFeeBps: { type: 'integer' },
      expectedVolumeImpactPct: { type: 'number' },
      expectedRevenueImpact: { type: 'string' },
      competitivenessScore: { type: 'integer' },
    },
    required: ['currentFeeBps', 'recommendedFeeBps', 'expectedVolumeImpactPct', 'expectedRevenueImpact', 'competitivenessScore'],
  },

  RiskAssessmentResponse: {
    type: 'object',
    properties: {
      volatilityScore: { type: 'integer' },
      liquidityRisk: { type: 'integer' },
      concentrationRisk: { type: 'integer' },
      timeRisk: { type: 'integer' },
      overallRiskScore: { type: 'integer' },
    },
    required: ['volatilityScore', 'liquidityRisk', 'concentrationRisk', 'timeRisk', 'overallRiskScore'],
  },
};

/**
 * Gas Estimate Module Schemas
 */
export const gasEstimateSchemas = {
  OperationType: {
    type: 'string',
    enum: ['create_pool', 'place_bet', 'settle_pool', 'claim_winnings', 'cancel_bet', 'extend_pool', 'batch_settle', 'claim_all_winnings'],
  },

  GasEstimate: {
    type: 'object',
    properties: {
      operation: { $ref: '#/components/schemas/OperationType' },
      estimatedInstructions: { type: 'integer' },
      estimatedCpuCost: { type: 'number' },
      estimatedMemoryCost: { type: 'number' },
      estimatedStorageCost: { type: 'number' },
      totalCost: { type: 'number' },
      optimizationLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
      timestamp: { type: 'integer', format: 'int64' },
    },
    required: ['operation', 'estimatedInstructions', 'estimatedCpuCost', 'estimatedMemoryCost', 'estimatedStorageCost', 'totalCost', 'optimizationLevel', 'timestamp'],
  },

  OptimizationSuggestion: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      estimatedSavings: { type: 'number' },
      implementationComplexity: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      category: { type: 'string', enum: ['storage', 'computation', 'network', 'batching'] },
      codeExample: { type: 'string' },
    },
    required: ['id', 'title', 'description', 'priority', 'estimatedSavings', 'implementationComplexity', 'category'],
  },

  GasAnalysisReport: {
    type: 'object',
    properties: {
      estimates: {
        type: 'array',
        items: { $ref: '#/components/schemas/GasEstimate' },
      },
      suggestions: {
        type: 'array',
        items: { $ref: '#/components/schemas/OptimizationSuggestion' },
      },
      totalEstimatedCost: { type: 'number' },
      averageOptimizationPotential: { type: 'number' },
      timestamp: { type: 'integer', format: 'int64' },
      contractId: { type: 'string' },
    },
    required: ['estimates', 'suggestions', 'totalEstimatedCost', 'averageOptimizationPotential', 'timestamp', 'contractId'],
  },
};

/**
 * Insurance Module Schemas
 */
export const insuranceSchemas = {
  // Insurance route schemas would go here
};

/**
 * Referral Module Schemas
 */
export const referralSchemas = {
  // Referral route schemas would go here
};

/**
 * Reputation Module Schemas
 */
export const reputationSchemas = {
  // Reputation route schemas would go here
};

/**
 * Emergency Module Schemas
 */
export const emergencySchemas = {
  // Emergency route schemas would go here
};

/**
 * Simulation Module Schemas
 */
export const simulationSchemas = {
  // Simulation route schemas would go here
};

/**
 * Full OpenAPI 3.1 Specification
 */
export const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'PrediNx Budget Planner API',
    version: '1.0.0',
    description: 'RESTful API for PrediNx prediction market protocol - budget, compliance, emergency, gas estimation, insurance, referral, reputation, and simulation modules',
    contact: {
      name: 'PrediNx Dev Team',
      email: 'predinex-dev@stellar.org',
    },
    license: {
      name: 'Apache-2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0.html',
    },
    termsOfService: 'https://predinex.stellar.org/terms',
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Local development server (npm run dev, PORT=3001)',
    },
    {
      url: 'https://api.predinex.stellar.org',
      description: 'Production server',
    },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness probe',
        responses: { '200': { description: 'Process is up' } },
      },
    },
    '/api/health': {
      get: {
        summary: 'Liveness probe under the API prefix',
        responses: { '200': { description: 'Process is up' } },
      },
    },
    '/api/openapi.json': {
      get: {
        summary: 'OpenAPI document for this server',
        responses: { '200': { description: 'OpenAPI 3.1 JSON' } },
      },
    },
    '/api/budget/plan': {
      post: { summary: 'Create a budget plan', responses: { '200': { description: 'Budget plan' } } },
    },
    '/api/budget/portfolio/{lenderAddress}': {
      get: { summary: 'Get portfolio metrics', responses: { '200': { description: 'Portfolio metrics' } } },
    },
    '/api/budget/liquidity/{lenderAddress}': {
      get: { summary: 'Project liquidity', responses: { '200': { description: 'Liquidity projection' } } },
    },
    '/api/budget/optimize-fees': {
      post: { summary: 'Fee optimization recommendations', responses: { '200': { description: 'Fee optimization' } } },
    },
    '/api/budget/risk-assessment': {
      post: { summary: 'Assess pool risk', responses: { '200': { description: 'Risk assessment' } } },
    },
    '/api/budget/health': {
      get: { summary: 'Budget service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/compliance/verify': {
      post: { summary: 'Verify a transaction against compliance rules', responses: { '200': { description: 'Compliance verdict' } } },
    },
    '/api/compliance/register': {
      post: { summary: 'Register a participant (officer/admin only)', responses: { '200': { description: 'Compliance record' } } },
    },
    '/api/compliance/status/{address}': {
      get: { summary: 'Get compliance status', responses: { '200': { description: 'Compliance record' } } },
    },
    '/api/compliance/health': {
      get: { summary: 'Compliance service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/emergency/activate': {
      post: { summary: 'Activate emergency mode (admin, real on-chain tx)', responses: { '200': { description: 'Activation tx hash' } } },
    },
    '/api/emergency/deactivate': {
      post: { summary: 'Deactivate emergency mode (admin, real on-chain tx)', responses: { '200': { description: 'Deactivation tx hash' } } },
    },
    '/api/emergency/withdraw/request': {
      post: { summary: 'Create an emergency withdrawal request', responses: { '200': { description: 'Request + tx hash' } } },
    },
    '/api/emergency/withdraw/approve': {
      post: { summary: 'Approve a withdrawal request', responses: { '200': { description: 'Approval tx hash' } } },
    },
    '/api/emergency/withdraw/execute': {
      post: { summary: 'Execute an approved withdrawal', responses: { '200': { description: 'Execution tx hash' } } },
    },
    '/api/emergency/withdraw/cancel': {
      post: { summary: 'Cancel a withdrawal request', responses: { '200': { description: 'Cancellation tx hash' } } },
    },
    '/api/emergency/admin/add': {
      post: { summary: 'Add a secondary admin', responses: { '200': { description: 'Add-admin tx hash' } } },
    },
    '/api/emergency/config/update': {
      post: { summary: 'Update emergency configuration', responses: { '200': { description: 'Update tx hash' } } },
    },
    '/api/emergency/config': {
      get: { summary: 'Get emergency configuration', responses: { '200': { description: 'Emergency config' } } },
    },
    '/api/emergency/status': {
      get: { summary: 'Get emergency system status', responses: { '200': { description: 'System status' } } },
    },
    '/api/emergency/audit-logs': {
      get: { summary: 'Get emergency audit logs', responses: { '200': { description: 'Audit logs' } } },
    },
    '/api/emergency/health': {
      get: { summary: 'Emergency service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/gas-estimate/estimate': {
      post: { summary: 'Estimate gas for an operation', responses: { '200': { description: 'Gas estimate' } } },
    },
    '/api/gas-estimate/suggestions': {
      post: { summary: 'Gas optimization suggestions', responses: { '200': { description: 'Suggestions' } } },
    },
    '/api/gas-estimate/report': {
      post: { summary: 'Full gas analysis report', responses: { '200': { description: 'Analysis report' } } },
    },
    '/api/gas-estimate/health': {
      get: { summary: 'Gas estimator health', responses: { '200': { description: 'OK' } } },
    },
    '/api/insurance/pools': {
      get: { summary: 'List insurance pools', responses: { '200': { description: 'Pool list' } } },
    },
    '/api/insurance/quote': {
      post: { summary: 'Get an insurance quote', responses: { '200': { description: 'Quote' } } },
    },
    '/api/insurance/purchase': {
      post: { summary: 'Purchase a policy', responses: { '200': { description: 'Policy' } } },
    },
    '/api/insurance/claim': {
      post: { summary: 'Submit a claim', responses: { '200': { description: 'Claim' } } },
    },
    '/api/insurance/audit/{poolId}': {
      get: { summary: 'Solvency audit for a pool', responses: { '200': { description: 'Audit' } } },
    },
    '/api/insurance/health': {
      get: { summary: 'Insurance service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/referral': {
      post: { summary: 'Create a referral (stub, 501 until on-chain wiring)', responses: { '501': { description: 'Not implemented' } } },
    },
    '/api/referral/health': {
      get: { summary: 'Referral service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/reputation/profile/{address}': {
      get: { summary: 'Get reputation profile', responses: { '200': { description: 'Profile' } } },
    },
    '/api/reputation/simulate': {
      post: { summary: 'Simulate reputation impact', responses: { '200': { description: 'Simulation' } } },
    },
    '/api/reputation/leaderboard': {
      get: { summary: 'Top reputations', responses: { '200': { description: 'Leaderboard' } } },
    },
    '/api/reputation/health': {
      get: { summary: 'Reputation service health', responses: { '200': { description: 'OK' } } },
    },
    '/api/simulation/simulate': {
      post: { summary: 'Simulate position health', responses: { '200': { description: 'Simulation result' } } },
    },
    '/api/simulation/position-health': {
      post: { summary: 'Simulate position health (alias)', responses: { '200': { description: 'Simulation result' } } },
    },
    '/api/simulation/health': {
      get: { summary: 'Simulation service health', responses: { '200': { description: 'OK' } } },
    },
  },
  components: {
    schemas: {
      ...baseSchemas,
      ...budgetSchemas,
      ...gasEstimateSchemas,
      // ...insuranceSchemas,
      // ...referralSchemas,
      // ...reputationSchemas,
      // ...emergencySchemas,
      // ...simulationSchemas,
    },
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      bearerAuth: [''],
    },
  ],
};