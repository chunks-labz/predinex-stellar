# Predinex Contract API Reference

> **Contract:** `predinex` · **Version:** 0.1.0 · **SDK:** Soroban SDK 22 · **Network:** Stellar

Complete reference for every public function in `PredinexContract`, the core data types, auth requirements, error codes, and the fee model.

---

## Fee Model

The protocol fee is charged on winning payouts, not on bets placed.

```
fee        = floor(total_pool_balance × fee_bps / 10_000)
net_pool   = total_pool_balance − fee
winnings   = floor(user_winning_bet × net_pool / winning_side_total)
```

- Default fee: **200 bps (2 %)**. Configurable via `set_protocol_fee` (range 0–1000 bps).
- Fee is credited to the treasury **once**, on the first winner claim.
- Rounding dust (from floor division across all winners) is swept to the treasury on the final claim.
- Conservation invariant: `treasury_credit + sum(payouts) == total_pool_balance`.

---

## Core Data Types

### `Pool`

| Field | Type | Description |
|-------|------|-------------|
| `creator` | `Address` | Address that created the pool |
| `title` | `String` | Market title (max 100 bytes) |
| `description` | `String` | Market description (max 1 000 bytes) |
| `outcome_a_name` | `String` | Label for outcome A (max 50 bytes) |
| `outcome_b_name` | `String` | Label for outcome B (max 50 bytes) |
| `total_a` | `i128` | Total tokens staked on outcome A |
| `total_b` | `i128` | Total tokens staked on outcome B |
| `participant_count` | `u32` | Number of unique bettors |
| `settled` | `bool` | `true` once `settle_pool` succeeds |
| `winning_outcome` | `Option<u32>` | Winning outcome index after settlement |
| `created_at` | `u64` | Ledger timestamp at creation |
| `expiry` | `u64` | Ledger timestamp when betting closes |
| `status` | `PoolStatus` | Current lifecycle state |

### `PoolStatus`

| Variant | Description |
|---------|-------------|
| `Open` | Accepting bets; expiry not yet reached |
| `Settled(u32)` | Winning outcome declared; claims open |
| `Voided` | Creator voided; full refunds available |
| `Frozen` | Temporarily blocked by freeze admin |
| `Disputed` | Settlement disputed; claims blocked |
| `Cancelled` | Creator cancelled before any bet |
| `Scheduled(u64)` | Stored but betting opens at timestamp |

### `UserBet`

| Field | Type | Description |
|-------|------|-------------|
| `amount_a` | `i128` | Cumulative stake on outcome A |
| `amount_b` | `i128` | Cumulative stake on outcome B |
| `total_bet` | `i128` | Total tokens staked in this pool |

### `ContractError` (selected codes)

| Code | Name | Meaning |
|------|------|---------|
| 1 | `AlreadyInitialized` | `initialize` called twice |
| 3 | `Unauthorized` | Wrong caller |
| 5 | `InvalidBetAmount` | Zero or negative bet |
| 6 | `InvalidOutcome` | Outcome index out of range |
| 7 | `PoolExpired` | Betting window closed |
| 8 | `PoolNotExpired` | Pool has not yet expired |
| 9 | `PoolNotFound` | Pool ID does not exist |
| 10 | `PoolNotOpen` | Pool is not in Open state |
| 18 | `PoolNotSettled` | Pool is not settled |
| 23 | `NoBetFound` | Caller has no bet in this pool |
| 24 | `NothingToRefund` | Bet record exists but amount is zero |
| 25 | `NoWinningsToClaim` | User bet on the losing side |
| 50 | `ContractPaused` | Contract-wide pause is active |

---

## Functions

### Initialization

#### `initialize(token, treasury_recipient)`

**Auth:** none (deploy-time only)  
**Description:** Bootstraps the contract with the SAC token address and treasury recipient. Can only be called once.  
**Errors:** `AlreadyInitialized`

---

### Pool Lifecycle

#### `create_pool(creator, title, description, outcome_a, outcome_b, duration) → u32`

