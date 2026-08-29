/**
 * Comprehensive test suite for Gas Cost Estimator
 * Issue #1111: Build lending pool gas cost estimator and optimization suggestions
 */

import {
  GasEstimatorService,
  createGasEstimator,
  OperationType,
  GasEstimate,
  OptimizationSuggestion,
  GasAnalysisReport,
} from '../gasEstimate';

describe('GasEstimatorService', () => {
  let estimator: GasEstimatorService;
  const mockContractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  const mockRpcUrl = 'https://soroban-testnet.stellar.org';

  beforeEach(() => {
    estimator = createGasEstimator(mockRpcUrl, mockContractId);
  });

  describe('estimateOperation', () => {
    it('should estimate gas for create_pool operation', async () => {
      const estimate = await estimator.estimateOperation(OperationType.CREATE_POOL);

      expect(estimate).toBeDefined();
      expect(estimate.operation).toBe(OperationType.CREATE_POOL);
      expect(estimate.estimatedInstructions).toBeGreaterThan(0);
      expect(estimate.totalCost).toBeGreaterThan(0);
      expect(estimate.optimizationLevel).toMatch(/^(low|medium|high)$/);
    });

    it('should estimate gas for place_bet operation', async () => {
      const estimate = await estimator.estimateOperation(OperationType.PLACE_BET);

      expect(estimate).toBeDefined();
      expect(estimate.operation).toBe(OperationType.PLACE_BET);
      expect(estimate.estimatedInstructions).toBeGreaterThan(0);
      expect(estimate.estimatedCpuCost).toBeGreaterThan(0);
      expect(estimate.estimatedMemoryCost).toBeGreaterThan(0);
      expect(estimate.estimatedStorageCost).toBeGreaterThan(0);
    });

    it('should adjust estimates based on parameters', async () => {
      const simplePoolEstimate = await estimator.estimateOperation(
        OperationType.CREATE_POOL,
        { outcomes: ['Yes', 'No'] }
      );

      const complexPoolEstimate = await estimator.estimateOperation(
        OperationType.CREATE_POOL,
        { 
          outcomes: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
          description: 'A'.repeat(600) 
        }
      );

      expect(complexPoolEstimate.estimatedInstructions).toBeGreaterThan(
        simplePoolEstimate.estimatedInstructions
      );
      expect(complexPoolEstimate.totalCost).toBeGreaterThan(
        simplePoolEstimate.totalCost
      );
    });

    it('should handle settle_pool with participant count', async () => {
      const smallPoolEstimate = await estimator.estimateOperation(
        OperationType.SETTLE_POOL,
        { participant_count: 5 }
      );

      const largePoolEstimate = await estimator.estimateOperation(
        OperationType.SETTLE_POOL,
        { participant_count: 50 }
      );

      expect(largePoolEstimate.estimatedInstructions).toBeGreaterThan(
        smallPoolEstimate.estimatedInstructions
      );
    });

    it('should properly categorize optimization levels', async () => {
      const operations = [
        OperationType.CANCEL_BET,
        OperationType.PLACE_BET,
        OperationType.BATCH_SETTLE,
      ];

      for (const op of operations) {
        const estimate = await estimator.estimateOperation(op);
        expect(['low', 'medium', 'high']).toContain(estimate.optimizationLevel);
      }
    });
  });

  describe('simulateTransaction', () => {
    const mockCaller = 'GBDQ3AXKUFBWVQMDGJ7XUNBQBKR2XQBJ6KZGBJ3QXBFHQCADFJXGBKFC';

    it('should simulate place_bet transaction', async () => {
      const estimate = await estimator.simulateTransaction(
        OperationType.PLACE_BET,
        { pool_id: 1, outcome: 0, amount: 10000 },
        mockCaller
      );

      expect(estimate).toBeDefined();
      expect(estimate.operation).toBe(OperationType.PLACE_BET);
    });

    it('should handle simulation errors gracefully', async () => {
      const estimate = await estimator.simulateTransaction(
        OperationType.PLACE_BET,
        { invalid: 'params' },
        mockCaller
      );

      // Should fallback to static estimation
      expect(estimate).toBeDefined();
      expect(estimate.estimatedInstructions).toBeGreaterThan(0);
    });
  });

  describe('generateOptimizationSuggestions', () => {
    it('should suggest batching for multiple settle operations', async () => {
      const operations = [
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
      ];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBeGreaterThan(0);

      const batchSuggestion = suggestions.find(s => s.id === 'batch-operations');
      expect(batchSuggestion).toBeDefined();
      expect(batchSuggestion?.priority).toBe('high');
      expect(batchSuggestion?.category).toBe('batching');
      expect(batchSuggestion?.estimatedSavings).toBeGreaterThan(0);
    });

    it('should suggest batching for multiple claim operations', async () => {
      const operations = [
        OperationType.CLAIM_WINNINGS,
        OperationType.CLAIM_WINNINGS,
      ];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      const batchSuggestion = suggestions.find(s => s.id === 'batch-operations');
      expect(batchSuggestion).toBeDefined();
    });

    it('should include storage optimization suggestions', async () => {
      const operations = [OperationType.CREATE_POOL];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      const storageSuggestion = suggestions.find(s => s.category === 'storage');
      expect(storageSuggestion).toBeDefined();
      expect(storageSuggestion?.implementationComplexity).toMatch(/^(easy|medium|hard)$/);
    });

    it('should include computation optimization suggestions', async () => {
      const operations = [OperationType.SETTLE_POOL];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      expect(suggestions.length).toBeGreaterThan(0);
      suggestions.forEach(suggestion => {
        expect(suggestion).toHaveProperty('id');
        expect(suggestion).toHaveProperty('title');
        expect(suggestion).toHaveProperty('description');
        expect(suggestion).toHaveProperty('priority');
        expect(suggestion).toHaveProperty('estimatedSavings');
        expect(suggestion).toHaveProperty('implementationComplexity');
        expect(suggestion).toHaveProperty('category');
      });
    });

    it('should sort suggestions by priority', async () => {
      const operations = [
        OperationType.CREATE_POOL,
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
      ];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      const priorities = suggestions.map(s => s.priority);
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      
      for (let i = 0; i < priorities.length - 1; i++) {
        expect(priorityOrder[priorities[i]]).toBeGreaterThanOrEqual(
          priorityOrder[priorities[i + 1]]
        );
      }
    });

    it('should provide code examples for high-priority suggestions', async () => {
      const operations = [
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
      ];

      const suggestions = await estimator.generateOptimizationSuggestions(operations);

      const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
      highPrioritySuggestions.forEach(suggestion => {
        if (suggestion.id === 'batch-operations') {
          expect(suggestion.codeExample).toBeDefined();
          expect(suggestion.codeExample).toContain('batch_settle_pools');
        }
      });
    });
  });

  describe('generateAnalysisReport', () => {
    it('should generate comprehensive analysis report', async () => {
      const operations = [
        OperationType.CREATE_POOL,
        OperationType.PLACE_BET,
        OperationType.SETTLE_POOL,
        OperationType.CLAIM_WINNINGS,
      ];

      const report = await estimator.generateAnalysisReport(operations);

      expect(report).toBeDefined();
      expect(report.estimates).toHaveLength(operations.length);
      expect(report.suggestions).toBeDefined();
      expect(report.totalEstimatedCost).toBeGreaterThan(0);
      expect(report.averageOptimizationPotential).toBeGreaterThan(0);
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.contractId).toBe(mockContractId);
    });

    it('should calculate total cost correctly', async () => {
      const operations = [OperationType.CREATE_POOL, OperationType.PLACE_BET];

      const report = await estimator.generateAnalysisReport(operations);

      const manualTotal = report.estimates.reduce((sum, est) => sum + est.totalCost, 0);
      expect(report.totalEstimatedCost).toBe(manualTotal);
    });

    it('should calculate average optimization potential', async () => {
      const operations = [OperationType.SETTLE_POOL, OperationType.SETTLE_POOL];

      const report = await estimator.generateAnalysisReport(operations);

      expect(report.averageOptimizationPotential).toBeGreaterThan(0);
      expect(report.averageOptimizationPotential).toBeLessThanOrEqual(100);
    });
  });

  describe('compareApproaches', () => {
    it('should compare individual vs batch operations', async () => {
      const scenarios = [
        {
          name: 'individual_settlements',
          operations: [
            OperationType.SETTLE_POOL,
            OperationType.SETTLE_POOL,
            OperationType.SETTLE_POOL,
          ],
        },
        {
          name: 'batch_settlement',
          operations: [OperationType.BATCH_SETTLE],
        },
      ];

      const comparison = await estimator.compareApproaches(scenarios);

      expect(comparison).toBeDefined();
      expect(comparison.individual_settlements).toBeDefined();
      expect(comparison.batch_settlement).toBeDefined();

      expect(comparison.individual_settlements.totalCost).toBeGreaterThan(
        comparison.batch_settlement.totalCost
      );
    });

    it('should provide detailed breakdown for each scenario', async () => {
      const scenarios = [
        { name: 'scenario_a', operations: [OperationType.CREATE_POOL] },
        { name: 'scenario_b', operations: [OperationType.PLACE_BET] },
      ];

      const comparison = await estimator.compareApproaches(scenarios);

      expect(comparison.scenario_a.breakdown).toHaveLength(1);
      expect(comparison.scenario_b.breakdown).toHaveLength(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty parameters', async () => {
      const estimate = await estimator.estimateOperation(OperationType.CREATE_POOL, {});

      expect(estimate).toBeDefined();
      expect(estimate.estimatedInstructions).toBeGreaterThan(0);
    });

    it('should handle undefined parameters', async () => {
      const estimate = await estimator.estimateOperation(OperationType.PLACE_BET);

      expect(estimate).toBeDefined();
    });

    it('should handle batch operations with large pool count', async () => {
      const estimate = await estimator.estimateOperation(OperationType.BATCH_SETTLE, {
        pool_count: 100,
      });

      expect(estimate.estimatedInstructions).toBeGreaterThan(20000);
      expect(estimate.optimizationLevel).toBe('high');
    });

    it('should handle extremely large amounts', async () => {
      const estimate = await estimator.estimateOperation(OperationType.PLACE_BET, {
        amount: Number.MAX_SAFE_INTEGER,
      });

      expect(estimate).toBeDefined();
      expect(estimate.totalCost).toBeGreaterThan(0);
    });
  });

  describe('Security and Validation', () => {
    it('should validate operation types', async () => {
      const validOperations = Object.values(OperationType);

      for (const operation of validOperations) {
        const estimate = await estimator.estimateOperation(operation as OperationType);
        expect(estimate).toBeDefined();
      }
    });

    it('should produce consistent results for same inputs', async () => {
      const params = { pool_id: 1, outcome: 0, amount: 10000 };

      const estimate1 = await estimator.estimateOperation(OperationType.PLACE_BET, params);
      const estimate2 = await estimator.estimateOperation(OperationType.PLACE_BET, params);

      expect(estimate1.estimatedInstructions).toBe(estimate2.estimatedInstructions);
      expect(estimate1.totalCost).toBe(estimate2.totalCost);
    });

    it('should never return negative costs', async () => {
      const operations = Object.values(OperationType);

      for (const operation of operations) {
        const estimate = await estimator.estimateOperation(operation as OperationType);
        
        expect(estimate.estimatedInstructions).toBeGreaterThanOrEqual(0);
        expect(estimate.estimatedCpuCost).toBeGreaterThanOrEqual(0);
        expect(estimate.estimatedMemoryCost).toBeGreaterThanOrEqual(0);
        expect(estimate.estimatedStorageCost).toBeGreaterThanOrEqual(0);
        expect(estimate.totalCost).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Performance Benchmarks', () => {
    it('should estimate operations quickly (< 100ms)', async () => {
      const start = Date.now();
      
      await estimator.estimateOperation(OperationType.CREATE_POOL);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should generate suggestions quickly for multiple operations', async () => {
      const operations = Array(10).fill(OperationType.PLACE_BET);
      
      const start = Date.now();
      await estimator.generateOptimizationSuggestions(operations);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(200);
    });

    it('should generate analysis report efficiently', async () => {
      const operations = [
        OperationType.CREATE_POOL,
        OperationType.PLACE_BET,
        OperationType.SETTLE_POOL,
        OperationType.CLAIM_WINNINGS,
        OperationType.CANCEL_BET,
      ];

      const start = Date.now();
      await estimator.generateAnalysisReport(operations);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(300);
    });
  });
});

describe('Route Handlers', () => {
  const { 
    handleGasEstimateRequest,
    handleOptimizationSuggestionsRequest,
    handleAnalysisReportRequest,
  } = require('../gasEstimate');

  describe('handleGasEstimateRequest', () => {
    it('should handle valid gas estimate request', async () => {
      const req = {
        body: {
          operation: OperationType.CREATE_POOL,
          contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
          parameters: {},
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await handleGasEstimateRequest(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          estimate: expect.any(Object),
        })
      );
    });

    it('should return error for missing required fields', async () => {
      const req = { body: {} };
      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await handleGasEstimateRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Missing required fields'),
        })
      );
    });
  });

  describe('handleOptimizationSuggestionsRequest', () => {
    it('should handle valid optimization request', async () => {
      const req = {
        body: {
          operations: [OperationType.SETTLE_POOL, OperationType.SETTLE_POOL],
          contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await handleOptimizationSuggestionsRequest(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          suggestions: expect.any(Array),
        })
      );
    });
  });

  describe('handleAnalysisReportRequest', () => {
    it('should handle valid analysis report request', async () => {
      const req = {
        body: {
          operations: [OperationType.CREATE_POOL, OperationType.PLACE_BET],
          contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      };

      await handleAnalysisReportRequest(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          report: expect.any(Object),
        })
      );
    });
  });
});
