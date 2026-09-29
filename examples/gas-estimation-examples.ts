/**
 * Gas Cost Estimator - Usage Examples
 * Issue #1111: Build lending pool gas cost estimator and optimization suggestions
 */

import { createGasEstimator, OperationType } from '../api/src/routes/gasEstimate';

// Example 1: Basic Gas Estimation
async function example1_basicEstimation() {
  console.log('\n=== Example 1: Basic Gas Estimation ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  // Estimate creating a simple pool
  const estimate = await estimator.estimateOperation(OperationType.CREATE_POOL);
  
  console.log('Creating a simple pool:');
  console.log(`  Instructions: ${estimate.estimatedInstructions.toLocaleString()}`);
  console.log(`  Total Cost: ${estimate.totalCost.toLocaleString()} stroops`);
  console.log(`  Optimization Level: ${estimate.optimizationLevel}`);
}

// Example 2: Complex Parameter Estimation
async function example2_complexParameters() {
  console.log('\n=== Example 2: Complex Parameter Estimation ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  // Simple pool
  const simplePool = await estimator.estimateOperation(
    OperationType.CREATE_POOL,
    { outcomes: ['Yes', 'No'] }
  );

  // Complex multi-outcome pool
  const complexPool = await estimator.estimateOperation(
    OperationType.CREATE_POOL,
    {
      outcomes: ['Option A', 'Option B', 'Option C', 'Option D', 'Option E'],
      description: 'A very detailed description of a complex prediction market with multiple outcomes and extensive context explaining the conditions and rules for settlement.',
    }
  );

  console.log('Simple 2-outcome pool:');
  console.log(`  Cost: ${simplePool.totalCost.toLocaleString()} stroops`);
  
  console.log('\nComplex 5-outcome pool:');
  console.log(`  Cost: ${complexPool.totalCost.toLocaleString()} stroops`);
  
  const increase = ((complexPool.totalCost - simplePool.totalCost) / simplePool.totalCost) * 100;
  console.log(`\n  Complexity increases cost by ${increase.toFixed(1)}%`);
}

// Example 3: Batch vs Individual Operations
async function example3_batchComparison() {
  console.log('\n=== Example 3: Batch vs Individual Operations ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  const comparison = await estimator.compareApproaches([
    {
      name: 'Individual Settlements',
      operations: [
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
        OperationType.SETTLE_POOL,
      ],
    },
    {
      name: 'Batch Settlement',
      operations: [OperationType.BATCH_SETTLE],
    },
  ]);

  console.log('5 Individual Settlements:');
  console.log(`  Cost: ${comparison['Individual Settlements'].totalCost.toLocaleString()} stroops`);
  
  console.log('\n1 Batch Settlement (5 pools):');
  console.log(`  Cost: ${comparison['Batch Settlement'].totalCost.toLocaleString()} stroops`);
  
  const savings = comparison['Individual Settlements'].totalCost - comparison['Batch Settlement'].totalCost;
  const savingsPercent = (savings / comparison['Individual Settlements'].totalCost) * 100;
  
  console.log(`\n  💰 Savings: ${savings.toLocaleString()} stroops (${savingsPercent.toFixed(1)}%)`);
}

// Example 4: Optimization Suggestions
async function example4_optimizationSuggestions() {
  console.log('\n=== Example 4: Optimization Suggestions ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  // Analyze a common operation pattern
  const suggestions = await estimator.generateOptimizationSuggestions([
    OperationType.CREATE_POOL,
    OperationType.PLACE_BET,
    OperationType.PLACE_BET,
    OperationType.PLACE_BET,
    OperationType.SETTLE_POOL,
    OperationType.CLAIM_WINNINGS,
    OperationType.CLAIM_WINNINGS,
  ]);

  console.log(`Found ${suggestions.length} optimization suggestions:\n`);

  suggestions.forEach((suggestion, index) => {
    const priorityEmoji = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    }[suggestion.priority];

    console.log(`${index + 1}. ${priorityEmoji} [${suggestion.priority.toUpperCase()}] ${suggestion.title}`);
    console.log(`   Category: ${suggestion.category}`);
    console.log(`   Potential Savings: ${suggestion.estimatedSavings}%`);
    console.log(`   Implementation: ${suggestion.implementationComplexity}`);
    console.log(`   ${suggestion.description}\n`);

    if (suggestion.codeExample && index === 0) {
      console.log('   Example Code:');
      console.log(suggestion.codeExample.split('\n').map(line => `   ${line}`).join('\n'));
      console.log('');
    }
  });
}

// Example 5: Comprehensive Analysis Report
async function example5_comprehensiveReport() {
  console.log('\n=== Example 5: Comprehensive Analysis Report ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  const report = await estimator.generateAnalysisReport([
    OperationType.CREATE_POOL,
    OperationType.PLACE_BET,
    OperationType.SETTLE_POOL,
    OperationType.CLAIM_WINNINGS,
    OperationType.CANCEL_BET,
  ]);

  console.log('Gas Analysis Report');
  console.log('===================');
  console.log(`Contract: ${report.contractId.substring(0, 10)}...`);
  console.log(`Generated: ${new Date(report.timestamp).toLocaleString()}\n`);

  console.log('Operation Breakdown:');
  console.log('-------------------');
  report.estimates.forEach(estimate => {
    console.log(`${estimate.operation.padEnd(20)} ${estimate.totalCost.toLocaleString().padStart(10)} stroops [${estimate.optimizationLevel}]`);
  });

  console.log(`\nTotal Estimated Cost: ${report.totalEstimatedCost.toLocaleString()} stroops`);
  console.log(`Average Optimization Potential: ${report.averageOptimizationPotential.toFixed(1)}%`);
  console.log(`\nTop Recommendations: ${report.suggestions.length} suggestions generated`);

  // Show top 3 recommendations
  report.suggestions.slice(0, 3).forEach((suggestion, index) => {
    console.log(`\n${index + 1}. ${suggestion.title}`);
    console.log(`   Priority: ${suggestion.priority} | Savings: ${suggestion.estimatedSavings}%`);
  });
}

