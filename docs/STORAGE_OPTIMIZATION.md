# Smart Contract Storage Optimization Guide

This document outlines identified opportunities to reduce Soroban contract storage costs and improve performance.

## Current Storage Usage Analysis

### High-Cost Data Structures

#### 1. Pool Struct (Instance Per Pool)
**File:** `contracts/predinex/src/lib.rs`

**Current Fields:**
- `creator` (Address): ~32 bytes
- `title` (String): Variable, typically 50-200 bytes
- `description` (String): Variable, typically 100-500 bytes
- `outcome_a_name` (String): ~20-50 bytes
- `outcome_b_name` (String): ~20-50 bytes
- `total_a` (i128): 16 bytes
- `total_b` (i128): 16 bytes
- `participant_count` (u32): 4 bytes
- `settled` (bool): 1 byte
- `winning_outcome` (Option<u32>): 5 bytes
- `created_at` (u64): 8 bytes
- `expiry` (u64): 8 bytes
- `status` (PoolStatus): 1 byte

**Total per pool:** ~700-1,500 bytes (before Soroban serialization overhead)

**Optimization Opportunities:**

##### A. Compress Text Fields (High Priority)
- **Strategy:** Store hashes or off-chain references instead of full strings
- **Implementation:** Use IPFS/URI references for long descriptions; store SHA256 hashes on-chain
- **Savings:** ~300-700 bytes per pool
- **Trade-off:** Requires frontend to resolve hashes; adds latency for cold lookups

**Example:**
```rust
pub struct Pool {
    pub creator: Address,
    pub title: String,  // Keep short (max 50 chars)
    pub description_hash: Bytes32,  // Store hash, fetch from IPFS
    // ... rest of fields
}
```

##### B. Eliminate Redundant Fields (Medium Priority)
- **Field:** `participant_count` (currently stored)
- **Issue:** Can be computed by iterating stored `UserBet(pool_id, user)` entries
- **Savings:** 4 bytes per pool
- **Trade-off:** Higher CPU cost on lookups; small win unless millions of pools

**Example:**
```rust
pub fn get_participant_count(env: &Env, pool_id: u32) -> u32 {
    // Count UserBet entries instead of storing
}
```

#### 2. UserBet Struct (Instance Per User Per Pool)
**Current Fields:**
- `amount_a` (i128): 16 bytes
- `amount_b` (i128): 16 bytes
- `total_bet` (i128): 16 bytes  ← **Redundant**

**Optimization: Remove Redundant total_bet**
- **Savings:** 16 bytes per user position
- **Implementation:** Compute `total_bet = amount_a + amount_b` on-read
- **Trade-off:** Minimal; single addition is cheap

**Example:**
```rust
#[contracttype]
pub struct UserBet {
    pub amount_a: i128,
    pub amount_b: i128,
    // total_bet can be computed as amount_a + amount_b
}

pub fn get_user_total_bet(amount_a: i128, amount_b: i128) -> i128 {
    amount_a.saturating_add(amount_b)
}
```

### Medium-Cost Data Structures

#### 3. Event Structs (Emitted Only)
Events are immutable and transient (not stored persistently), so optimization here helps with ledger bloat but not persistent storage costs.

**Current Events:**
- `BetEvent`, `SettlePoolEvent`, `CreatePoolEvent`, etc.

**Opportunities:**
- Shorten field names in external events to save ~10-20% per emission
- Use symbol indices instead of full strings for repeated labels

## Optimization Roadmap

### Phase 1 (Quick Wins, ~20% savings)
1. ✅ Document storage usage (this file)
2. Remove `UserBet.total_bet` field → Saves 16 bytes per position
3. Add a `UserBet` view function `get_total_bet(amount_a, amount_b)` → 1-2 extra CPU ops

### Phase 2 (Medium Effort, ~40% savings)
1. Implement optional off-chain description references
   - Add field: `description_hash: Option<Bytes32>`
   - Keep short `title` on-chain for UX
   - Fetch full description from IPFS/URI on frontend
2. Compress outcome names (max 10 chars or use enum)

### Phase 3 (High Complexity, ~60% savings)
1. Implement a `PoolCompactForm` struct for archived/settled pools
   - Older pools can be migrated to a compressed format
   - Keep recent pools in `Pool` format for performance
2. Implement per-pool metadata sharding
   - Split large pools into multiple storage entries

## Measurement & Benchmarking

### Current Baseline (Before Optimization)
To establish a baseline, run:
```bash
cargo test --features=soroban_test_env -- --test-threads=1 --nocapture
```

Measure:
- Bytes written per `create_pool` call
- Bytes written per `place_bet` call
- Total persistent storage for 100 pools × 100 users

### Post-Optimization Metrics
After implementing Phase 1, expect:
- ~2% reduction in persistent storage per pool
- ~1-3% increase in CPU per position lookup (negligible at current scale)

## Contract Interface Impact

### Breaking Changes (Avoided if Possible)
None of the above optimizations require breaking contract interfaces if implemented carefully.

### Non-Breaking Alternatives
1. Keep redundant fields for now, mark them `#[deprecated]`
2. Add new view functions for computed values
3. Phase in compression via new contract versions

## Notes for Developers

- Before deploying optimizations, test with 1M+ positions to verify CPU/memory bounds
- Consider implementing a storage migration utility for existing pools
- Document any changes to `DataKey` enum in `STORAGE_SCHEMA.md`
- Add benchmarks to CI to track storage and performance over time

## References

- [Soroban Storage Architecture](https://developers.stellar.org/docs/smart-contracts/storing-data)
- [Protocol Fee Tracking](./PROTOCOL_REVENUE.md)
- [Pool Duration Policy](./POOL_DURATION.md)
