# Predinex Contract API Reference

This document serves as the comprehensive API reference for the Predinex Stellar/Soroban smart contract.

## Entrypoints

### `create_pool`
Creates a new binary outcome prediction pool.
- **Signature**: `pub fn create_pool(env: Env, creator: Address, config: PoolConfig) -> Result<u32, ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `creator`: The address creating the pool
  - `config`: Configuration for the pool (metadata, timestamps, etc.)
- **Returns**: `u32` representing the new Pool ID.
- **Errors**: `Unauthorized`, `InvalidConfig`, `FeeTooLow`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- create_pool --creator <ACCOUNT> --config <JSON>
  ```

### `place_bet`
Places a bet on an active pool.
- **Signature**: `pub fn place_bet(env: Env, user: Address, pool_id: u32, outcome: u32, amount: i128) -> Result<(), ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `user`: Address placing the bet
  - `pool_id`: The ID of the pool
  - `outcome`: The outcome index (e.g., 0 for Yes, 1 for No)
  - `amount`: Amount of tokens to bet
- **Returns**: `()`
- **Errors**: `PoolNotFound`, `PoolNotActive`, `InsufficientFunds`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- place_bet --user <ACCOUNT> --pool_id 1 --outcome 0 --amount 10000000
  ```

### `cancel_bet`
Cancels part (or all) of a previously placed bet while the pool is open and not expired.
- **Signature**: `pub fn cancel_bet(env: Env, user: Address, pool_id: u32, outcome: u32, amount: i128) -> Result<i128, ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `user`: Address that placed the bet (only the bettor may cancel their own position)
  - `pool_id`: The ID of the pool
  - `outcome`: The outcome index the stake is on (e.g., 0 for Yes, 1 for No)
  - `amount`: Amount to cancel; must be `> 0` and `<=` the user's stake on `outcome`
- **Returns**: `i128` (amount refunded)
- **Behavior**: Refunds `amount` to the caller, reduces the outcome total and the user's position, and leaves `participant_count` unchanged. Any non-zero remaining stake must still satisfy the per-pool min/max bet limits. Emits `bet_cancelled`.
- **Errors**: `PoolNotFound`, `PoolNotOpen`, `PoolExpired`, `InvalidOutcome`, `InvalidBetAmount`, `NoBetFound`, `BetBelowMinBet`, `BetAboveMaxBet`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- cancel_bet --user <ACCOUNT> --pool_id 1 --outcome 0 --amount 5000000
  ```

### `extend_pool_duration`
Extends an open pool's duration before it expires. Only the pool creator may call this.
- **Signature**: `pub fn extend_pool_duration(env: Env, creator: Address, pool_id: u32, additional_seconds: u64) -> Result<u64, ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `creator`: The pool creator
  - `pool_id`: The ID of the pool
  - `additional_seconds`: Seconds to add to the current expiry; must be `> 0`
- **Returns**: `u64` (the pool's new expiry timestamp)
- **Behavior**: Pushes `pool.expiry` out by `additional_seconds`, capped so total lifetime never exceeds `MAX_POOL_DURATION_SECS` (1,000,000 s) from creation. Pool must be `Open` and not yet expired. Emits `pool_duration_extended`.
- **Errors**: `PoolNotFound`, `Unauthorized`, `PoolNotOpen`, `PoolExpired`, `DurationTooShort`, `DurationTooLong`, `ExpiryOverflow`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- extend_pool_duration --creator <ACCOUNT> --pool_id 1 --additional_seconds 3600
  ```

### `settle_pool`
Settles a pool by declaring the winning outcome.
- **Signature**: `pub fn settle_pool(env: Env, caller: Address, pool_id: u32, winning_outcome: u32) -> Result<(), ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `caller`: Address authorized to settle the pool
  - `pool_id`: The ID of the pool
  - `winning_outcome`: The outcome index that won
- **Returns**: `()`
- **Errors**: `Unauthorized`, `PoolNotActive`, `InvalidOutcome`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- settle_pool --caller <ACCOUNT> --pool_id 1 --winning_outcome 0
  ```

### `claim_winnings`
Claims winnings from a settled pool.
- **Signature**: `pub fn claim_winnings(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError>`
- **Parameters**:
  - `env`: Soroban environment
  - `user`: Address claiming winnings
  - `pool_id`: The ID of the pool
- **Returns**: `i128` (amount claimed)
- **Errors**: `PoolNotSettled`, `NoWinnings`, `AlreadyClaimed`.
- **Example**:
  ```bash
  stellar contract invoke --id <ID> --source <ACCOUNT> --network testnet \
    -- claim_winnings --user <ACCOUNT> --pool_id 1
  ```

*(Other entrypoints such as `initialize`, `set_protocol_fee`, `cancel_pool`, `withdraw_treasury`, etc., follow similar conventions. Please refer to the source code for exhaustive parameter lists.)*

## Events Section

### Topic
- `place_bet`
- `settle_pool`
- `create_pool`

### Data Schema
- **`place_bet`**: `[user: Address, pool_id: u32, outcome: u32, amount: i128]`
- **`settle_pool`**: `[pool_id: u32, winning_outcome: u32]`

### Example
```json
{
  "topics": ["Predinex", "place_bet"],
  "data": { "user": "GB...", "pool_id": 1, "outcome": 0, "amount": 10000000 }
}
```

## Error Reference

### Code / Meaning / Resolution
- **`PoolNotFound (1)`**: The requested pool ID does not exist. Ensure you are passing a valid pool ID.
- **`PoolNotActive (2)`**: The pool is paused, cancelled, or settled. Check pool state before betting.
- **`Unauthorized (3)`**: The caller is not allowed to perform this action. Ensure the caller is the creator or admin.
- **`InsufficientFunds (4)`**: The user does not have enough balance. Top up the wallet and approve the token allowance.
