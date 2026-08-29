# Gas Cost Estimator and Optimization Suggestions

**Issue #1111** | **Status**: ✅ Production Ready

## Overview

The Gas Cost Estimator provides comprehensive gas consumption analysis and optimization recommendations for Stellar/Soroban smart contract operations. This tool helps developers optimize their contracts for cost efficiency and performance.

## Features

### 🔍 Gas Estimation
- **Accurate Cost Prediction**: Estimate gas costs before executing transactions
- **Detailed Breakdown**: CPU, memory, and storage costs separately reported
- **Parameter-Aware**: Adjusts estimates based on operation complexity
- **Real-time Simulation**: Integration with Soroban RPC for actual gas consumption

### 🎯 Optimization Suggestions
- **Priority-Based Recommendations**: Critical, high, medium, and low priority suggestions
- **Category Organization**: Storage, computation, network, batching, caching
- **Savings Estimation**: Quantified potential savings for each suggestion
- **Implementation Complexity**: Easy, medium, hard ratings for planning
- **Code Examples**: Ready-to-use code snippets for common optimizations

### 📊 Analysis Reports
- **Comprehensive Reports**: Full gas analysis across multiple operations
- **Comparative Analysis**: Compare different implementation approaches
- **Benchmark Integration**: Uses real contract benchmark data
- **Historical Tracking**: Monitor optimization progress over time

## Installation

### Prerequisites

```bash
npm install @stellar/stellar-sdk
# or
yarn add @stellar/stellar-sdk
```

### Setup

```typescript
import { createGasEstimator, OperationType } from './api/src/routes/gasEstimate';

const estimator = createGasEstimator(
  'https://soroban-testnet.stellar.org',
  'YOUR_CONTRACT_ID'
);
```

## Usage

### Basic Gas Estimation

```typescript
// Estimate a single operation
const estimate = await estimator.estimateOperation(OperationType.CREATE_POOL);

console.log(`
  Operation: ${estimate.operation}
  Instructions: ${estimate.estimatedInstructions}
  CPU Cost: ${estimate.estimatedCpuCost}
  Memory Cost: ${estimate.estimatedMemoryCost}
  Storage Cost: ${estimate.estimatedStorageCost}
  Total Cost: ${estimate.totalCost} stroops
  Optimization Level: ${estimate.optimizationLevel}
`);
```

### Advanced Estimation with Parameters

```typescript
// Estimate with specific parameters
const complexEstimate = await estimator.estimateOperation(
  OperationType.CREATE_POOL,
  {
    outcomes: ['Option1', 'Option2', 'Option3', 'Option4', 'Option5'],
    description: 'A complex prediction market with multiple outcomes',
    participant_count: 100
  }
);
```

### Transaction Simulation

```typescript
// Simulate actual transaction for precise gas measurement
const simulationEstimate = await estimator.simulateTransaction(
  OperationType.PLACE_BET,
  {
    pool_id: 42,
    outcome: 0,
    amount: 10000
  },
  'CALLER_ADDRESS'
);
```

### Optimization Suggestions

```typescript
// Get optimization recommendations
const suggestions = await estimator.generateOptimizationSuggestions([
  OperationType.SETTLE_POOL,
  OperationType.SETTLE_POOL,
  OperationType.SETTLE_POOL,
]);

suggestions.forEach(suggestion => {
  console.log(`
    [${suggestion.priority.toUpperCase()}] ${suggestion.title}
    ${suggestion.description}
    Estimated Savings: ${suggestion.estimatedSavings}%
    Complexity: ${suggestion.implementationComplexity}
    Category: ${suggestion.category}
  `);
  
  if (suggestion.codeExample) {
    console.log(`\nExample:\n${suggestion.codeExample}`);
  }
});
```

### Comprehensive Analysis Report

```typescript
// Generate full analysis report
const report = await estimator.generateAnalysisReport([
  OperationType.CREATE_POOL,
  OperationType.PLACE_BET,
  OperationType.SETTLE_POOL,
  OperationType.CLAIM_WINNINGS,
]);

console.log(`
  Total Estimated Cost: ${report.totalEstimatedCost} stroops
  Average Optimization Potential: ${report.averageOptimizationPotential}%
  Contract: ${report.contractId}
  
  Estimates: ${report.estimates.length} operations analyzed
  Suggestions: ${report.suggestions.length} recommendations
`);
```

### Comparative Analysis