**Auth:** `creator.require_auth()`  
**Description:** Creates a binary prediction pool. Returns the new pool ID (1-based, sequential).  
**Errors:** `TitleEmpty`, `TitleTooLong`, `DescriptionEmpty`, `DescriptionTooLong`, `OutcomeEmpty`, `OutcomeTooLong`, `DurationTooShort`, `DurationTooLong`, `ExpiryOverflow`

```rust
let pool_id = client.create_pool(
    &creator,
    &String::from_str(&env, "Will BTC hit $100k?"),
    &String::from_str(&env, "Prediction market for BTC price"),
    &String::from_str(&env, "Yes"),
    &String::from_str(&env, "No"),
    &86_400u64, // 1 day
);
```

#### `settle_pool(caller, pool_id, winning_outcome)`

**Auth:** `caller.require_auth()` — must be pool creator or delegated settler  
**Description:** Declares the winning outcome. Pool must be `Open` and past expiry.  
**Errors:** `PoolNotFound`, `Unauthorized`, `PoolAlreadySettled`, `PoolNotExpired`, `InvalidOutcome`

#### `cancel_pool(creator, pool_id)`

**Auth:** `creator.require_auth()`  
**Description:** Cancels the pool (terminal state). Creator only.  
**Errors:** `PoolNotFound`, `Unauthorized`, `PoolNotOpen`

#### `void_pool(caller, pool_id)`

**Auth:** `caller.require_auth()` — must be pool creator  
**Description:** Voids the pool; all bettors can claim full refunds.  
**Errors:** `PoolNotFound`, `Unauthorized`, `PoolAlreadyVoided`, `PoolCannotBeVoided`

---

### Betting

#### `place_bet(user, pool_id, outcome, amount, referrer)`

**Auth:** `user.require_auth()`  
**Description:** Stakes `amount` tokens on `outcome` (0 = A, 1 = B). Transfers tokens from user to contract.  
**Errors:** `ContractPaused`, `InvalidBetAmount`, `PoolNotFound`, `PoolIsFrozen`, `PoolNotOpen`, `PoolExpired`, `InvalidOutcome`, `BetBelowMinBet`, `BetAboveMaxBet`, `PoolSizeLimitExceeded`, `RateLimitExceeded`

---

### Claims

#### `claim_winnings(user, pool_id) → i128`

**Auth:** `user.require_auth()`  
**Description:** Transfers the user's proportional share of the net pool to their address. Removes the bet record after transfer to prevent double-claims.  
**Returns:** Amount transferred.  
**Errors:** `ContractPaused`, `PoolNotFound`, `PoolIsFrozen`, `PoolIsDisputed`, `PoolNotSettled`, `NoBetFound`, `NoWinningsToClaim`

#### `claim_refund(user, pool_id) → i128`

**Auth:** `user.require_auth()`  
**Description:** Refunds the user's original stake from a voided or cancelled pool. No fee deducted.  
**Errors:** `ContractPaused`, `PoolNotFound`, `PoolNotSettled`, `NoBetFound`, `NothingToRefund`

#### `claim_expired(user, pool_id) → i128` *(#412)*

**Auth:** `user.require_auth()`  
**Description:** Refunds the user's original stake from a pool that expired without being settled. The pool must be `Open` and past its expiry timestamp. No protocol fee is deducted. Bet record is removed after refund to prevent double-claims.  
**Returns:** Amount refunded.  
**Errors:** `ContractPaused`, `PoolNotFound`, `PoolNotOpen`, `PoolNotExpired`, `NoBetFound`, `NothingToRefund`

```rust
// Pool expired without settlement — user reclaims stake
env.ledger().with_mut(|li| li.timestamp = pool.expiry + 1);
let refund = client.claim_expired(&user, &pool_id);
assert_eq!(refund, original_bet_amount);
```

---

### Pool Queries

#### `get_pool(pool_id) → Option<Pool>`

**Auth:** none  
**Description:** Returns pool data and extends its storage TTL. Returns `None` if pool does not exist.

#### `get_pool_count() → u32`

**Auth:** none  
**Description:** Returns the next pool ID (i.e. total pools created + 1).

