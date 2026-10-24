# ADR-0001: Settlement flow

## Status
Accepted

## Context
Predinex prediction markets require a deterministic settlement process once a market resolves. The existing implementation settles pools and distributes funds through the Soroban contract, but the rationale for key choices (oracle handling, fund distribution, and settlement authorization) was not recorded in a durable format.

## Decision
Record the core settlement flow: markets are created, accept bets during the betting window, and once resolved by an authorized oracle/settler path, the contract settles the pool and distributes funds to winning bettors according to the pool accounting logic in the `predinex` contract. The settlement operation must be idempotent and must not allow re-opening bets after settlement.

## Consequences
- Provides a stable reference for future changes to settlement logic.
- Makes it easier to reason about safety properties (finality, no double-payouts).
- Clarifies which roles are authorized to settle pools.

## References
- contracts/predinex/src/lib.rs (settle_pool logic)
- docs/MARKET_LIFECYCLE.md
