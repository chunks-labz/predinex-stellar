# Unified Event Emission Pattern

## Overview

This document describes the unified event emission pattern implemented across all Predinex contract modules. All events follow a consistent structure with schema versioning support to enable robust indexing and future compatibility.

## Architecture

### Module Organization

All event definitions and emission logic are consolidated in `src/events.rs`:

- **Event Structs**: Typed data payloads for each event
- **Emission Methods**: `impl` blocks with `.emit()` methods for consistent publishing
- **Schema Versioning**: Centralized version constant and helper function
- **Supporting Types**: Enums and structs used by events

### Benefits

1. **Consistency**: All events use the same topic layout and emission pattern
2. **Discoverability**: All events defined in one place, easy to find and document
3. **Type Safety**: Structured event payloads with compile-time validation
4. **Maintainability**: Single source of truth for event schemas
5. **Backward Compatibility**: Schema versioning enables safe upgrades

## Event Topic Layout

Every event uses this consistent topic structure:

```rust
(Symbol(event_name), Symbol(schema_version), ...identifiers)
```

- **Position 0**: Event name (e.g., `"create_pool"`, `"place_bet"`)
- **Position 1**: Schema version marker (currently `"v1"`)
- **Position 2+**: Entity identifiers (pool_id, user address, etc.)

### Examples

```rust
// Pool creation event
(Symbol("create_pool"), Symbol("v1"), pool_id)

// Bet placement event
(Symbol("place_bet"), Symbol("v1"), user, pool_id)

// Claim winnings event
(Symbol("claim_winnings"), Symbol("v1"), pool_id, claimant)
```

## Using the Unified Pattern

### Emitting Events

Instead of calling `env.events().publish()` directly, use the `.emit()` method on event structs:

**Old Pattern (Deprecated)**:
```rust
env.events().publish(
    (Symbol::new(&env, "create_pool"), event_version(&env), pool_id),
    CreatePoolEvent {
        creator: creator.clone(),
        expiry,
        title: title.clone(),
        outcome_a_name: outcome_a_name.clone(),
        outcome_b_name: outcome_b_name.clone(),
    },
);
```

**New Pattern (Recommended)**:
```rust
use crate::events::CreatePoolEvent;

CreatePoolEvent::emit(
    &env,
    pool_id,
    CreatePoolEvent {
        creator: creator.clone(),
        expiry,
        title: title.clone(),
        outcome_a_name: outcome_a_name.clone(),
        outcome_b_name: outcome_b_name.clone(),
    },
);
```

### Event Categories

Events are organized into logical categories:

#### Pool Lifecycle Events
- `CreatePoolEvent` - Pool creation
- `SettlePoolEvent` - Pool settlement
- `SettleExpiredEvent` - Expired pool settlement
- `VoidPoolEvent` - Pool voiding
- `PoolCancelledEvent` - Pool cancellation
- `PoolDurationExtendedEvent` - Duration extension
- `PoolRefundedEvent` - Expired pool refund

#### Betting Events
- `BetEvent` - Bet placement
- `BetCancelledEvent` - Bet cancellation

#### Claim Events
- `ClaimEvent` - Winnings claim
- `ClaimRefundEvent` - Refund claim from voided pool
- `ClaimExpiredEvent` - Expired pool claim

#### Referral Events
- `ReferralBetEvent` - Referral bet placement
- `ReferralRewardClaimedEvent` - Referral reward claim

#### Admin/Configuration Events
- `FeeConfigUpdatedEvent` - Fee configuration update
- `ProtocolFeeSetEvent` - Protocol fee change
- `PoolBetLimitsSetEvent` - Pool bet limits configuration

## Schema Versioning

### Current Version

The current schema version is `"v1"`, defined as:

```rust
pub const EVENT_SCHEMA_VERSION: &str = "v1";
```

### Upgrade Rules

1. **Backward-Compatible Changes**: Add optional fields without changing version
   - Example: Adding a new field with a default value

2. **Breaking Changes**: Bump version to `"v2"` and document
   - Example: Removing a field, changing field types, reordering topics
   - Document in `web/docs/CONTRACT_EVENTS.md`

