# API_REFERENCE.md — Predinex Contract Public Entrypoints

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

## Create

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
    creator: Address,
    pool_id: u32,
    additional_seconds: u64,
) -> Result<u64, ContractError>
```

**Auth:** `creator` (the pool creator only).

**Bounds:** `additional_seconds` must be `> 0` and at most `MAX_EXTENSION_SECS`
(30 days) per call, and the resulting expiry must not push the pool's total
lifetime beyond `MAX_POOL_DURATION_SECS` (≈1 year) from creation. Violations
return `DurationTooShort` / `DurationTooLong`.

---

### `cancel_pool`

```rust
pub fn cancel_pool(env: Env, creator: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** `creator` (creator or treasury recipient).  
Voids an unsettled pool and enables full refunds for all bettors.

---


### `create_multi_asset_pool`

```rust
pub fn create_multi_asset_pool(
    env: Env, creator: Address, title: String, description: String, outcomes: Vec<String>,
    duration: u64, allowed_tokens: Vec<Address>, metadata_uri: Option<String>, deposit_deadline: Option<u64>
) -> Result<u32, ContractError>
```

### `delete_pool_template`

```rust
pub fn delete_pool_template(env: Env, caller: Address, template_id: u32) -> Result<(), ContractError>
```

## Bet


### Multi-Asset Bet Example

```bash
# To place a multi-asset bet, the pool must have token limits configured.
stellar contract invoke \
  --id $CONTRACT_ID --source $MY_KEY --network testnet \
  -- place_multi_asset_bet \
  --user $MY_ADDRESS \
  --pool_id 1 \
  --outcome 0 \
  --asset_address $USDC_ADDRESS \
  --amount 10000000
```

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


### `place_multi_asset_bet`

```rust
pub fn place_multi_asset_bet(
    env: Env, user: Address, pool_id: u32, outcome: u32, amount: i128, bet_token: Address, referrer: Option<Address>
) -> Result<(), ContractError>
```

## Settle

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

## Claim


### Multi-Asset Claim Example

```bash
# Claiming multi-asset winnings transfers the appropriate token to the user.
stellar contract invoke \
  --id $CONTRACT_ID --source $MY_KEY --network testnet \
  -- claim_multi_asset_winnings \
  --user $MY_ADDRESS \
  --pool_id 1 \
  --asset_address $USDC_ADDRESS
```

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

### Pool Templates

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


### `claim_multi_asset_winnings`

```rust
pub fn claim_multi_asset_winnings(env: Env, user: Address, pool_id: u32, asset_address: Address) -> Result<i128, ContractError>
```


## LP

### `stake_lp`

```rust
pub fn stake_lp(env: Env, user: Address, amount: i128) -> Result<(), ContractError>
```

### `unstake_lp`

```rust
pub fn unstake_lp(env: Env, user: Address, amount: i128) -> Result<(), ContractError>
```

### `set_lp_stake_boost`

```rust
pub fn set_lp_stake_boost(env: Env, caller: Address, boost: u32) -> Result<(), ContractError>
```

### `distribute_lp_rewards`

```rust
pub fn distribute_lp_rewards(env: Env, caller: Address, amount: i128) -> Result<(), ContractError>
```

### `set_lp_fee_allocation`

```rust
pub fn set_lp_fee_allocation(env: Env, caller: Address, fee_bps: u32) -> Result<(), ContractError>
```

### `deposit_liquidity`

```rust
pub fn deposit_liquidity(env: Env, user: Address, amount: i128) -> Result<(), ContractError>
```

### `withdraw_liquidity`

```rust
pub fn withdraw_liquidity(env: Env, user: Address, amount: i128) -> Result<(), ContractError>
```

### `claim_lp_rewards`

```rust
pub fn claim_lp_rewards(env: Env, user: Address) -> Result<i128, ContractError>
```

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


### `set_pool_token_bet_limits`

```rust
pub fn set_pool_token_bet_limits(env: Env, caller: Address, pool_id: u32, limits: Vec<(Address, i128)>) -> Result<(), ContractError>
```

### `set_token_exchange_rate`

```rust
pub fn set_token_exchange_rate(env: Env, caller: Address, token: Address, rate: i128) -> Result<(), ContractError>
```

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


| `get_lp_position` | `(user: Address) → LpPosition` | User LP info |
| `get_pending_lp_rewards` | `(user: Address) → i128` | Pending rewards |
| `get_total_lp_liquidity` | `() → i128` | Total LP liquidity |
| `get_total_lp_shares` | `() → i128` | Total LP shares |
| `get_lp_reward_config` | `() → LpRewardConfig` | LP reward config |
| `get_lp_stake` | `(user: Address) → i128` | LP stake amount |
| `get_templates` | `(start_id: u32, count: u32) → Vec<PoolTemplate>` | Get templates |
| `get_public_templates` | `(start_id: u32, count: u32) → Vec<PoolTemplate>` | Get public templates |
| `get_token_exchange_rate` | `(token: Address) → i128` | Get exchange rate |

## Lending Pool Security Modules

The standalone lending pool security surface lives under `stellar-lend/contracts/hello-world/src`
with matching off-chain services in `api/src/services` and `oracle/src/services`.

### `TwapOracle::compute_twap`

```rust
pub fn compute_twap(
    samples: Vec<OracleSample>,
    config: TwapConfig,
    now: u64,
) -> Result<TwapReading, OracleError>
```

Computes a liquidity-weighted TWAP from recent price samples. The guard rejects
non-positive prices, non-positive liquidity, stale samples, insufficient sample
counts, and windows shorter than `config.min_window_secs`.

### `TwapOracle::validate_spot_price`

```rust
pub fn validate_spot_price(
    spot_price: i128,
    twap_price: i128,
    max_deviation_bps: u32,
) -> Result<u32, OracleError>
```

Returns the spot/TWAP deviation in basis points, or rejects prices that exceed
the configured manipulation threshold.

### `InterestRateGuard::validate_update`

```rust
pub fn validate_update(
    previous: RateObservation,
    next: RateObservation,
    config: RateGuardConfig,
    now: u64,
) -> Result<(), RateGuardError>
```

Prevents rate manipulation by bounding absolute interest-rate movement,
utilization jumps, maximum APR, stale observations, and asset mismatches.

### `MevProtection::validate_operation`

```rust
pub fn validate_operation(
    operation: LendingOperation,
    quote: LendingQuote,
    config: MevGuardConfig,
    now: u64,
) -> Result<(), MevGuardError>
```

Blocks sandwich-prone lending operations when quotes are stale, the configured
order delay has not elapsed, liquidity is unavailable, price impact is too high,
or expected execution slippage exceeds user-safe bounds.

The TypeScript services expose the same policy concepts for API preflight:

| Service | File | Responsibility |
|---|---|---|
| `MevProtectionService` | `api/src/services/mev.service.ts` | Preflight lending operations for delay, stale quote, slippage, price impact, cooldown, and sandwich-pattern risk |
| `PriceAggregator` | `oracle/src/services/price-aggregator.ts` | Maintain samples and validate spot prices against liquidity-weighted TWAP |
| `PriceValidator` | `oracle/src/services/price-validator.ts` | Validate rate updates against absolute rate, delta, utilization, and freshness policies |

---

## Event Schema

All events follow the topic layout:

```
(Symbol(event_name), Symbol("v1"), ...identifiers)
```

Topic position 0 is the event name; position 1 is always the schema version marker `"v1"`.  
See `web/docs/CONTRACT_EVENTS.md` for the full per-event payload reference.

### Typed Event Convention (#[contractevent])

All event emission uses Soroban SDK ≥20 `#[contractevent]`-derived types (defined in
`contract_events` in `lib.rs`). Each event has:

1. A `#[event(name = "...")]` struct inside the `contract_events` module — the name
   matches the indexer-visible `topic[0]`.
2. An `emit_<snake_case_name>` helper function that constructs the struct and calls
   `.publish(env)` with the canonical topic layout.

**Adding a new event:**

```rust
// 1. Add to contract_events module
#[event(name = "my_new_event")]
pub struct MyNewEvent {
    pub pool_id: u32,
    // ...payload fields
}

// 2. Add emit helper
#[allow(deprecated)]
fn emit_my_new_event(env: &Env, pool_id: u32) {
    my_new_event(env, (pool_id,));
}
```

**Rules:**
- Never reuse an event `name` with a breaking topic/payload shape; bump
  `EVENT_SCHEMA_VERSION` to `"v2"` and add a parallel struct.
- Every event MUST carry `event_version` ("v1") at topic position 1 — the
  `emit_*` helpers guarantee this by delegating to the auto-generated function.

---

## Further Reading

- [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts)  
- [SEP-41 Token Interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)  
- `docs/CONTRACT_SPEC.md` — invariants and security model  
- `docs/CONTRACT_INPUT_VALIDATION.md` — validation rules per field  
- `docs/STORAGE_OPTIMIZATION.md` — storage key layout and rent management


## Additional Functions

The following functions are available in the contract API:

### `set_fee_config`

```rust
pub fn set_fee_config(env: Env, caller: Address, fee_rate: u32, fee_recipient: Address,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_fee_config`

```rust
pub fn get_fee_config(env: Env) -> (u32, Address)
```

**Auth:** TBD  
**Description:** TBD

---

### `get_volume_fee_tiers`

```rust
pub fn get_volume_fee_tiers(env: Env) -> Vec<FeeTier>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_circuit_breaker_config`

```rust
pub fn get_circuit_breaker_config(env: Env) -> CircuitBreakerConfig
```

**Auth:** TBD  
**Description:** TBD

---

### `set_rate_limit_config`

```rust
pub fn set_rate_limit_config(env: Env, caller: Address, max_bets_per_window: u32, window_secs: u64,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_rate_limit_config`

```rust
pub fn get_rate_limit_config(env: Env) -> RateLimitConfig
```

**Auth:** TBD  
**Description:** TBD

---

### `set_user_exposure_config`

```rust
pub fn set_user_exposure_config(env: Env, caller: Address, max_exposure_per_pool_bps: u32, max_bet_per_transaction: i128, daily_loss_limit: i128, daily_loss_window_secs: u64, weekly_loss_limit: i128, weekly_loss_window_secs: u64, large_bet_cooldown_secs: u64, large_bet_threshold: i128,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_exposure_config`

```rust
pub fn get_user_exposure_config(env: Env) -> UserExposureConfig
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_pool_exposure`

```rust
pub fn get_user_pool_exposure(env: Env, user: Address, pool_id: u32) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_daily_loss_status`

```rust
pub fn get_user_daily_loss_status(env: Env, user: Address) -> UserLossTrackingState
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_weekly_loss_status`

```rust
pub fn get_user_weekly_loss_status(env: Env, user: Address) -> UserLossTrackingState
```

**Auth:** TBD  
**Description:** TBD

---

### `create_pool_with_twap_period`

```rust
pub fn create_pool_with_twap_period(env: Env, creator: Address, title: String, description: String, outcome_a: String, outcome_b: String, duration: u64, twap_period_secs: u64,) -> Result<u32, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `create_multi_pool_with_twap`

```rust
pub fn create_multi_pool_with_twap(env: Env, creator: Address, title: String, description: String, outcomes: Vec<String>, duration: u64, metadata_uri: Option<String>, twap_period_secs: u64,) -> Result<u32, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `update_twap`

```rust
pub fn update_twap(env: Env, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_twap`

```rust
pub fn get_twap(env: Env, pool_id: u32, outcome: u32, period_secs: u64,) -> Result<i128, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_twap_period`

```rust
pub fn get_pool_twap_period(env: Env, pool_id: u32) -> Result<u64, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_min_settlement_participants`

```rust
pub fn set_min_settlement_participants(env: Env, caller: Address, min_participants: u32,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_min_settlement_participants`

```rust
pub fn get_min_settlement_participants(env: Env) -> u32
```

**Auth:** TBD  
**Description:** TBD

---

### `refund_expired_pool`

```rust
pub fn refund_expired_pool(env: Env, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `cancel_scheduled_claim`

```rust
pub fn cancel_scheduled_claim(env: Env, user: Address, scheduled_claim_id: u32,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_total_user_claims`

```rust
pub fn get_total_user_claims(env: Env, user: Address) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_claim_history`

```rust
pub fn get_user_claim_history(env: Env, user: Address, start_cursor: u32, limit: u32,) -> Vec<UserClaimEntry>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_treasury_recipient`

```rust
pub fn get_treasury_recipient(env: Env) -> Option<Address>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_treasury_withdraw_limit`

```rust
pub fn set_treasury_withdraw_limit(env: Env, caller: Address, max_withdrawal_per_window: i128, withdrawal_window_secs: u64,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_treasury_withdraw_limit`

```rust
pub fn get_treasury_withdraw_limit(env: Env) -> TreasuryWithdrawalRateLimitConfig
```

**Auth:** TBD  
**Description:** TBD

---

### `withdraw_treasury`

```rust
pub fn withdraw_treasury(env: Env, caller: Address, amount: i128) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_freeze_admin`

```rust
pub fn set_freeze_admin(env: Env, caller: Address, freeze_admin: Address,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_admin`

```rust
pub fn set_admin(env: Env, caller: Address, admin: Address) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_admin`

```rust
pub fn get_admin(env: Env) -> Option<Address>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_freeze_admin`

```rust
pub fn get_freeze_admin(env: Env) -> Option<Address>
```

**Auth:** TBD  
**Description:** TBD

---

### `freeze_pool`

```rust
pub fn freeze_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_dispute_window`

```rust
pub fn get_dispute_window(env: Env) -> u64
```

**Auth:** TBD  
**Description:** TBD

---

### `set_dispute_window`

```rust
pub fn set_dispute_window(env: Env, caller: Address, window_secs: u64,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `dispute_pool`

```rust
pub fn dispute_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `unfreeze_pool`

```rust
pub fn unfreeze_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `override_pool_cooling`

```rust
pub fn override_pool_cooling(env: Env, caller: Address, pool_id: u32,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_info`

```rust
pub fn get_pool_info(env: Env, pool_id: u32) -> Option<PoolInfo>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_leaderboard`

```rust
pub fn get_leaderboard(env: Env, pool_id: u32, limit: u32, cursor: Option<Address>,) -> Vec<PoolLeaderboardEntry>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_template_id`

```rust
pub fn get_pool_template_id(env: Env, pool_id: u32) -> Option<u32>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_bet_limits`

```rust
pub fn get_pool_bet_limits(env: Env, pool_id: u32) -> Option<PoolBetLimits>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_count`

```rust
pub fn get_pool_count(env: Env) -> u32
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pools_batch`

```rust
pub fn get_pools_batch(env: Env, start_id: u32, count: u32) -> Vec<Option<Pool>>
```

**Auth:** TBD  
**Description:** TBD

---

### `list_pools`

```rust
pub fn list_pools(env: Env, start: u32, limit: u32) -> Vec<Pool>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_outcomes`

```rust
pub fn get_pool_outcomes(env: Env, pool_id: u32) -> Vec<PoolOutcome>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_metadata`

```rust
pub fn get_pool_metadata(env: Env, pool_id: u32) -> Option<String>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_pool_metadata`

```rust
pub fn set_pool_metadata(env: Env, creator: Address, pool_id: u32, metadata_uri: Option<String>,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_ext_metadata`

```rust
pub fn get_pool_ext_metadata(env: Env, pool_id: u32) -> Option<PoolExtendedMetadata>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_pool_ext_metadata`

```rust
pub fn set_pool_ext_metadata(env: Env, creator: Address, pool_id: u32, metadata: PoolExtendedMetadata,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_pool_category`

```rust
pub fn set_pool_category(env: Env, caller: Address, pool_id: u32, category: PoolCategory,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_category`

```rust
pub fn get_pool_category(env: Env, pool_id: u32) -> Option<PoolCategory>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_pool_tags`

```rust
pub fn set_pool_tags(env: Env, caller: Address, pool_id: u32, tags: Vec<String>,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_tags`

```rust
pub fn get_pool_tags(env: Env, pool_id: u32) -> Vec<String>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_user_pools`

```rust
pub fn get_user_pools(env: Env, user: Address, start_id: u32, count: u32,) -> Vec<UserPoolPosition>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_paused`

```rust
pub fn set_paused(env: Env, caller: Address, paused: bool) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `pause_contract`

```rust
pub fn pause_contract(env: Env, caller: Address) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `unpause_contract`

```rust
pub fn unpause_contract(env: Env, caller: Address) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `is_paused`

```rust
pub fn is_paused(env: Env) -> bool
```

**Auth:** TBD  
**Description:** TBD

---

### `get_claim_status`

```rust
pub fn get_claim_status(env: Env, pool_id: u32, user: Address) -> ClaimStatus
```

**Auth:** TBD  
**Description:** TBD

---

### `preview_claimable_amount`

```rust
pub fn preview_claimable_amount(env: Env, pool_id: u32, user: Address) -> ClaimPreview
```

**Auth:** TBD  
**Description:** TBD

---

### `get_participant_count`

```rust
pub fn get_participant_count(env: Env, pool_id: u32) -> u32
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_volume`

```rust
pub fn get_pool_volume(env: Env, pool_id: u32) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `get_total_contract_volume`

```rust
pub fn get_total_contract_volume(env: Env) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `get_total_volume`

```rust
pub fn get_total_volume(env: Env) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `set_referral_bps`

```rust
pub fn set_referral_bps(env: Env, caller: Address, bps: u32) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_referral_bps`

```rust
pub fn get_referral_bps(env: Env) -> u32
```

**Auth:** TBD  
**Description:** TBD

---

### `place_bet_with_referral`

```rust
pub fn place_bet_with_referral(env: Env, user: Address, pool_id: u32, outcome: u32, amount: i128, referrer: Address,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `claim_referral_rewards`

```rust
pub fn claim_referral_rewards(env: Env, referrer: Address) -> Result<i128, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_referrer_balance`

```rust
pub fn get_referrer_balance(env: Env, referrer: Address) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `get_total_referral_volume`

```rust
pub fn get_total_referral_volume(env: Env) -> i128
```

**Auth:** TBD  
**Description:** TBD

---

### `register_webhook`

```rust
pub fn register_webhook(env: Env, caller: Address, url: String, event_types: Vec<WebhookEventType>,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `unregister_webhook`

```rust
pub fn unregister_webhook(env: Env, caller: Address, url: String) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_webhooks`

```rust
pub fn get_webhooks(env: Env) -> Vec<Webhook>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_allowed_tokens`

```rust
pub fn get_pool_allowed_tokens(env: Env, pool_id: u32) -> Option<Vec<Address>>
```

**Auth:** TBD  
**Description:** TBD

---

### `rescue_tokens`

```rust
pub fn rescue_tokens(env: Env, caller: Address, token: Address, to: Address, amount: i128,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `collect_multi_asset_fees`

```rust
pub fn collect_multi_asset_fees(env: Env, caller: Address, pool_id: u32,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_bridge_timeout`

```rust
pub fn set_bridge_timeout(env: Env, caller: Address, timeout_secs: u64,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `set_cross_chain_dispute_window`

```rust
pub fn set_cross_chain_dispute_window(env: Env, caller: Address, window_secs: u64,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `create_pool_mirror`

```rust
pub fn create_pool_mirror(env: Env, caller: Address, source_pool_id: u32, source_chain: ChainId, target_chain: ChainId, bridge_contract: Address,) -> Result<u32, ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `settle_mirror_from_source`

```rust
pub fn settle_mirror_from_source(env: Env, caller: Address, source_pool_id: u32, winning_outcome: u32,) -> Result<(), ContractError>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_pool_mirror`

```rust
pub fn get_pool_mirror(env: Env, source_pool_id: u32) -> Option<PoolMirrorConfig>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_mirror_by_unified_id`

```rust
pub fn get_mirror_by_unified_id(env: Env, unified_id: u32) -> Option<PoolMirrorConfig>
```

**Auth:** TBD  
**Description:** TBD

---

### `get_bridge_timeout`

```rust
pub fn get_bridge_timeout(env: Env) -> u64
```

**Auth:** TBD  
**Description:** TBD

---

### `get_cross_chain_dispute_window`

```rust
pub fn get_cross_chain_dispute_window(env: Env) -> u64
```

**Auth:** TBD  
**Description:** TBD

---