#### `get_pools_batch(start_id, count) → Vec<Option<Pool>>`

**Auth:** none  
**Description:** Returns up to 100 pools starting from `start_id`. Each entry is `Option<Pool>` to handle gaps. Capped at 100.

#### `list_pools(start, limit) → Vec<Pool>` *(#411)*

**Auth:** none (view-only, callable by anyone)  
**Description:** Returns a paginated slice of pools in insertion order (ascending pool ID). `start` is the 1-based pool ID to begin from; `limit` is capped at **20** to bound ledger reads. Returns an empty vec when `start >= pool_counter`. Skips missing pool IDs silently.

```rust
// First page
let page1 = client.list_pools(&1, &20);
// Second page
let page2 = client.list_pools(&21, &20);
```

#### `get_user_bet(pool_id, user) → Option<UserBet>`

**Auth:** none  
**Description:** Returns the user's bet record for a pool, or `None` if no bet exists.

#### `get_claim_status(pool_id, user) → ClaimStatus`

**Auth:** none  
**Description:** Returns `NeverBet`, `Claimable`, `RefundClaimable`, `NotEligible`, or `AlreadyClaimed`.

#### `preview_claimable_amount(pool_id, user) → ClaimPreview`

**Auth:** none  
**Description:** Returns the exact amount `claim_winnings` would transfer, or explains why nothing is claimable.

---

### Treasury

#### `get_treasury_balance() → i128`

**Auth:** none  
**Description:** Returns the current treasury balance held by the contract.

#### `withdraw_treasury(caller, amount)`

**Auth:** `caller.require_auth()` — must be treasury recipient  
**Description:** Transfers `amount` from treasury to the recipient address.  
**Errors:** `Unauthorized`, `InvalidWithdrawalAmount`, `InsufficientTreasuryBalance`, `RateLimitExceeded`

#### `rotate_treasury_recipient(caller, new_recipient)`

**Auth:** `caller.require_auth()` — must be current treasury recipient  
**Description:** Rotates the treasury recipient to a new address.

#### `set_protocol_fee(caller, fee_bps)`

**Auth:** treasury recipient  
**Description:** Sets the protocol fee in basis points (0–1000). Default is 200.

---

### Admin / Config

#### `set_paused(caller, paused)`

**Auth:** treasury recipient  
**Description:** Pauses or unpauses the contract. While paused, `place_bet`, `settle_pool`, `claim_winnings`, `claim_refund`, and `void_pool` are blocked.

#### `set_freeze_admin(caller, freeze_admin)`

**Auth:** treasury recipient  
**Description:** Sets the address authorised to freeze/unfreeze/dispute pools.

#### `freeze_pool(caller, pool_id)` / `unfreeze_pool(caller, pool_id)` / `dispute_pool(caller, pool_id)`

**Auth:** freeze admin  
**Description:** Manage per-pool freeze and dispute states.

#### `assign_settler(creator, pool_id, settler)`

**Auth:** pool creator  
**Description:** Delegates settlement authority for a pool to another address.

---

## Events

All events include `EVENT_SCHEMA_VERSION` (`"v1"`) as topic position 1.

| Event | Topics | Payload |
|-------|--------|---------|
| `create_pool` | `pool_id` | `CreatePoolEvent` |
| `place_bet` | `pool_id`, `user` | `BetEvent` |
| `settle_pool` | `pool_id` | `SettlePoolEvent` |
| `claim_winnings` | `pool_id`, `user` | `ClaimEvent` |
| `claim_refund` | `pool_id`, `user` | `i128` (refund amount) |
| `claim_expired` | `pool_id`, `user` | `i128` (refund amount) |
| `cancel_pool` | `pool_id` | `Address` (creator) |
| `void_pool` | `pool_id` | `Address` (caller) |
| `pool_frozen` | `pool_id` | `Address` (caller) |
| `pool_unfrozen` | `pool_id` | `Address` (caller) |
| `treasury_withdrawn` | — | `(caller, recipient, amount)` |
| `treasury_recipient_rotated` | — | `(old, new)` |
| `protocol_fee_set` | — | `(caller, fee_bps)` |
