//! Unified event emission module for the Predinex contract.
//!
//! This module consolidates all event definitions and provides a standardized
//! emission pattern with schema versioning support. All events use the same
//! topic layout: (event_name, schema_version, ...identifiers).
//!
//! # Schema Versioning
//!
//! Every event uses topic position 0 for the event name and topic position 1
//! for the schema version marker (currently "v1"). This allows indexers to:
//! - Pin specific schema versions via topic filters
//! - Reject events with unknown versions instead of mis-decoding payloads
//! - Handle backward-compatible changes gracefully
//!
//! # Upgrade Rules
//!
//! - Backward-compatible extensions (optional fields) → keep same version
//! - Breaking changes to topics or data shape → bump version (e.g., "v2")
//! - Never emit two versions for the same event in one release
//!
//! See `web/docs/CONTRACT_EVENTS.md` for detailed schema documentation.

use soroban_sdk::{contracttype, Address, Env, String, Symbol, Vec};

/// Event schema version used for all emitted events.
/// Bumped when any event payload undergoes a breaking change.
pub const EVENT_SCHEMA_VERSION: &str = "v1";

/// Contract state schema version for on-chain compatibility checks.
/// Bumped whenever persistent state layout changes incompatibly.
pub const CONTRACT_STATE_VERSION: &str = "v1";

/// Build the schema-version Symbol used as topic position 1 on every event.
#[inline]
pub fn event_version(env: &Env) -> Symbol {
    Symbol::new(env, EVENT_SCHEMA_VERSION)
}

// ============================================================================
// Pool Lifecycle Events
// ============================================================================

/// Event emitted when a new pool is created.
///
/// Topics: (Symbol("create_pool"), version, pool_id)
/// Data: CreatePoolEvent
#[derive(Clone)]
#[contracttype]
pub struct CreatePoolEvent {
    pub creator: Address,
    pub expiry: u64,
    pub title: String,
    pub outcome_a_name: String,
    pub outcome_b_name: String,
}

impl CreatePoolEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (Symbol::new(env, "create_pool"), event_version(env), pool_id),
            data,
        );
    }
}

/// Event emitted when a pool is settled with a winning outcome.
///
/// Topics: (Symbol("settle_pool"), version, pool_id)
/// Data: SettlePoolEvent
#[derive(Clone)]
#[contracttype]
pub struct SettlePoolEvent {
    pub caller: Address,
    pub winning_outcome: u32,
    pub winning_side_total: i128,
    pub total_pool_volume: i128,
    pub fee_amount: i128,
    pub source: SettlementSource,
}

impl SettlePoolEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (Symbol::new(env, "settle_pool"), event_version(env), pool_id),
            data,
        );
    }
}

/// Event emitted when an expired pool is settled.
///
/// Topics: (Symbol("settle_expired"), version, pool_id)
/// Data: SettleExpiredEvent
#[derive(Clone)]
#[contracttype]
pub struct SettleExpiredEvent {
    pub caller: Address,
    pub winning_outcome: u32,
    pub winning_side_total: i128,
    pub total_pool_volume: i128,
    pub fee_amount: i128,
}

impl SettleExpiredEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "settle_expired"),
                event_version(env),
                pool_id,
            ),
            data,
        );
    }
}

/// Event emitted when a pool is voided.
///
/// Topics: (Symbol("void_pool"), version, pool_id)
/// Data: Address (caller)
#[derive(Clone)]
#[contracttype]
pub struct VoidPoolEvent {
    pub caller: Address,
}

impl VoidPoolEvent {
    pub fn emit(env: &Env, pool_id: u32, caller: Address) {
        env.events().publish(
            (Symbol::new(env, "void_pool"), event_version(env), pool_id),
            caller,
        );
    }
}

/// Event emitted when a pool is cancelled.
///
/// Topics: (Symbol("cancel_pool"), version, pool_id)
/// Data: PoolCancelledEvent
#[derive(Clone)]
#[contracttype]
pub struct PoolCancelledEvent {
    pub cancelled_by: Address,
    pub reason: String,
    pub total_refunded: i128,
    pub participant_count: u32,
}

