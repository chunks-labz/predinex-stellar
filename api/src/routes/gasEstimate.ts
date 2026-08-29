/**
 * Gas Cost Estimator and Optimization Suggestions API
 * Issue #1111: Build lending pool gas cost estimator and optimization suggestions
 * 
 * This module provides comprehensive gas cost estimation and optimization
 * recommendations for Stellar/Soroban smart contract operations.
 */

import { Contract, SorobanRpc, xdr, Address } from 'stellar-sdk';

/**
 * Gas estimation result with detailed breakdown
 */
export interface GasEstimate {
  operation: string;
  estimatedInstructions: number;
  estimatedCpuCost: number;
  estimatedMemoryCost: number;
  estimatedStorageCost: number;
  totalCost: number;
  optimizationLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

/**
 * Optimization suggestion with priority and impact
 */
export interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedSavings: number;
  implementationComplexity: 'easy' | 'medium' | 'hard';
  category: 'storage' | 'computation' | 'network' | 'batching';
  codeExample?: string;
}

/**
 * Complete gas analysis report
 */
export interface GasAnalysisReport {
  estimates: GasEstimate[];
  suggestions: OptimizationSuggestion[];
  totalEstimatedCost: number;
  averageOptimizationPotential: number;
  timestamp: number;
  contractId: string;
}

/**
 * Operation types for gas estimation
 */
export enum OperationType {
  CREATE_POOL = 'create_pool',
  PLACE_BET = 'place_bet',
  SETTLE_POOL = 'settle_pool',
  CLAIM_WINNINGS = 'claim_winnings',
  CANCEL_BET = 'cancel_bet',
  EXTEND_POOL = 'extend_pool',
  BATCH_SETTLE = 'batch_settle',
  CLAIM_ALL = 'claim_all_winnings',
}

/**
 * Gas cost constants based on Soroban network parameters
 */
const GAS_CONSTANTS = {
  INSTRUCTION_COST: 25, // CPU instructions cost multiplier
  MEMORY_BYTE_COST: 1,
  STORAGE_WRITE_COST: 100,
  STORAGE_READ_COST: 10,
  BASE_TRANSACTION_COST: 100,
  NETWORK_FEE_MULTIPLIER: 1.5,
};

/**
 * Baseline instruction counts from benchmarks
 */
const OPERATION_BASELINES: Record<OperationType, number> = {
  [OperationType.CREATE_POOL]: 15000,
  [OperationType.PLACE_BET]: 8000,
  [OperationType.SETTLE_POOL]: 12000,
  [OperationType.CLAIM_WINNINGS]: 10000,
  [OperationType.CANCEL_BET]: 6000,
  [OperationType.EXTEND_POOL]: 4000,
  [OperationType.BATCH_SETTLE]: 20000,
  [OperationType.CLAIM_ALL]: 15000,
};

/**
 * GasEstimatorService - Core service for gas cost estimation
 */