// Example 6: Real-time Transaction Simulation
async function example6_transactionSimulation() {
  console.log('\n=== Example 6: Real-time Transaction Simulation ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  const callerAddress = 'GBDQ3AXKUFBWVQMDGJ7XUNBQBKR2XQBJ6KZGBJ3QXBFHQCADFJXGBKFC';

  console.log('Simulating place_bet transaction...\n');

  const estimate = await estimator.simulateTransaction(
    OperationType.PLACE_BET,
    {
      pool_id: 42,
      outcome: 0,
      amount: 50000,
    },
    callerAddress
  );

  console.log('Simulation Results:');
  console.log(`  Instructions: ${estimate.estimatedInstructions.toLocaleString()}`);
  console.log(`  CPU Cost: ${estimate.estimatedCpuCost.toLocaleString()} stroops`);
  console.log(`  Memory Cost: ${estimate.estimatedMemoryCost.toLocaleString()} stroops`);
  console.log(`  Storage Cost: ${estimate.estimatedStorageCost.toLocaleString()} stroops`);
  console.log(`  Total: ${estimate.totalCost.toLocaleString()} stroops`);
}

// Example 7: Scaling Analysis
async function example7_scalingAnalysis() {
  console.log('\n=== Example 7: Scaling Analysis ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  console.log('Settlement cost by participant count:\n');

  const participantCounts = [10, 50, 100, 200, 500];

  for (const count of participantCounts) {
    const estimate = await estimator.estimateOperation(
      OperationType.SETTLE_POOL,
      { participant_count: count }
    );

    console.log(`${count.toString().padStart(4)} participants: ${estimate.totalCost.toLocaleString().padStart(10)} stroops [${estimate.optimizationLevel}]`);
  }
}

// Example 8: Cost-Benefit Analysis
async function example8_costBenefitAnalysis() {
  console.log('\n=== Example 8: Cost-Benefit Analysis for Storage Optimization ===\n');
  
  const estimator = createGasEstimator(
    'https://soroban-testnet.stellar.org',
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
  );

  // Scenario: Claiming from multiple pools
  const comparison = await estimator.compareApproaches([
    {
      name: 'Multiple get_config calls',
      operations: [
        OperationType.CLAIM_WINNINGS,
        OperationType.CLAIM_WINNINGS,
        OperationType.CLAIM_WINNINGS,
        OperationType.CLAIM_WINNINGS,
        OperationType.CLAIM_WINNINGS,
      ],
    },
    {
      name: 'Single claim_all call',
      operations: [OperationType.CLAIM_ALL],
    },
  ]);

  const multiCost = comparison['Multiple get_config calls'].totalCost;
  const singleCost = comparison['Single claim_all call'].totalCost;
  const savings = multiCost - singleCost;

  console.log('Claiming from 5 pools:\n');
  console.log(`Multiple Claims: ${multiCost.toLocaleString()} stroops`);
  console.log(`Batch Claim:     ${singleCost.toLocaleString()} stroops`);
  console.log(`\nSavings:         ${savings.toLocaleString()} stroops`);
  console.log(`Efficiency Gain: ${((savings / multiCost) * 100).toFixed(1)}%`);
}

// Run all examples
async function runAllExamples() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║      Gas Cost Estimator - Usage Examples                ║');
  console.log('║      Issue #1111 - Production Implementation             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  try {
    await example1_basicEstimation();
    await example2_complexParameters();
    await example3_batchComparison();
    await example4_optimizationSuggestions();
    await example5_comprehensiveReport();
    await example6_transactionSimulation();
    await example7_scalingAnalysis();
    await example8_costBenefitAnalysis();

    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║      All Examples Completed Successfully! ✅              ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    process.exit(1);
  }
}

// Export for use in other modules
export {
  example1_basicEstimation,
  example2_complexParameters,
  example3_batchComparison,
  example4_optimizationSuggestions,
  example5_comprehensiveReport,
  example6_transactionSimulation,
  example7_scalingAnalysis,
  example8_costBenefitAnalysis,
};

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}
