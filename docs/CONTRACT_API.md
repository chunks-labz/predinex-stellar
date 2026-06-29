# CONTRACT_API.md — Predinex Contract Public Entrypoints

#cool

> **Contract:** `predinex` · **Version:** 0.1.0  
> **SDK:** Soroban SDK 22 · **Network:** Stellar Testnet / Mainnet  
> **Source:** `contracts/predinex/src/lib.rs`

Complete reference for every public entrypoint in `PredinexContract`.  
Sections: [Pool Management](#pool-management) · [Betting](#betting) · [Settlement](#settlement) · [Claims](#claims) · [Pool Templates](#pool-templates) · [Admin](#admin) · [Queries](#queries)

---

## Fee Model

```
fee       = floor(total_pool_balance × fee_bps / 10_000)
net_pool  = total_pool_balance − fee
winnings  = floor(user_winning_bet × net_pool / winning_side_total)
```

- Default fee: **200 bps (2%)** — configurable via `set_protocol_fee` (0–1 000 bps).  
- Fee is credited to the treasury once, on the **first** winner claim.  
- Rounding dust is swept to treasury on the **final** claim.  
- Conservation: `treasury_credit + Σ(payouts) == total_pool_balance`.

---

## Core Data Types

### `Pool`

| Field | Type | Description |
|---|---|---|
| `id` | `u32` | Auto-incremented pool identifier |
| `creator` | `Address` | Account that created the pool |
| `title` | `String` | Market title (max 100 bytes) |
| `description` | `String` | Market description (max 1 000 bytes) |
| `outcome_a_name` | `String` | Label for outcome A (max 50 bytes) |
| `outcome_b_name` | `String` | Label for outcome B (max 50 bytes) |
| `total_a` | `i128` | Total tokens staked on outcome A (stroops) |
| `total_b` | `i128` | Total tokens staked on outcome B (stroops) |
| `participant_count` | `u32` | Number of unique bettors |
| `settled` | `bool` | `true` once `settle_pool` completes |
| `winning_outcome` | `Option<u32>` | Index of the winning outcome; `None` until settled |
| `expires_at` | `u64` | Unix timestamp after which betting is closed |

### `PoolTemplate`

| Field | Type | Description |
|---|---|---|
| `id` | `u32` | Auto-incremented template identifier |
| `title` | `String` | Template title (max 100 bytes) |
| `description` | `String` | Default description (max 1 000 bytes) |
| `outcomes` | `Vec<String>` | Outcome labels (2–10 items) |
| `duration` | `u64` | Default pool lifetime in seconds |
| `metadata_uri` | `Option<String>` | Optional IPFS / HTTPS metadata link |

### `PoolTemplateOverrides`

| Field | Type | Description |
|---|---|---|
| `title` | `Option<String>` | Override template title |
| `description` | `Option<String>` | Override template description |
| `outcomes` | `Option<Vec<String>>` | Override outcome labels |
| `duration` | `Option<u64>` | Override pool duration |
| `metadata_uri` | `Option<Option<String>>` | Override metadata URI |

### `ContractError`

| Code | Variant | Description |
|---|---|---|
| 1 | `Unauthorized` | Caller lacks required permission |
| 2 | `PoolNotFound` | Pool ID does not exist |
| 3 | `PoolSettled` | Operation not allowed on a settled pool |
| 4 | `PoolExpired` | Pool deadline has passed |
| 5 | `PoolNotExpired` | Settlement attempted before expiry |
| 6 | `AlreadyBet` | User already has a bet on this pool |
| 7 | `InvalidOutcome` | Outcome index out of range |
| 8 | `InsufficientBalance` | Token balance too low |
| 9 | `TitleEmpty` | Title field is blank |
| 10 | `TitleTooLong` | Title exceeds 100-byte limit |
| 11 | `StringWhitespaceOnly` | String is all whitespace |
| 12 | `InvalidDuration` | Duration outside allowed range |

---

## Pool Management

### `initialize`

```rust
pub fn initialize(
    env: Env,
    token: Address,
    treasury: Address,
    treasury_recipient: Address,
) -> Result<(), ContractError>
```

**Auth:** `treasury_recipient`  
**One-time call.** Stores the payment token, treasury, and treasury recipient. Subsequent calls revert with `Unauthorized`.

| Parameter | Type | Description |
|---|---|---|
| `token` | `Address` | SEP-41 token contract for all pool wagers |
| `treasury` | `Address` | Address that accumulates protocol fees |
| `treasury_recipient` | `Address` | Account authorised to withdraw from treasury and update admin settings |

**Returns:** `Result<(), ContractError>`  
**Errors:** `Unauthorized` if already initialised.

---

### `create_pool`

```rust
pub fn create_pool(
    env: Env,
    creator: Address,
    title: String,
    description: String,
    outcome_a: String,
    outcome_b: String,
    duration: u64,
    metadata_uri: Option<String>,
) -> Result<u32, ContractError>
```

**Auth:** `creator`  
Creates a two-outcome prediction market. Charges the creation fee if one is set and the caller is not exempt.

| Parameter | Type | Description |
|---|---|---|
| `creator` | `Address` | Pool creator; must sign the transaction |
| `title` | `String` | Market title (1–100 bytes, non-whitespace) |
| `description` | `String` | Market description (1–1 000 bytes) |
| `outcome_a` | `String` | Label for outcome A (1–50 bytes) |
| `outcome_b` | `String` | Label for outcome B (1–50 bytes) |
| `duration` | `u64` | Seconds from now until betting closes |
| `metadata_uri` | `Option<String>` | Optional metadata link (max 200 bytes) |

**Returns:** `u32` — the new pool ID.  
**Errors:** `TitleEmpty`, `TitleTooLong`, `StringWhitespaceOnly`, `InvalidDuration`.  
**Events:** `create_pool(pool_id, creator)` with schema version `v1`.

**Example:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $MY_KEY --network testnet \
  -- create_pool \
  --creator $MY_ADDRESS \
  --title '"Will BTC hit $100k in 2026?"' \
  --description '"Settlement based on CoinMarketCap spot price at 00:00 UTC."' \
  --outcome_a '"Yes"' --outcome_b '"No"' \
  --duration 604800 \
  --metadata_uri 'null'
```

---

### `create_multi_outcome_pool`

```rust
pub fn create_multi_outcome_pool(
    env: Env,
    creator: Address,
    title: String,
    description: String,
    outcomes: Vec<String>,
    duration: u64,
    metadata_uri: Option<String>,
) -> Result<u32, ContractError>
```

**Auth:** `creator`  
Like `create_pool` but supports 2–10 named outcomes.

| Parameter | Type | Description |
|---|---|---|
| `outcomes` | `Vec<String>` | 2–10 outcome labels, each 1–50 bytes |

**Returns:** `u32` — the new pool ID.  
**Errors:** Same as `create_pool` plus `InvalidOutcome` if `outcomes.len() < 2` or `> 10`.

---

### `schedule_pool`

```rust
pub fn schedule_pool(
    env: Env,
    creator: Address,
    title: String,
    description: String,
    outcomes: Vec<String>,
    duration: u64,
    open_at: u64,
    metadata_uri: Option<String>,
) -> Result<u32, ContractError>
```

**Auth:** `creator`  
Creates a pool that is inactive until `activate_scheduled_pool` is called after `open_at`.

| Parameter | Type | Description |
|---|---|---|
| `open_at` | `u64` | Unix timestamp when the pool opens for betting |

**Returns:** `u32` — pool ID.

---

### `activate_scheduled_pool`

```rust
pub fn activate_scheduled_pool(env: Env, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** Anyone (permissionless once `open_at` has passed).  
Transitions a scheduled pool to active. Fails if called before `open_at`.

---

### `cancel_scheduled_pool`

```rust
pub fn cancel_scheduled_pool(
    env: Env,
    caller: Address,
    pool_id: u32,
) -> Result<(), ContractError>
```

**Auth:** `caller` (creator or treasury recipient).

---

### `extend_pool_duration`

```rust
pub fn extend_pool_duration(
    env: Env,
    caller: Address,
    pool_id: u32,
    additional_seconds: u64,
) -> Result<(), ContractError>
```

**Auth:** `caller` (creator or treasury recipient).

---

### `cancel_pool`

```rust
pub fn cancel_pool(env: Env, creator: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** `creator` (creator or treasury recipient).  
Voids an unsettled pool and enables full refunds for all bettors.

---

## Betting

### `place_bet`

```rust
pub fn place_bet(
    env: Env,
    user: Address,
    pool_id: u32,
    outcome: u32,
    amount: i128,
) -> Result<(), ContractError>
```

**Auth:** `user`  
Transfers `amount` stroops from `user` to the contract and records the bet.

| Parameter | Type | Description |
|---|---|---|
| `user` | `Address` | Bettor address |
| `pool_id` | `u32` | Target pool |
| `outcome` | `u32` | 0-indexed outcome index |
| `amount` | `i128` | Wager in stroops (must satisfy per-pool `min_bet`/`max_bet`) |

**Returns:** `Result<(), ContractError>`  
**Errors:** `PoolNotFound`, `PoolExpired`, `PoolSettled`, `AlreadyBet`, `InvalidOutcome`, `InsufficientBalance`.  
**Events:** `place_bet(pool_id, user, outcome, amount)`.

---

### `cancel_bet`

```rust
pub fn cancel_bet(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError>
```

**Auth:** `user`  
Cancels an existing bet and refunds `amount` to `user`. Only allowed before the pool expires.

**Returns:** `i128` — refunded amount in stroops.

---

## Settlement

### `settle_pool`

```rust
pub fn settle_pool(
    env: Env,
    caller: Address,
    pool_id: u32,
    winning_outcome: u32,
) -> Result<(), ContractError>
```

**Auth:** `caller` (creator, assigned settler, or treasury recipient). Pool must be expired.

| Parameter | Type | Description |
|---|---|---|
| `winning_outcome` | `u32` | 0-indexed index of the winning outcome |

**Errors:** `PoolNotFound`, `PoolNotExpired`, `InvalidOutcome`, `Unauthorized`.  
**Events:** `settle_pool(pool_id, winning_outcome, settler)`.

---

### `settle_pools`

```rust
pub fn settle_pools(
    env: Env,
    caller: Address,
    settlements: Vec<(u32, u32)>,
) -> Result<Vec<Result<(), ContractError>>, ContractError>
```

Batch settlement. Each tuple is `(pool_id, winning_outcome)`.

---

### `void_pool`

```rust
pub fn void_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** treasury recipient only.  
Marks a pool void — all bets become fully refundable.

---

### `assign_settler`

```rust
pub fn assign_settler(
    env: Env,
    creator: Address,
    pool_id: u32,
    settler: Address,
) -> Result<(), ContractError>
```

**Auth:** `creator`.  
Delegates settlement rights for `pool_id` to `settler`.

---

## Claims

### `claim_winnings`

```rust
pub fn claim_winnings(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError>
```

**Auth:** `user`  
Transfers the user's proportional share of the net pool (after fee) to `user`.

**Returns:** `i128` — payout in stroops.  
**Errors:** `PoolNotFound`, `PoolNotSettled`, `NoBetFound`, `AlreadyClaimed`, `InvalidOutcome`.

---

### `claim_refund`

```rust
pub fn claim_refund(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError>
```

**Auth:** `user`  
Refunds the full bet amount when a pool is voided or cancelled.

**Returns:** `i128` — refunded amount in stroops.

---

### `claim_expired`

```rust
pub fn claim_expired(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError>
```

**Auth:** `user`  
Refunds the bet when an expired pool was never settled within the grace period.

---

### `claim_all_winnings`

```rust
pub fn claim_all_winnings(
    env: Env,
    user: Address,
    pool_ids: Vec<u32>,
) -> Result<Vec<ClaimAllEntry>, ContractError>
```

**Auth:** `user`  
Processes multiple claims in one transaction. Returns a result entry per pool.

---

### `schedule_claim`

```rust
pub fn schedule_claim(
    env: Env,
    user: Address,
    pool_id: u32,
    claim_at: u64,
) -> Result<u32, ContractError>
```

**Auth:** `user`  
Schedules a future claim. The claim is executed automatically when `execute_scheduled_claims` is called after `claim_at`.

---

### `execute_scheduled_claims`

```rust
pub fn execute_scheduled_claims(env: Env) -> Result<Vec<ClaimAllEntry>, ContractError>
```

**Auth:** None (permissionless keeper function).  
Executes all pending scheduled claims whose `claim_at` has passed.

---

## Pool Templates

Templates let users save a named pool configuration and reuse it without re-entering parameters.

### `create_pool_template`

```rust
pub fn create_pool_template(
    env: Env,
    caller: Address,
    title: String,
    description: String,
    outcomes: Vec<String>,
    duration: u64,
    metadata_uri: Option<String>,
) -> Result<u32, ContractError>
```

**Auth:** `caller`  
Saves a named template on-chain for reuse.

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Template owner |
| `title` | `String` | Template name (1–100 bytes) |
| `description` | `String` | Default description (1–1 000 bytes) |
| `outcomes` | `Vec<String>` | Default outcome labels (2–10 items) |
| `duration` | `u64` | Default pool lifetime in seconds |
| `metadata_uri` | `Option<String>` | Optional metadata link |

**Returns:** `u32` — template ID.  
**Errors:** `TitleEmpty`, `TitleTooLong`, `InvalidOutcome`, `InvalidDuration`.  
**Events:** `template_created(template_id, caller)`.

---

### `create_pool_from_template`

```rust
pub fn create_pool_from_template(
    env: Env,
    creator: Address,
    template_id: u32,
    overrides: PoolTemplateOverrides,
) -> Result<u32, ContractError>
```

**Auth:** `creator`  
Creates a new pool from a saved template. Fields in `overrides` replace the template defaults.

| Parameter | Type | Description |
|---|---|---|
| `template_id` | `u32` | ID returned by `create_pool_template` |
| `overrides` | `PoolTemplateOverrides` | Optional per-field overrides |

**Returns:** `u32` — new pool ID.  
**Errors:** `PoolNotFound` (template not found), plus all `create_pool` errors.

**Example:**

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $MY_KEY --network testnet \
  -- create_pool_from_template \
  --creator $MY_ADDRESS \
  --template_id 3 \
  --overrides '{"title":null,"description":null,"outcomes":null,"duration":86400,"metadata_uri":null}'
```

---

### `update_pool_template`

```rust
pub fn update_pool_template(
    env: Env,
    caller: Address,
    template_id: u32,
    template: PoolTemplate,
) -> Result<(), ContractError>
```

**Auth:** `caller` (must be the original template creator).


---

## Admin

### `set_protocol_fee`

```rust
pub fn set_protocol_fee(env: Env, caller: Address, fee_bps: u32) -> Result<(), ContractError>
```

**Auth:** treasury recipient. Range: 0–1 000 bps.

---

### `set_creation_fee`

```rust
pub fn set_creation_fee(env: Env, caller: Address, fee: i128) -> Result<(), ContractError>
```

**Auth:** treasury recipient. `fee` is in stroops; 0 disables the fee.

---

### `set_creation_fee_exemption`

```rust
pub fn set_creation_fee_exemption(
    env: Env,
    caller: Address,
    account: Address,
    exempt: bool,
) -> Result<(), ContractError>
```

**Auth:** treasury recipient. Grants or revokes creation-fee exemption for `account`.

---

### `set_pool_bet_limits`

```rust
pub fn set_pool_bet_limits(
    env: Env,
    caller: Address,
    pool_id: u32,
    min_bet: i128,
    max_bet: i128,
) -> Result<(), ContractError>
```

**Auth:** pool creator or treasury recipient. `max_bet = 0` means no maximum.

---

### `set_volume_fee_tiers`

```rust
pub fn set_volume_fee_tiers(
    env: Env,
    caller: Address,
    tiers: Vec<FeeTier>,
) -> Result<(), ContractError>
```

**Auth:** treasury recipient. Configures volume-based fee tiers.

---

### `set_circuit_breaker_config`

```rust
pub fn set_circuit_breaker_config(
    env: Env,
    caller: Address,
    config: CircuitBreakerConfig,
) -> Result<(), ContractError>
```

**Auth:** treasury recipient. Configures automatic pool-cooling thresholds.

---

### `rotate_treasury_recipient`

```rust
pub fn rotate_treasury_recipient(
    env: Env,
    caller: Address,
    new_recipient: Address,
) -> Result<(), ContractError>
```

**Auth:** current treasury recipient. Transfers admin rights to `new_recipient`.

---

## Queries

| Function | Signature | Description |
|---|---|---|
| `get_pool` | `(pool_id: u32) → Option<Pool>` | Fetch a single pool |
| `get_pools` | `(start_id: u32, count: u32) → Vec<Pool>` | Paginated pool listing |
| `get_user_bet` | `(pool_id: u32, user: Address) → Option<UserBet>` | User's bet on a pool |
| `get_pool_payout_state` | `(pool_id: u32) → Option<PoolPayoutState>` | Claim progress tracker |
| `get_pool_protocol_revenue` | `(pool_id: u32) → PoolProtocolRevenue` | Fee breakdown for a pool |
| `get_treasury_balance` | `() → i128` | Total treasury balance in stroops |
| `get_withdrawable_treasury` | `() → i128` | Withdrawable treasury (after rate-limit cap) |
| `get_config` | `() → Result<ContractConfig, ContractError>` | Full contract configuration |
| `get_protocol_fee` | `() → u32` | Current fee in basis points |
| `get_creation_fee` | `() → i128` | Current pool creation fee |
| `is_creation_fee_exempt` | `(account: Address) → bool` | Whether an account is fee-exempt |
| `get_delegated_settler` | `(pool_id: u32) → Option<Address>` | Delegated settler for a pool |
| `get_settlement_source` | `(pool_id: u32) → Option<SettlementSource>` | Who settled the pool |
| `get_scheduled_pools` | `(start_id: u32, count: u32) → Vec<ScheduledPool>` | Scheduled (not yet open) pools |
| `get_scheduled_claims` | `(start_id: u32, count: u32) → Vec<ScheduledClaim>` | Pending scheduled claims |
| `get_wallet_rate_limit_status` | `(user: Address) → WalletRateLimitStatus` | Per-wallet rate-limit state |

---

## Event Schema

All events follow the topic layout:

```
(Symbol(event_name), Symbol("v1"), ...identifiers)
```

Topic position 0 is the event name; position 1 is always the schema version marker `"v1"`.  
See `web/docs/CONTRACT_EVENTS.md` for the full per-event payload reference.

---

## Further Reading

- [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts)  
- [SEP-41 Token Interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)  
- `docs/CONTRACT_SPEC.md` — invariants and security model  
- `docs/CONTRACT_INPUT_VALIDATION.md` — validation rules per field  
- `docs/STORAGE_OPTIMIZATION.md` — storage key layout and rent management