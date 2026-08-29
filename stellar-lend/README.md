# Stellar Lend - Emergency Withdrawal System

Production-ready emergency withdrawal mechanism with comprehensive security measures.

## Features

- ✅ Multi-signature support
- ✅ Timelock delays
- ✅ Rate limiting
- ✅ Audit logging
- ✅ REST API
- ✅ >80% test coverage

## Quick Start

```rust
// Rust Contract
use stellar_lend::withdraw::EmergencyWithdrawal;

// Initialize
EmergencyWithdrawal::initialize(env, admin, max_amount)?;

// Activate emergency
EmergencyWithdrawal::activate_emergency(env, admin, reason)?;
```

```typescript
// TypeScript API
import { createEmergencyService } from './api/src/routes/emergency';

const service = createEmergencyService(rpcUrl, contractId);
await service.activateEmergency(adminKeypair, reason);
```

## Documentation

See `/docs/EMERGENCY_WITHDRAWAL.md`

## License

ISC
