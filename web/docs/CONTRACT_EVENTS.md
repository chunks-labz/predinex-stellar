# Predinex Contract Event Schema

This document describes all events emitted by the Predinex Soroban smart contract for off-chain indexing, monitoring, and integration.

## Overview

The contract emits **47 typed events** across multiple categories. All events follow a structured schema:

- **Topic Position 0:** Event name (Symbol)
- **Topic Position 1:** Schema version marker (Symbol = `"v1"`) — *except 4 legacy events*
- **Subsequent Topics:** Pool IDs, user addresses, or other identifiers for efficient filtering
- **Data Arguments:** Typed event payload with full context

### Event Schema Versioning

Each event uses `event_version()` which returns `Symbol("v1")` as the canonical schema version. This allows indexers and integrators to:
- Pin to a specific schema version with positional topic filters: `[["event_name", "v1"]]`
- Safely reject events with unknown versions rather than silently mis-decoding payloads
- Upgrade incrementally as the schema evolves

**Upgrade Rules:**
- **Backward-compatible payload extension:** Reuse the same version marker (`v1`), existing consumers continue to work
- **Breaking changes:** Bump the version marker (e.g., `v2`), update documentation, migrate integrations
- **Never emit two version markers** for the same event in the same release

---

## Events by Category



## Pool Management Events

### create_pool
Emitted when a new pool is created.

- **Topics:** `(Symbol("create_pool"), pool_id: u32)` — *Note: No event_version() topic*
- **Data:** `CreatePoolEvent`
  - `creator: Address` — Pool creator
  - `expiry: u64` — Unix timestamp when the pool closes for new bets
  - `title: String` — Pool question (max 100 bytes)
  - `outcome_a_name: String` — First outcome label (max 50 bytes)
  - `outcome_b_name: String` — Second outcome label (max 50 bytes)
- **Indexer Use:** Track all pools created, build market directory, calculate pool creation trends

### pool_scheduled
Emitted when a pool is scheduled to open at a future timestamp.

- **Topics:** `(Symbol("pool_scheduled"), event_version(), pool_id: u32)`
- **Data:** `(creator: Address, open_at: u64)`
  - `creator: Address` — Pool creator
  - `open_at: u64` — Unix timestamp when the pool will transition to Open status
- **Indexer Use:** Track scheduled pools, set up calendar alerts

### scheduled_pool_activated
Emitted when a scheduled pool transitions to Open and accepts bets.

- **Topics:** `(Symbol("scheduled_pool_activated"), event_version(), pool_id: u32)`
- **Data:** `open_at: u64`
- **Indexer Use:** Update pool status in real-time, notify subscribers

### scheduled_pool_cancelled
Emitted when a scheduled pool is cancelled before activation.

- **Topics:** `(Symbol("scheduled_pool_cancelled"), event_version(), pool_id: u32)`
- **Data:** `creator: Address`
- **Indexer Use:** Mark pool as cancelled

### cancel_pool
Emitted when a pool creator cancels a pool before any bets are placed.

- **Topics:** `(Symbol("cancel_pool"), event_version(), pool_id: u32)`
- **Data:** `creator: Address`
- **Indexer Use:** Track cancelled pools

### pool_duration_extended
Emitted when a pool's expiry timestamp is extended.

- **Topics:** `(Symbol("pool_duration_extended"), event_version(), pool_id: u32)`
- **Data:** `PoolDurationExtendedEvent`
  - `creator: Address`
  - `new_expiry: u64` — Updated Unix timestamp
- **Indexer Use:** Update countdown timers

---

## Betting Events

### place_bet
Emitted when a user places a bet on a pool outcome.

- **Topics:** `(Symbol("place_bet"), event_version(), pool_id: u32, user: Address)`
- **Data:** `BetEvent`
  - `outcome: u32` — Outcome index (0 = outcome_a, 1 = outcome_b)
  - `amount: i128` — Bet amount in stroops
  - `total_yes: i128` — Pool total for outcome A after bet
  - `total_no: i128` — Pool total for outcome B after bet
- **Indexer Use:** Track real-time betting activity, update odds, monitor volume

### referral_bet
Emitted alongside `place_bet` when a referrer is specified.

- **Topics:** `(Symbol("referral_bet"), event_version(), pool_id: u32)`
- **Data:** `ReferralBetEvent`
  - `referrer: Address` — Account receiving referral commission
  - `pool_id: u32`
  - `outcome: u32`
  - `amount: i128`
- **Indexer Use:** Track referral commissions