```typescript
// Compare different implementation approaches
const comparison = await estimator.compareApproaches([
  {
    name: 'individual_operations',
    operations: [
      OperationType.SETTLE_POOL,
      OperationType.SETTLE_POOL,
      OperationType.SETTLE_POOL,
    ]
  },
  {
    name: 'batch_operation',
    operations: [OperationType.BATCH_SETTLE]
  }
]);

Object.entries(comparison).forEach(([name, result]) => {
  console.log(`${name}: ${result.totalCost} stroops`);
});

const savings = comparison.individual_operations.totalCost - 
               comparison.batch_operation.totalCost;
const savingsPercent = (savings / comparison.individual_operations.totalCost) * 100;

console.log(`Batch operations save ${savingsPercent.toFixed(1)}%!`);
```

## API Reference

### GasEstimatorService

#### Methods

##### `estimateOperation(operation, parameters?)`
Estimate gas cost for a specific operation.

**Parameters:**
- `operation` (OperationType): The operation to estimate
- `parameters` (object, optional): Operation-specific parameters

**Returns:** `Promise<GasEstimate>`

##### `simulateTransaction(operation, parameters, caller)`
Simulate transaction and get actual gas consumption.

**Parameters:**
- `operation` (OperationType): The operation to simulate
- `parameters` (object): Operation parameters
- `caller` (string): Caller address

**Returns:** `Promise<GasEstimate>`

##### `generateOptimizationSuggestions(operations)`
Generate optimization suggestions based on operation patterns.

**Parameters:**
- `operations` (OperationType[]): Array of operations to analyze

**Returns:** `Promise<OptimizationSuggestion[]>`

##### `generateAnalysisReport(operations)`
Generate comprehensive gas analysis report.

**Parameters:**
- `operations` (OperationType[]): Array of operations to analyze

**Returns:** `Promise<GasAnalysisReport>`

##### `compareApproaches(scenarios)`
Compare gas costs between different approaches.

**Parameters:**
- `scenarios` (Array<{name: string, operations: OperationType[]}>): Scenarios to compare

**Returns:** `Promise<Record<string, {totalCost: number, breakdown: GasEstimate[]}>>`

### Types

#### `GasEstimate`
```typescript
interface GasEstimate {
  operation: string;
  estimatedInstructions: number;
  estimatedCpuCost: number;
  estimatedMemoryCost: number;
  estimatedStorageCost: number;
  totalCost: number;
  optimizationLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}
```

#### `OptimizationSuggestion`
```typescript
interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedSavings: number;
  implementationComplexity: 'easy' | 'medium' | 'hard';
  category: 'storage' | 'computation' | 'network' | 'batching';
  codeExample?: string;
}
```

#### `GasAnalysisReport`
```typescript
interface GasAnalysisReport {
  estimates: GasEstimate[];
  suggestions: OptimizationSuggestion[];
  totalEstimatedCost: number;
  averageOptimizationPotential: number;
  timestamp: number;
  contractId: string;
}
```

#### `OperationType`
```typescript
enum OperationType {
  CREATE_POOL = 'create_pool',
  PLACE_BET = 'place_bet',
  SETTLE_POOL = 'settle_pool',
  CLAIM_WINNINGS = 'claim_winnings',
  CANCEL_BET = 'cancel_bet',
  EXTEND_POOL = 'extend_pool',
  BATCH_SETTLE = 'batch_settle',
  CLAIM_ALL = 'claim_all_winnings',
}
```

## REST API Endpoints

### POST `/api/gas-estimate`

Estimate gas cost for a single operation.

**Request Body:**
```json
{
  "operation": "create_pool",
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "parameters": {
    "outcomes": ["Yes", "No"],
    "description": "Will it rain tomorrow?"
  },
  "rpcUrl": "https://soroban-testnet.stellar.org"
}
```

**Response:**
```json
{
  "success": true,
  "estimate": {
    "operation": "create_pool",
    "estimatedInstructions": 15000,
    "estimatedCpuCost": 375000,
    "estimatedMemoryCost": 1000,
    "estimatedStorageCost": 520,
    "totalCost": 564780,
    "optimizationLevel": "medium",
    "timestamp": 1234567890
  }
}
```

### POST `/api/optimization-suggestions`

Get optimization recommendations for multiple operations.

**Request Body:**
```json
{
  "operations": ["settle_pool", "settle_pool", "settle_pool"],
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "rpcUrl": "https://soroban-testnet.stellar.org"
}
```

**Response:**
```json
{
  "success": true,
  "suggestions": [
    {
      "id": "batch-operations",
      "title": "Batch Multiple Operations",
      "description": "Multiple settle operations detected...",
      "priority": "high",
      "estimatedSavings": 40,
      "implementationComplexity": "easy",
      "category": "batching",
      "codeExample": "..."
    }
  ]
}
```

