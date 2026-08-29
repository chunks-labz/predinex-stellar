# Emergency Withdrawal Mechanism

**Issue #1109** | **Status**: ✅ Production Ready

## Overview

Comprehensive emergency withdrawal system for lending pools with multi-signature support, rate limiting, timelock delays, and complete audit logging.

## Features

### 🔒 Security
- Multi-signature approval workflow
- Timelock delays before execution
- Rate limiting with configurable windows
- Cooldown periods between withdrawals
- Comprehensive audit logging
- Address validation

### ⚡ Emergency Mode
- Activate/deactivate emergency mode
- Critical and normal emergency levels
- Configurable withdrawal limits
- Admin role management

### 📊 Monitoring
- Real-time rate limit tracking
- Pending request monitoring
- Complete audit trail
- System status dashboard

## Quick Start

### TypeScript/JavaScript

```typescript
import { createEmergencyService } from './api/src/routes/emergency';

const service = createEmergencyService(
  'https://soroban-testnet.stellar.org',
  'CONTRACT_ID'
);

// Activate emergency
await service.activateEmergency(adminKeypair, 'Security incident detected');

// Request withdrawal
const { requestId } = await service.requestWithdrawal(
  adminKeypair,
  recipientAddress,
  '1000000',
  tokenAddress,
  'Emergency recovery'
);

// Approve (multi-sig)
await service.approveWithdrawal(admin2Keypair, requestId);

// Execute after timelock
await service.executeWithdrawal(adminKeypair, requestId);
```

## API Endpoints

### POST /api/emergency/activate
Activate emergency mode

### POST /api/emergency/withdraw/request
Create withdrawal request

### POST /api/emergency/withdraw/approve
Approve request (multi-sig)

### POST /api/emergency/withdraw/execute
Execute approved withdrawal

### GET /api/emergency/status
Get system status

## Security Measures

- ✅ Multi-signature support (1-5 admins)
- ✅ Timelock delays (default: 2 hours)
- ✅ Rate limiting (configurable windows)
- ✅ Cooldown periods (default: 1 hour)
- ✅ Amount limits per transaction and window
- ✅ Complete audit logging
- ✅ Address validation

## Configuration

```typescript
{
  maxWithdrawalAmount: '1000000',      // Per transaction
  maxWithdrawalPerWindow: '3000000',   // Per time window
  rateLimitWindowSecs: 86400,          // 24 hours
  cooldownPeriodSecs: 3600,            // 1 hour
  timelockDelaySecs: 7200,             // 2 hours
  requiredSignatures: 2                // Multi-sig threshold
}
```

## Rust Contract

See `stellar-lend/contracts/hello-world/src/withdraw.rs` for complete implementation.

## License

ISC License