3. **Single Version Per Release**: Never emit multiple versions for the same event

### Version Helper

Use `event_version()` to generate the version symbol:

```rust
use crate::events::event_version;

let version = event_version(&env); // Returns Symbol("v1")
```

## Migration Guide

### For New Events

When adding a new event:

1. Define the event struct in `src/events.rs`
2. Add the `#[contracttype]` attribute
3. Implement the `.emit()` method following the pattern
4. Add documentation comments explaining the event purpose
5. Update this document with the new event

### For Existing Code

When refactoring existing event emissions:

1. Import the event type from `crate::events`
2. Replace direct `env.events().publish()` calls with `EventType::emit()`
3. Keep the same topic layout to maintain backward compatibility
4. Remove any duplicate event struct definitions

## Testing

### Unit Testing Event Emission

```rust
#[test]
fn test_create_pool_event() {
    let env = Env::default();
    let creator = Address::generate(&env);
    
    CreatePoolEvent::emit(
        &env,
        1,
        CreatePoolEvent {
            creator: creator.clone(),
            expiry: 1000,
            title: String::from_str(&env, "Test Market"),
            outcome_a_name: String::from_str(&env, "Yes"),
            outcome_b_name: String::from_str(&env, "No"),
        },
    );
    
    // Verify event was emitted with correct topics
    let events = env.events().all();
    assert_eq!(events.len(), 1);
    
    let (topics, _data) = &events[0];
    assert_eq!(topics.len(), 3);
    // Verify event name, version, and pool_id
}
```

### Integration Testing

Ensure all contract methods that emit events use the unified pattern:

```rust
#[test]
fn test_create_pool_emits_event() {
    let env = Env::default();
    let contract = create_contract(&env);
    
    contract.create_pool(/* ... */);
    
    // Verify CreatePoolEvent was emitted
    let events = env.events().all();
    assert!(events.iter().any(|(topics, _)| {
        topics[0] == Symbol::new(&env, "create_pool")
    }));
}
```

## Indexer Integration

### Topic Filters

Indexers can filter events by version:

```javascript
// Filter for v1 create_pool events only
const filter = {
  contractId: PREDINEX_CONTRACT_ID,
  topics: [
    ["create_pool"],  // event name
    ["v1"]            // schema version
  ]
};
```

### Handling Version Changes

When a new schema version is released:

1. Indexers continue processing `v1` events
2. Add handlers for `v2` events with new schema
3. Both versions coexist during transition period
4. Old events remain queryable with `v1` filter

## Performance Considerations

### Event Size

Keep event payloads focused:
- Include only essential data that can't be reconstructed
- Consider gas costs for large strings or vectors
- Use references for addresses when possible

### Emission Frequency

For high-frequency events:
- Batch related state changes before emitting
- Consider aggregating multiple operations into single events
- Use appropriate topic indexing for efficient queries

## Security

### Access Control

Event emission should occur **after** all state changes and validation:

```rust
// ✓ Good: State updated before event
pool.status = PoolStatus::Settled;
env.storage().persistent().set(&DataKey::Pool(pool_id), &pool);
SettlePoolEvent::emit(&env, pool_id, event_data);

// ✗ Bad: Event before state
SettlePoolEvent::emit(&env, pool_id, event_data);
pool.status = PoolStatus::Settled; // Could panic, event already emitted
```

### Data Validation

Validate all event data before emission:

```rust
// ✓ Good: Validate first
if amount <= 0 {
    return Err(ContractError::InvalidAmount);
}
BetEvent::emit(&env, &user, pool_id, event_data);

// ✗ Bad: Emit potentially invalid data
BetEvent::emit(&env, &user, pool_id, event_data);
if amount <= 0 {
    return Err(ContractError::InvalidAmount);
}
```

## Related Documentation

- `web/docs/CONTRACT_EVENTS.md` - Detailed event schema reference
- `src/events.rs` - Event definitions and implementation
- `README.md` - General contract documentation

## Changelog

### v1.0.0 (2024)
- Initial unified event emission pattern
- Consolidated all events into `events.rs` module
- Standardized topic layout across all events
- Added schema versioning support
- Implemented `.emit()` helper methods for all events