impl PoolCancelledEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (Symbol::new(env, "cancel_pool"), event_version(env), pool_id),
            data,
        );
    }
}

/// Event emitted when a pool's duration is extended.
///
/// Topics: (Symbol("pool_duration_extended"), version, pool_id)
/// Data: PoolDurationExtendedEvent
#[derive(Clone)]
#[contracttype]
pub struct PoolDurationExtendedEvent {
    pub creator: Address,
    pub new_expiry: u64,
}

impl PoolDurationExtendedEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "pool_duration_extended"),
                event_version(env),
                pool_id,
            ),
            data,
        );
    }
}

/// Event emitted when an expired pool is refunded.
///
/// Topics: (Symbol("refund_expired_pool"), version, pool_id)
/// Data: PoolRefundedEvent
#[derive(Clone)]
#[contracttype]
pub struct PoolRefundedEvent {
    pub total_refunded: i128,
}

impl PoolRefundedEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "refund_expired_pool"),
                event_version(env),
                pool_id,
            ),
            data,
        );
    }
}

// ============================================================================
// Betting Events
// ============================================================================

/// Event emitted when a bet is placed.
///
/// Topics: (Symbol("place_bet"), version, user, pool_id)
/// Data: BetEvent
#[derive(Clone)]
#[contracttype]
pub struct BetEvent {
    pub outcome: u32,
    pub amount: i128,
    pub total_yes: i128,
    pub total_no: i128,
}

impl BetEvent {
    pub fn emit(env: &Env, user: &Address, pool_id: u32, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "place_bet"),
                event_version(env),
                user,
                pool_id,
            ),
            data,
        );
    }
}

/// Event emitted when a bet is cancelled (full or partial).
///
/// Topics: (Symbol("bet_cancelled"), version, user, pool_id)
/// Data: BetCancelledEvent
#[derive(Clone)]
#[contracttype]
pub struct BetCancelledEvent {
    pub user: Address,
    pub pool_id: u32,
    pub outcome: u32,
    pub amount: i128,
}

impl BetCancelledEvent {
    pub fn emit(env: &Env, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "bet_cancelled"),
                event_version(env),
                &data.user,
                data.pool_id,
            ),
            data,
        );
    }
}

// ============================================================================
// Claim Events
// ============================================================================

/// Event emitted when winnings are claimed.
///
/// Topics: (Symbol("claim_winnings"), version, pool_id, claimant)
/// Data: ClaimEvent
#[derive(Clone)]
#[contracttype]
pub struct ClaimEvent {
    pub amount: i128,
    pub fee_amount: i128,
    pub winning_outcome: u32,
    pub total_pool_size: i128,
}

impl ClaimEvent {
    pub fn emit(env: &Env, pool_id: u32, claimant: &Address, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "claim_winnings"),
                event_version(env),
                pool_id,
                claimant,
            ),
            data,
        );
    }
}

/// Event emitted when a refund is claimed from a voided pool.
///
/// Topics: (Symbol("claim_refund"), version, pool_id, user)
/// Data: i128 (refund amount)
#[derive(Clone)]
#[contracttype]
pub struct ClaimRefundEvent {
    pub amount: i128,
}

impl ClaimRefundEvent {
    pub fn emit(env: &Env, pool_id: u32, user: &Address, amount: i128) {
        env.events().publish(
            (
                Symbol::new(env, "claim_refund"),
                event_version(env),
                pool_id,
                user,
            ),
            amount,
        );
    }
}

/// Event emitted when an expired pool claim is processed.
///
/// Topics: (Symbol("claim_expired"), version, pool_id, user)
/// Data: i128 (refund amount)
#[derive(Clone)]
#[contracttype]
pub struct ClaimExpiredEvent {
    pub amount: i128,
}