### POST `/api/analysis-report`

Generate comprehensive gas analysis report.

**Request Body:**
```json
{
  "operations": ["create_pool", "place_bet", "settle_pool"],
  "contractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "rpcUrl": "https://soroban-testnet.stellar.org"
}
```

## Optimization Best Practices

### 1. Batch Operations When Possible

❌ **Don't:**
```typescript
for (const poolId of poolIds) {
  await contract.settle_pool({ pool_id: poolId, winning_outcome: outcomes[poolId] });
}
```

✅ **Do:**
```typescript
await contract.batch_settle_pools({
  settle_requests: poolIds.map((id) => ({ 
    pool_id: id, 
    winning_outcome: outcomes[id] 
  }))
});
```

**Savings: ~40%**

### 2. Optimize Storage Access

❌ **Don't:**
```typescript
const token = await contract.get_token();
const treasury = await contract.get_treasury_recipient();
const fee = await contract.get_protocol_fee();
```

✅ **Do:**
```typescript
const config = await contract.get_config();
// Access all values from single call
```

**Savings: ~35%**

### 3. Use Lazy Evaluation for Claims

```typescript
// Schedule claim for later execution
await contract.schedule_claim({
  pool_id: poolId,
  claim_at: futureTimestamp
});
```

**Savings: ~30%**

### 4. Manage Storage TTL Proactively

```typescript
// Bump storage TTL during low-activity periods
await contract.extend_ttl({ 
  keys: [pool_key], 
  threshold_ledgers: 17280 * 25,
  extend_to_ledgers: 17280 * 30 
});
```

**Savings: ~20%**

## Security Considerations

### Input Validation
All gas estimates include parameter validation overhead. The estimator accounts for:
- Amount bounds checking
- Overflow protection
- Authorization verification
- State validation

### Reentrancy Protection
Reentrancy guard costs are included in storage cost estimates.

### Rate Limiting
Rate limit checks add minimal overhead (~1000 instructions) to bet placement operations.

## Performance Benchmarks

| Operation | Instructions | Estimated Cost (stroops) | Optimization Level |
|-----------|--------------|-------------------------|-------------------|
| create_pool | 15,000 | ~565,000 | medium |
| place_bet | 8,000 | ~302,000 | low |
| settle_pool | 12,000 | ~453,000 | medium |
| claim_winnings | 10,000 | ~377,500 | medium |
| cancel_bet | 6,000 | ~226,500 | low |
| batch_settle (3 pools) | 20,000 | ~755,000 | high |
| claim_all (5 pools) | 15,000 | ~565,000 | medium |

## Testing

Run the comprehensive test suite:

```bash
# Install dependencies
npm install

# Run tests
npm test api/src/routes/__tests__/gasEstimate.test.ts

# Run with coverage
npm test -- --coverage
```

### Test Coverage

- ✅ Unit tests for all core methods (>80% coverage)
- ✅ Integration tests for Soroban RPC simulation
- ✅ Edge case handling and error scenarios
- ✅ Performance benchmarks (<100ms per estimation)
- ✅ Security validation tests
- ✅ API endpoint tests

## Troubleshooting

### High Gas Costs

If you're seeing unexpectedly high gas costs:

1. **Check parameter complexity**: Large descriptions or many outcomes increase costs
2. **Consider batching**: Multiple operations can often be combined
3. **Review storage patterns**: Excessive reads/writes impact costs
4. **Optimize participant counts**: Large pools have higher settlement costs

### Estimation Accuracy

For most accurate estimates:

1. Use `simulateTransaction()` with actual parameters
2. Run benchmarks on testnet before mainnet deployment
3. Account for network congestion multipliers
4. Monitor actual vs. estimated costs and report discrepancies

### Common Issues

**"Simulation failed" errors:**
- Verify RPC endpoint is accessible
- Check contract ID is valid
- Ensure parameters match contract interface
- Falls back to static estimation automatically

**"Missing required fields" errors:**
- Verify all required parameters are provided
- Check parameter types match interface definitions
- Ensure contractId is in correct format

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `npm test`
2. Code coverage remains >80%
3. Documentation is updated
4. Performance benchmarks are included
5. Security implications are considered

## License

ISC License - see LICENSE file for details

## Support

- **Issues**: Report bugs or request features on GitHub
- **Documentation**: Full API docs at `/docs`
- **Examples**: See `/examples` directory for more use cases

---

**Built for Stellar/Soroban** | **Production Ready** | **v1.0.0**
