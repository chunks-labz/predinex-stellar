# Stellar Lend - Lending Pool Security Modules

Production-ready lending pool safety modules for emergency withdrawals, oracle
integrity, interest-rate manipulation prevention, and MEV/sandwich protection.

## Features

- ✅ Emergency withdrawals with multi-signature support, timelock delays, rate limiting, and audit logging
- ✅ TWAP oracle validation with liquidity-weighted samples and deviation bounds
- ✅ Interest-rate update guardrails for abrupt rate and utilization jumps
- ✅ Sandwich attack protection using order delays, stale quote checks, price impact limits, and slippage limits
- ✅ REST API
- ✅ >80% test coverage

## Quick Start

```rust
// Rust Contract
use stellar_lend::withdraw::EmergencyWithdrawal;
use stellar_lend::oracle::TwapOracle;
use stellar_lend::interest_rate::InterestRateGuard;
use stellar_lend::mev_protection::MevProtection;

// Initialize
EmergencyWithdrawal::initialize(env, admin, max_amount)?;

// Activate emergency
EmergencyWithdrawal::activate_emergency(env, admin, reason)?;

// Validate price and rate safety before accepting a lending pool update
TwapOracle::validate_spot_price(spot_price, twap_price, max_deviation_bps)?;
InterestRateGuard::validate_update(previous_rate, next_rate, rate_config, now)?;
MevProtection::validate_operation(operation, quote, mev_config, now)?;
```

```typescript
// TypeScript API
import { createEmergencyService } from './api/src/routes/emergency';
import { createMevProtectionService } from './api/src/services/mev.service';
import { PriceAggregator } from './oracle/src/services/price-aggregator';
import { PriceValidator } from './oracle/src/services/price-validator';

const service = createEmergencyService(rpcUrl, contractId);
await service.activateEmergency(adminKeypair, reason);

const mev = createMevProtectionService();
const aggregator = new PriceAggregator();
const validator = new PriceValidator();
```

## Roadmap

### Completed
- Emergency withdrawal control plane and API routes.
- Gas estimator and optimization benchmark helpers.
- TWAP oracle protection for lending collateral and borrow price updates.
- Rate manipulation detection for abrupt interest-rate and utilization changes.
- MEV/sandwich protection service for delayed execution and price-bound validation.

### In Progress
- Wire the standalone `stellar-lend` modules into the deployed lending pool contract package.
- Replace mock transaction submission in API route examples with signed Soroban transactions.
- Publish operational dashboards for rejected oracle, rate, and MEV-risk updates.

### Next
- Add multi-source oracle quorum weighting.
- Add volatility-adjusted risk limits per asset.
- Add historical incident export for auditors and liquidity providers.

## Documentation

See `/docs/EMERGENCY_WITHDRAWAL.md` and `/docs/CONTRACT_API.md`.

## License

ISC