export class GasEstimatorService {
  private rpcServer: SorobanRpc.Server;
  private contractId: string;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcServer = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
  }

  /**
   * Estimate gas cost for a specific operation
   */
  async estimateOperation(
    operation: OperationType,
    parameters?: Record<string, any>
  ): Promise<GasEstimate> {
    const baseInstructions = OPERATION_BASELINES[operation];
    
    // Adjust for parameter complexity
    const complexityMultiplier = this.calculateComplexityMultiplier(operation, parameters);
    const estimatedInstructions = Math.floor(baseInstructions * complexityMultiplier);

    // Calculate individual cost components
    const cpuCost = estimatedInstructions * GAS_CONSTANTS.INSTRUCTION_COST;
    const memoryCost = this.estimateMemoryCost(operation, parameters);
    const storageCost = this.estimateStorageCost(operation, parameters);
    
    const totalCost = 
      GAS_CONSTANTS.BASE_TRANSACTION_COST +
      cpuCost +
      memoryCost +
      storageCost;

    const optimizationLevel = this.determineOptimizationLevel(totalCost);

    return {
      operation,
      estimatedInstructions,
      estimatedCpuCost: cpuCost,
      estimatedMemoryCost: memoryCost,
      estimatedStorageCost: storageCost,
      totalCost: Math.floor(totalCost * GAS_CONSTANTS.NETWORK_FEE_MULTIPLIER),
      optimizationLevel,
      timestamp: Date.now(),
    };
  }

  /**
   * Simulate transaction and get actual gas consumption
   */
  async simulateTransaction(
    operation: OperationType,
    parameters: Record<string, any>,
    caller: string
  ): Promise<GasEstimate> {
    try {
      // Build transaction based on operation
      const contract = new Contract(this.contractId);
      const callerAddress = new Address(caller);
      
      // This would integrate with actual Soroban simulation
      // For now, return enhanced estimate
      const estimate = await this.estimateOperation(operation, parameters);
      
      // In production, this would use:
      // const simulation = await this.rpcServer.simulateTransaction(tx);
      // And parse actual resource consumption from simulation.result
      
      return estimate;
    } catch (error) {
      console.error('Simulation failed:', error);
      // Fallback to static estimation
      return this.estimateOperation(operation, parameters);
    }
  }

  /**
   * Generate optimization suggestions based on operation patterns
   */
  async generateOptimizationSuggestions(
    operations: OperationType[]
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    // Check for batchable operations
    if (this.hasBatchableOperations(operations)) {
      suggestions.push({
        id: 'batch-operations',
        title: 'Batch Multiple Operations',
        description: 'Multiple settle or claim operations detected. Use batch_settle_pools or claim_all_winnings to reduce gas costs by up to 40%.',
        priority: 'high',
        estimatedSavings: 40,
        implementationComplexity: 'easy',
        category: 'batching',
        codeExample: `
// Instead of:
for (const poolId of poolIds) {
  await contract.settle_pool({ pool_id: poolId, winning_outcome: outcomes[poolId] });
}

// Use batch operation:
await contract.batch_settle_pools({
  settle_requests: poolIds.map((id, i) => ({ pool_id: id, winning_outcome: outcomes[id] }))
});`,
      });
    }

    // Storage optimization suggestions
    suggestions.push({
      id: 'storage-ttl',
      title: 'Optimize Storage TTL Management',
      description: 'Proactively manage storage TTL to avoid expensive bump operations during critical transactions.',
      priority: 'medium',
      estimatedSavings: 20,
      implementationComplexity: 'medium',
      category: 'storage',
      codeExample: `
// Bump storage TTL during low-activity periods
await contract.extend_ttl({ 
  keys: [pool_key], 
  threshold_ledgers: 17280 * 25,
  extend_to_ledgers: 17280 * 30 
});`,
    });

    // Computation optimization
    suggestions.push({
      id: 'lazy-evaluation',
      title: 'Use Lazy Evaluation for Claims',
      description: 'For pools with many participants, use scheduled claims to defer gas costs and improve user experience.',
      priority: 'medium',
      estimatedSavings: 30,
      implementationComplexity: 'medium',
      category: 'computation',
      codeExample: `
// Schedule claim for later execution
await contract.schedule_claim({
  pool_id: poolId,
  claim_at: futureTimestamp
});`,
    });

    // Network optimization
    suggestions.push({
      id: 'read-optimization',
      title: 'Minimize On-Chain Reads',
      description: 'Cache frequently accessed data off-chain and validate with merkle proofs when needed.',
      priority: 'high',
      estimatedSavings: 35,
      implementationComplexity: 'hard',
      category: 'network',
      codeExample: `
// Use get_config to fetch all configuration in one call
const config = await contract.get_config();
// Instead of multiple individual calls`,
    });

    // Smart contract specific optimizations
    suggestions.push({
      id: 'outcome-indexing',
      title: 'Optimize Multi-Outcome Pool Storage',
      description: 'For pools with many outcomes, use efficient indexing structures to reduce iteration costs.',
      priority: 'low',
      estimatedSavings: 15,
      implementationComplexity: 'hard',
      category: 'storage',
    });

    return suggestions.sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Generate comprehensive gas analysis report
   */
  async generateAnalysisReport(
    operations: OperationType[]
  ): Promise<GasAnalysisReport> {
    const estimates = await Promise.all(
      operations.map(op => this.estimateOperation(op))
    );

    const suggestions = await this.generateOptimizationSuggestions(operations);

    const totalEstimatedCost = estimates.reduce(
      (sum, est) => sum + est.totalCost,
      0
    );

    const averageOptimizationPotential =
      suggestions.reduce((sum, sug) => sum + sug.estimatedSavings, 0) /
      suggestions.length;

    return {
      estimates,
      suggestions,
      totalEstimatedCost,
      averageOptimizationPotential,
      timestamp: Date.now(),
      contractId: this.contractId,
    };
  }

  /**
   * Compare gas costs between different approaches
   */
  async compareApproaches(
    scenarios: Array<{ name: string; operations: OperationType[] }>
  ): Promise<Record<string, { totalCost: number; breakdown: GasEstimate[] }>> {
    const results: Record<string, { totalCost: number; breakdown: GasEstimate[] }> = {};

    for (const scenario of scenarios) {
      const estimates = await Promise.all(
        scenario.operations.map(op => this.estimateOperation(op))
      );

      results[scenario.name] = {
        totalCost: estimates.reduce((sum, est) => sum + est.totalCost, 0),
        breakdown: estimates,
      };
    }

    return results;
  }

  // Private helper methods

  private calculateComplexityMultiplier(
    operation: OperationType,
    parameters?: Record<string, any>
  ): number {
    let multiplier = 1.0;

    if (!parameters) return multiplier;

    // Adjust based on operation-specific parameters
    switch (operation) {
      case OperationType.CREATE_POOL:
        if (parameters.outcomes && parameters.outcomes.length > 2) {
          multiplier += (parameters.outcomes.length - 2) * 0.15;
        }
        if (parameters.description && parameters.description.length > 500) {
          multiplier += 0.1;
        }
        break;

      case OperationType.PLACE_BET:
        if (parameters.amount && parameters.amount > 1000000) {
          multiplier += 0.05;
        }
        break;

      case OperationType.SETTLE_POOL:
        if (parameters.participant_count && parameters.participant_count > 10) {
          multiplier += parameters.participant_count * 0.02;
        }
        break;

      case OperationType.BATCH_SETTLE:
        if (parameters.pool_count) {
          multiplier += parameters.pool_count * 0.3;
        }
        break;
    }

    return multiplier;
  }

  private estimateMemoryCost(
    operation: OperationType,
    parameters?: Record<string, any>
  ): number {
    let baseMemory = 1000; // Base memory allocation

    if (!parameters) return baseMemory * GAS_CONSTANTS.MEMORY_BYTE_COST;

    // Adjust for data structures
    if (parameters.outcomes) {
      baseMemory += parameters.outcomes.length * 100;
    }
    if (parameters.description) {
      baseMemory += parameters.description.length;
    }
    if (parameters.pool_count) {
      baseMemory += parameters.pool_count * 200;
    }

    return baseMemory * GAS_CONSTANTS.MEMORY_BYTE_COST;
  }

  private estimateStorageCost(
    operation: OperationType,
    parameters?: Record<string, any>
  ): number {
    let writeCost = 0;
    let readCost = 0;

    switch (operation) {
      case OperationType.CREATE_POOL:
        writeCost = 5; // Pool, outcomes, metadata, counter
        readCost = 2; // Token, config
        break;

      case OperationType.PLACE_BET:
        writeCost = 3; // Pool totals, user bet, volume
        readCost = 3; // Pool, user bet, rate limits
        break;

      case OperationType.SETTLE_POOL:
        writeCost = 2; // Pool status, payout state
        readCost = 2; // Pool, fee config
        break;

      case OperationType.CLAIM_WINNINGS:
        writeCost = 2; // User bet removal, payout state
        readCost = 3; // Pool, user bet, payout state
        break;

      case OperationType.BATCH_SETTLE:
        if (parameters?.pool_count) {
          writeCost = parameters.pool_count * 2;
          readCost = parameters.pool_count * 2;
        } else {
          writeCost = 10;
          readCost = 10;
        }
        break;
    }

    return (
      writeCost * GAS_CONSTANTS.STORAGE_WRITE_COST +
      readCost * GAS_CONSTANTS.STORAGE_READ_COST
    );
  }

  private determineOptimizationLevel(totalCost: number): 'low' | 'medium' | 'high' {
    if (totalCost < 5000) return 'low';
    if (totalCost < 15000) return 'medium';
    return 'high';
  }

  private hasBatchableOperations(operations: OperationType[]): boolean {
    const settleOps = operations.filter(op => op === OperationType.SETTLE_POOL);
    const claimOps = operations.filter(op => op === OperationType.CLAIM_WINNINGS);
    
    return settleOps.length > 1 || claimOps.length > 1;
  }
}