impl ClaimExpiredEvent {
    pub fn emit(env: &Env, pool_id: u32, user: &Address, amount: i128) {
        env.events().publish(
            (
                Symbol::new(env, "claim_expired"),
                event_version(env),
                pool_id,
                user,
            ),
            amount,
        );
    }
}

// ============================================================================
// Referral Events
// ============================================================================

/// Event emitted when a referral bet is placed.
///
/// Topics: (Symbol("referral_bet"), version, referrer, pool_id)
/// Data: ReferralBetEvent
#[derive(Clone)]
#[contracttype]
pub struct ReferralBetEvent {
    pub referrer: Address,
    pub pool_id: u32,
    pub outcome: u32,
    pub amount: i128,
}

impl ReferralBetEvent {
    pub fn emit(env: &Env, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "referral_bet"),
                event_version(env),
                &data.referrer,
                data.pool_id,
            ),
            data,
        );
    }
}

/// Event emitted when referral rewards are claimed.
///
/// Topics: (Symbol("referral_reward_claimed"), version, referrer)
/// Data: ReferralRewardClaimedEvent
#[derive(Clone)]
#[contracttype]
pub struct ReferralRewardClaimedEvent {
    pub referrer: Address,
    pub amount: i128,
}

impl ReferralRewardClaimedEvent {
    pub fn emit(env: &Env, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "referral_reward_claimed"),
                event_version(env),
                &data.referrer,
            ),
            data,
        );
    }
}

// ============================================================================
// Admin / Configuration Events
// ============================================================================

/// Event emitted when fee configuration is updated.
///
/// Topics: (Symbol("fee_config_updated"), version)
/// Data: (fee_rate: u32, fee_recipient: Address)
#[derive(Clone)]
#[contracttype]
pub struct FeeConfigUpdatedEvent {
    pub fee_rate: u32,
    pub fee_recipient: Address,
}

impl FeeConfigUpdatedEvent {
    pub fn emit(env: &Env, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "fee_config_updated"),
                event_version(env),
            ),
            data,
        );
    }
}

/// Event emitted when the protocol fee is set.
///
/// Topics: (Symbol("protocol_fee_set"), version)
/// Data: (caller: Address, old_fee_bps: u32, new_fee_bps: u32)
#[derive(Clone)]
#[contracttype]
pub struct ProtocolFeeSetEvent {
    pub caller: Address,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
}

impl ProtocolFeeSetEvent {
    pub fn emit(env: &Env, data: Self) {
        env.events().publish(
            (Symbol::new(env, "protocol_fee_set"), event_version(env)),
            data,
        );
    }
}

/// Event emitted when pool bet limits are configured.
///
/// Topics: (Symbol("pool_bet_limits_set"), version, pool_id)
/// Data: (min_bet: i128, max_bet: i128)
#[derive(Clone)]
#[contracttype]
pub struct PoolBetLimitsSetEvent {
    pub min_bet: i128,
    pub max_bet: i128,
}

impl PoolBetLimitsSetEvent {
    pub fn emit(env: &Env, pool_id: u32, data: Self) {
        env.events().publish(
            (
                Symbol::new(env, "pool_bet_limits_set"),
                event_version(env),
                pool_id,
            ),
            data,
        );
    }
}

// ============================================================================
// Supporting Types (used by events but not themselves events)
// ============================================================================

/// Indicates who triggered a pool settlement.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum SettlementSource {
    /// Pool creator settled the pool.
    Creator = 0,
    /// Delegated operator or admin settled the pool.
    Operator = 1,
}

/// Result of a single pool settlement in a batch call.
#[derive(Clone)]
#[contracttype]
pub struct SettleResult {
    pub pool_id: u32,
    pub success: bool,
}

/// Settlement request for a single pool in batch settlement.
#[derive(Clone)]
#[contracttype]
pub struct PoolSettleRequest {
    pub pool_id: u32,
    pub winning_outcome: u32,
}