### bet_cancelled
Emitted when a user cancels part or all of their bet.

- **Topics:** `(Symbol("bet_cancelled"), event_version(), pool_id: u32, user: Address)`
- **Data:** `BetCancelledEvent`
  - `user: Address`
  - `pool_id: u32`
  - `outcome: u32`
  - `amount: i128`
- **Indexer Use:** Update user positions, recalculate pool totals

### pool_cooling_started
Emitted when a pool automatically enters cooling period due to circuit breaker.

- **Topics:** `(Symbol("pool_cooling_started"), event_version(), pool_id: u32)`
- **Data:** `(cooling_until: u64, new_total: i128)`
  - `cooling_until: u64` — Unix timestamp when cooling expires
  - `new_total: i128` — Pool total that triggered threshold
- **Indexer Use:** Alert users to cooling period

### twap_updated
Emitted when time-weighted average prices (TWAP) are recorded.

- **Topics:** `(Symbol("twap_updated"), event_version(), pool_id: u32)`
- **Data:** `TwapUpdatedEvent`
  - `timestamp: u64` — Unix timestamp of snapshot
  - `odds: Vec<i128>` — Odds in basis points for each outcome (10000 = 100%)
- **Indexer Use:** Track historical odds, feed analytics

---

## Settlement & Claiming Events

### settle_pool
Emitted when a pool is settled with a winning outcome.

- **Topics:** `(Symbol("settle_pool"), event_version(), pool_id: u32)`
- **Data:** `SettlePoolEvent`
  - `caller: Address` — Account that triggered settlement
  - `winning_outcome: u32` — Outcome index that won
  - `winning_side_total: i128` — Total amount bet on winning outcome
  - `total_pool_volume: i128` — Total of both outcomes
  - `fee_amount: i128` — Protocol fee deducted
  - `source: SettlementSource` — Creator or Operator
- **Indexer Use:** Finalize pool state, calculate payouts, calculate fees

### claim_winnings
Emitted when a user claims winnings from a settled pool.

- **Topics:** `(Symbol("claim_winnings"), pool_id: u32, user: Address)` — *Note: No event_version() topic*
- **Data:** `ClaimEvent`
  - `amount: i128` — Payout amount
  - `fee_amount: i128` — Fee deducted
  - `winning_outcome: u32`
  - `total_pool_size: i128`
- **Indexer Use:** Track payout distribution, verify claim completeness

### claim_refund
Emitted when a user claims refund from a voided or cancelled pool.

- **Topics:** `(Symbol("claim_refund"), event_version(), pool_id: u32, user: Address)`
- **Data:** `refund: i128`
- **Indexer Use:** Track refunds

### claim_expired
Emitted when a user claims refund from an expired, unsettled pool.

- **Topics:** `(Symbol("claim_expired"), event_version(), pool_id: u32, user: Address)`
- **Data:** `refund: i128`
- **Indexer Use:** Identify unresolved pools

### claim_scheduled
Emitted when a user schedules a future claim.

- **Topics:** `(Symbol("claim_scheduled"), event_version(), pool_id: u32, user: Address)`
- **Data:** `(id: u32, claim_at: u64)`
  - `id: u32` — Scheduled claim ID
  - `claim_at: u64` — Unix timestamp for execution
- **Indexer Use:** Track future claims

### scheduled_claim_cancelled
Emitted when a scheduled claim is cancelled.

- **Topics:** `(Symbol("scheduled_claim_cancelled"), event_version(), pool_id: u32, user: Address)`
- **Data:** `scheduled_claim_id: u32`
- **Indexer Use:** Update claim status

### scheduled_claim_executed
Emitted when a scheduled claim is executed.

- **Topics:** `(Symbol("scheduled_claim_executed"), event_version(), pool_id: u32, user: Address)`
- **Data:** `(id: u32, amount: i128)`
- **Indexer Use:** Verify claim completion

---

## Pool State Management Events

### void_pool
Emitted when a pool is marked as voided (allowing full refunds).