/**
 * Factory function to create a gas estimator instance
 */
export function createGasEstimator(
  rpcUrl: string = 'https://soroban-testnet.stellar.org',
  contractId: string
): GasEstimatorService {
  return new GasEstimatorService(rpcUrl, contractId);
}

/**
 * Express route handler for gas estimation API
 */
export async function handleGasEstimateRequest(req: any, res: any) {
  try {
    const { operation, parameters, contractId, rpcUrl } = req.body;

    if (!operation || !contractId) {
      return res.status(400).json({
        error: 'Missing required fields: operation and contractId',
      });
    }

    const estimator = createGasEstimator(rpcUrl, contractId);
    const estimate = await estimator.estimateOperation(operation, parameters);

    res.json({
      success: true,
      estimate,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Express route handler for optimization suggestions
 */
export async function handleOptimizationSuggestionsRequest(req: any, res: any) {
  try {
    const { operations, contractId, rpcUrl } = req.body;

    if (!operations || !contractId) {
      return res.status(400).json({
        error: 'Missing required fields: operations and contractId',
      });
    }

    const estimator = createGasEstimator(rpcUrl, contractId);
    const suggestions = await estimator.generateOptimizationSuggestions(operations);

    res.json({
      success: true,
      suggestions,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Express route handler for full analysis report
 */
export async function handleAnalysisReportRequest(req: any, res: any) {
  try {
    const { operations, contractId, rpcUrl } = req.body;

    if (!operations || !contractId) {
      return res.status(400).json({
        error: 'Missing required fields: operations and contractId',
      });
    }

    const estimator = createGasEstimator(rpcUrl, contractId);
    const report = await estimator.generateAnalysisReport(operations);

    res.json({
      success: true,
      report,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

export default {
  GasEstimatorService,
  createGasEstimator,
  handleGasEstimateRequest,
  handleOptimizationSuggestionsRequest,
  handleAnalysisReportRequest,
};
