/**
 * API Server Entry Point
 * 
 * Issue #1295: Wires balance provider to budget router
 */

import express from 'express';
import { createBudgetRouter, contractService } from './routes/budget';
import complianceRouter from './routes/compliance';

const app = express();

app.use(express.json());

// ============================================================================
// Balance Provider Wiring (Issue #1295)
// ============================================================================

/**
 * Example balance provider using Stellar SDK
 * Replace with actual implementation
 */
async function getStellarBalance(address: string): Promise<bigint> {
  // TODO: Implement actual Stellar SDK call
  // Example:
  // const server = new Server('https://horizon.stellar.org');
  // const account = await server.loadAccount(address);
  // const xlmBalance = account.balances.find(b => b.asset_type === 'native');
  // return BigInt(Math.floor(parseFloat(xlmBalance?.balance || '0') * 10000000));
  
  // Temporary mock for development
  return BigInt(1000000000000); // 100,000 XLM in stroops
}

// Wire the balance provider before mounting routes
// Issue #1295: This is required for /api/budget/plan to work
contractService.setBalanceProvider(getStellarBalance);

// ============================================================================
// Mount Routes
// ============================================================================

app.use('/api/budget', createBudgetRouter(contractService));
app.use('/api/compliance', complianceRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Predinex API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

export default app;
