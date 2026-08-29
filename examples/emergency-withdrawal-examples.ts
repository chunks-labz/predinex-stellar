/**
 * Emergency Withdrawal - Usage Examples
 * Issue #1109
 */

import { createEmergencyService, EmergencyStatus } from '../api/src/routes/emergency';
import { Keypair } from '@stellar/stellar-sdk';

// Example 1: Basic Emergency Activation
async function example1_activateEmergency() {
  console.log('\n=== Example 1: Activate Emergency Mode ===\n');
  
  const service = createEmergencyService(
    'https://soroban-testnet.stellar.org',
    'CONTRACT_ID'
  );

  const adminKeypair = Keypair.random();
  
  const result = await service.activateEmergency(
    adminKeypair,
    'Security incident detected - unauthorized access attempt'
  );
  
  console.log('Emergency activated:', result.success);
}

// Example 2: Multi-sig Withdrawal Flow
async function example2_multiSigWithdrawal() {
  console.log('\n=== Example 2: Multi-Signature Withdrawal ===\n');
  
  const service = createEmergencyService(
    'https://soroban-testnet.stellar.org',
    'CONTRACT_ID'
  );

  const admin1 = Keypair.random();
  const admin2 = Keypair.random();
  const recipient = Keypair.random().publicKey();
  
  // Create request
  const { requestId } = await service.requestWithdrawal(
    admin1,
    recipient,
    '500000',
    'TOKEN_ADDRESS',
    'Emergency fund recovery'
  );
  
  console.log('Request created:', requestId);
  
  // Approve with second admin
  await service.approveWithdrawal(admin2, requestId!);
  
  // Wait for timelock then execute
  await service.executeWithdrawal(admin1, requestId!);
}

// Example 3: Rate Limit Check
async function example3_rateLimitCheck() {
  console.log('\n=== Example 3: Rate Limit Monitoring ===\n');
  
  const service = createEmergencyService(
    'https://soroban-testnet.stellar.org',
    'CONTRACT_ID'
  );

  const status = await service.getRateLimitStatus();
  console.log('Rate limit status:', status);
  
  const check = await service.checkRateLimit('1000000');
  console.log('Can withdraw 1M:', check.allowed);
}

// Example 4: System Status
async function example4_systemStatus() {
  console.log('\n=== Example 4: System Status Dashboard ===\n');
  
  const service = createEmergencyService(
    'https://soroban-testnet.stellar.org',
    'CONTRACT_ID'
  );

  const status = await service.getSystemStatus();
  
  console.log('Emergency Status:', status.config.status);
  console.log('Pending Requests:', status.pendingRequests);
  console.log('Cooldown Remaining:', status.cooldownRemaining, 'seconds');
  console.log('Operational:', status.isOperational);
}

export {
  example1_activateEmergency,
  example2_multiSigWithdrawal,
  example3_rateLimitCheck,
  example4_systemStatus,
};