- **Topics:** `(Symbol("void_pool"), event_version(), pool_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Mark pool as voided, trigger refund eligibility

### pool_frozen
Emitted when a pool is frozen by freeze admin.

- **Topics:** `(Symbol("pool_frozen"), event_version(), pool_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Lock pool state, display frozen status

### pool_disputed
Emitted when a settled pool is disputed.

- **Topics:** `(Symbol("pool_disputed"), event_version(), pool_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Flag pool as disputed, suspend claims

### pool_unfrozen
Emitted when a frozen or disputed pool is unfrozen.

- **Topics:** `(Symbol("pool_unfrozen"), event_version(), pool_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Update pool state, resume claims

### pool_cooling_overridden
Emitted when treasury admin overrides cooling lock.

- **Topics:** `(Symbol("pool_cooling_overridden"), event_version(), pool_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Update cooling status

### pool_metadata_set
Emitted when pool metadata URI is set.

- **Topics:** `(Symbol("pool_metadata_set"), event_version(), pool_id: u32)`
- **Data:** `uri: String` — Metadata URI (max 256 bytes)
- **Indexer Use:** Associate off-chain metadata

### pool_metadata_cleared
Emitted when pool metadata URI is removed.

- **Topics:** `(Symbol("pool_metadata_cleared"), event_version(), pool_id: u32)`
- **Data:** `creator: Address`
- **Indexer Use:** Remove associated metadata

---

## Pool Template Events

### pool_template_created
Emitted when a user creates a pool template.

- **Topics:** `(Symbol("pool_template_created"), event_version(), template_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Track templates, enable discovery

### pool_template_updated
Emitted when a pool template is updated.

- **Topics:** `(Symbol("pool_template_updated"), event_version(), template_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Update template metadata

### pool_template_deleted
Emitted when a pool template is deleted.

- **Topics:** `(Symbol("pool_template_deleted"), event_version(), template_id: u32)`
- **Data:** `caller: Address`
- **Indexer Use:** Remove from discovery

### pool_created_from_template
Emitted when a pool is created using a template.

- **Topics:** `(Symbol("pool_created_from_template"), event_version(), template_id: u32, pool_id: u32)`
- **Data:** `()` (empty)
- **Indexer Use:** Link pools to template source

---

## Configuration Events

### creation_fee_exemption_set
Emitted when per-address creation fee exemption is granted/revoked.

- **Topics:** `(Symbol("creation_fee_exemption_set"), event_version())`
- **Data:** `(account: Address, exempt: bool)`
- **Indexer Use:** Track exemption status

### protocol_fee_set
Emitted when protocol fee in basis points is updated.

- **Topics:** `(Symbol("protocol_fee_set"))` — *Note: No event_version() topic*
- **Data:** `(caller: Address, fee_bps: u32)`
  - `fee_bps: u32` — Fee in basis points (10000 = 100%)
- **Indexer Use:** Update fee display, recalculate fees

### fee_tiers_updated
Emitted when volume-based protocol fee tiers are configured.

- **Topics:** `(Symbol("fee_tiers_updated"), event_version())`
- **Data:** `tiers_count: u32` — Number of tiers active (0 = cleared)
- **Indexer Use:** Update fee lookup tables

### pool_bet_limits_set
Emitted when per-pool bet limits are configured.

- **Topics:** `(Symbol("pool_bet_limits_set"), event_version(), pool_id: u32)`
- **Data:** `(min_bet: i128, max_bet: i128)` in stroops
- **Indexer Use:** Display bet limits, validate client-side

### circuit_breaker_config_set
Emitted when circuit breaker configuration is updated.

- **Topics:** `(Symbol("circuit_breaker_config_set"), event_version())`
- **Data:** `(max_pool_size: i128, large_pool_threshold: i128, cooling_period_secs: u64)`
- **Indexer Use:** Update cooling logic

### rate_limit_config_set
Emitted when per-wallet rate limiting is configured.

- **Topics:** `(Symbol("rate_limit_config_set"), event_version())`
- **Data:** `(max_bets_per_window: u32, window_secs: u64)`
- **Indexer Use:** Implement client-side rate limit UI

### min_settlement_participants_set
Emitted when minimum participant threshold is configured.

- **Topics:** `(Symbol("min_settlement_participants_set"), event_version())`
- **Data:** `min_participants: u32`
- **Indexer Use:** Update settlement eligibility checks

### assign_settler
Emitted when delegated settler is assigned to pool.

- **Topics:** `(Symbol("assign_settler"), event_version(), pool_id: u32)`
- **Data:** `(creator: Address, settler: Address)`
- **Indexer Use:** Track settlement permissions

---

## Treasury Events

### treasury_withdraw_limit_set
Emitted when treasury withdrawal rate limit is configured.

- **Topics:** `(Symbol("treasury_withdraw_limit_set"), event_version())`
- **Data:** `(max_withdrawal_per_window: i128, withdrawal_window_secs: u64)`
- **Indexer Use:** Monitor treasury security limits

### treasury_withdrawn
Emitted when funds are withdrawn from treasury.

- **Topics:** `(Symbol("treasury_withdrawn"), event_version())`
- **Data:** `(caller: Address, treasury_recipient: Address, amount: i128)`
- **Indexer Use:** Track treasury flows

### treasury_recipient_rotated
Emitted when treasury recipient address is rotated.

- **Topics:** `(Symbol("treasury_recipient_rotated"), event_version())`
- **Data:** `(current_recipient: Address, new_recipient: Address)`
- **Indexer Use:** Update treasury account mappings

### freeze_admin_set
Emitted when freeze admin address is set.

- **Topics:** `(Symbol("freeze_admin_set"), event_version())`
- **Data:** `freeze_admin: Address`
- **Indexer Use:** Track admin roles

---

## Contract Control Events

### contract_paused
Emitted when the contract is paused.

- **Topics:** `(Symbol("contract_paused"))` — *Note: No event_version() topic*
- **Data:** `caller: Address`
- **Indexer Use:** Alert users to maintenance

### contract_unpaused
Emitted when the contract is unpaused.

- **Topics:** `(Symbol("contract_unpaused"))` — *Note: No event_version() topic*
- **Data:** `caller: Address`
- **Indexer Use:** Notify users operations are live

### PoolPaused (Deprecated)
Alternative pause event (has event_version() unlike contract_paused).

- **Topics:** `(Symbol("PoolPaused"), event_version())`
- **Data:** `caller: Address`
- **Note:** Use `contract_paused` instead for consistency

### PoolUnpaused (Deprecated)
Alternative unpause event.

- **Topics:** `(Symbol("PoolUnpaused"), event_version())`
- **Data:** `caller: Address`
- **Note:** Use `contract_unpaused` instead for consistency

---

## Webhook Events

### webhook_registered
Emitted when a webhook is registered or updated.

- **Topics:** `(Symbol("webhook_registered"), event_version())`
- **Data:** `(url: String, event_types_count: u32)`
- **Indexer Use:** Track webhook registrations

### webhook_unregistered
Emitted when a webhook is unregistered.

- **Topics:** `(Symbol("webhook_unregistered"), event_version())`
- **Data:** `url: String`
- **Indexer Use:** Clean up webhook subscriptions

---

## Integration Guide

### For Indexers
1. **Subscribe to event topics:** Use Stellar RPC's `subscribeToEvents` with topic filters
   ```javascript
   // Listen for all place_bet events
   subscribe([["place_bet", "v1"]])
   
   // Listen for all events on pool 42
   subscribe([[], [], [42]])
   ```

2. **Decode event data:** Use the contract ABI to deserialize typed payloads
3. **Handle schema versions:** Check topic[1] for version marker before decoding
4. **Handle 4 legacy events:** `create_pool`, `claim_winnings`, `protocol_fee_set`, `contract_paused`/`unpaused` don't include `event_version()` — treat as `v1`

### For Monitoring
Track these key metrics:
- **Active pools:** `create_pool` - `settle_pool` - `cancel_pool` - `void_pool`
- **24h volume:** Sum of `place_bet.amount` in last 86400 seconds
- **Settlement lag:** `settle_pool` timestamp - pool expiry
- **Claim coverage:** Compare `claim_winnings` total to settlement payout
- **Fee revenue:** Sum of `fee_amount` across all `settle_pool` events

### For Real-Time Dashboards
High-volume events to subscribe to:
- `place_bet` — Update odds, liquidity, volume in real-time
- `claim_winnings` — Update payout progress
- `settle_pool` — Finalize pool state

Lower-volume operational events (batch daily):
- Template events
- Configuration events

---

## Known Issues

1. **Event Schema Inconsistencies:** Four events (`create_pool`, `claim_winnings`, `protocol_fee_set`, `contract_paused`/`contract_unpaused`) do not include `event_version()` for backward compatibility. Future major release should standardize.

2. **Duplicate Pause Events:** `PoolPaused`/`PoolUnpaused` and `contract_paused`/`contract_unpaused` are redundant. Deprecate the former in favor of latter.

3. **Webhook URL Logging:** The `webhook_registered` and `webhook_unregistered` events currently emit URL strings which may be logged publicly. Future versions should emit webhook ID hash instead.

---

## Changelog

### v1 (Current)
- 47 events across 8 categories
- Schema versioning with positional topic filters
- 4 legacy events without version marker for backward compatibility
- Full typed event payloads for indexer reliability

