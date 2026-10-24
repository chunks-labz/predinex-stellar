//! # Structured Audit Log — Issue #1463
//!
//! Every administrative action appends exactly one [`AuditRecord`] to a
//! contract-wide append-only log stored in persistent storage.  Records are
//! never mutated or deleted in place.  A monotonic sequence counter
//! (`AuditSeq`) drives both record addressing and cursor-based pagination.
//!
//! ## Storage layout
//!
//! | Key | Type | Notes |
//! |-----|------|-------|
//! | `DataKey::AuditSeq` | `u64` | Next-to-write sequence number (starts at 0) |
//! | `DataKey::AuditRecord(seq)` | `AuditRecord` | One record per admin action |
//!
//! ## Redaction
//!
//! Values that could contain secrets or PII are replaced with
//! `"[REDACTED]"` before the record is stored.  The redacted fields are:
//! - `RegisterWebhook` / `UnregisterWebhook`: the URL may embed auth tokens
//!   in the path; it is replaced with `"[REDACTED]"`.
//! - `RotateTreasuryRecipient`: both addresses are public on-chain actors
//!   and are **not** redacted.
//! - No other field currently requires redaction, but the
//!   `AdminActionDetail::Redacted` variant provides a forward-compatible
//!   escape hatch.
//!
//! ## Soroban contracttype constraints
//!
//! `#[contracttype]` on an enum requires **tuple variants** (no named fields
//! inside the variant itself).  Each variant's data is therefore held in a
//! dedicated `#[contracttype]` struct.  Unit variants (no data) are allowed
//! directly.
//!
//! ## Query
//!
//! `get_audit_log(env, cursor, limit)` returns up to `limit` records
//! starting at absolute sequence `cursor`.  `cursor = 0` returns from the
//! beginning; pass the last returned `seq + 1` for the next page.
//! Maximum page size is 50 records to bound instruction budget.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::{DataKey, POOL_BUMP_TARGET, POOL_BUMP_THRESHOLD};

// ============================================================================
// Constants
// ============================================================================

/// Maximum records returned by a single `get_audit_log` call.
pub const AUDIT_LOG_PAGE_MAX: u64 = 50;

/// Placeholder used when a value is redacted.
const REDACTED: &str = "[REDACTED]";

// ============================================================================
// Per-action detail structs
// ============================================================================

/// Contract initialized for the first time.
#[derive(Clone)]
#[contracttype]
pub struct AuditInitialize {
    pub token: Address,
    pub treasury_recipient: Address,
    pub admin: Address,
}

/// Bet fee rate and recipient updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetFeeConfig {
    pub old_fee_rate: u32,
    pub new_fee_rate: u32,
    pub fee_recipient: Address,
}

/// Pool creation fee updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetCreationFee {
    pub before: i128,
    pub after: i128,
}

/// Pool creation-fee exemption flag toggled for an account.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetCreationFeeExemption {
    pub account: Address,
    pub exempt: bool,
}

/// Protocol fee (basis points) updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetProtocolFee {
    pub before: u32,
    pub after: u32,
}

/// Volume-based fee tiers replaced (tier count recorded).
#[derive(Clone)]
#[contracttype]
pub struct AuditSetVolumeFeeTiers {
    pub tier_count: u32,
}

/// Per-pool bet limits updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolBetLimits {
    pub pool_id: u32,
    pub old_min: i128,
    pub old_max: i128,
    pub new_min: i128,
    pub new_max: i128,
}

/// Circuit-breaker config updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetCircuitBreakerConfig {
    pub max_pool_size: i128,
    pub large_pool_threshold: i128,
    pub cooling_period_secs: u64,
}

/// Rate-limit config updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetRateLimitConfig {
    pub max_bets_per_window: u32,
    pub window_secs: u64,
}

/// User-exposure config updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetUserExposureConfig {
    pub max_exposure_per_pool_bps: u32,
    pub max_bet_per_tx: i128,
    pub daily_loss_limit: i128,
    pub weekly_loss_limit: i128,
}

/// Minimum settlement participant count updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetMinSettlementParticipants {
    pub before: u32,
    pub after: u32,
}

/// Pool voided by its creator.
#[derive(Clone)]
#[contracttype]
pub struct AuditVoidPool {
    pub pool_id: u32,
}

/// Treasury withdrawal rate limit updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetTreasuryWithdrawLimit {
    pub before_max: i128,
    pub before_window_secs: u64,
    pub after_max: i128,
    pub after_window_secs: u64,
}

/// Treasury recipient address rotated.
#[derive(Clone)]
#[contracttype]
pub struct AuditRotateTreasuryRecipient {
    pub old_recipient: Address,
    pub new_recipient: Address,
}

/// Tokens withdrawn from treasury.
#[derive(Clone)]
#[contracttype]
pub struct AuditWithdrawTreasury {
    pub amount: i128,
}

/// Freeze-admin address updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetFreezeAdmin {
    pub old_freeze_admin: Option<Address>,
    pub new_freeze_admin: Address,
}

/// Contract admin address updated directly.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetAdmin {
    pub old_admin: Option<Address>,
    pub new_admin: Address,
}

/// New admin address staged for two-step transfer.
#[derive(Clone)]
#[contracttype]
pub struct AuditProposeAdmin {
    pub proposed: Address,
}

/// Pending admin transfer accepted; caller became admin.
#[derive(Clone)]
#[contracttype]
pub struct AuditAcceptAdmin {
    pub old_admin: Option<Address>,
    pub new_admin: Address,
}

/// Pool frozen by freeze admin.
#[derive(Clone)]
#[contracttype]
pub struct AuditFreezePool {
    pub pool_id: u32,
}

/// Pool unfrozen by freeze admin.
#[derive(Clone)]
#[contracttype]
pub struct AuditUnfreezePool {
    pub pool_id: u32,
}

/// Contract-wide dispute window updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetDisputeWindow {
    pub before: u64,
    pub after: u64,
}

/// Pool disputed (resolution challenged).
#[derive(Clone)]
#[contracttype]
pub struct AuditDisputePool {
    pub pool_id: u32,
}

/// Pool market paused.
#[derive(Clone)]
#[contracttype]
pub struct AuditPauseMarket {
    pub pool_id: u32,
}

/// Pool market unpaused.
#[derive(Clone)]
#[contracttype]
pub struct AuditUnpauseMarket {
    pub pool_id: u32,
}

/// Cooling period override applied to a pool.
#[derive(Clone)]
#[contracttype]
pub struct AuditOverridePoolCooling {
    pub pool_id: u32,
}

/// Contract paused state changed.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPaused {
    pub paused: bool,
}

/// Referral fee basis points updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetReferralBps {
    pub before: u32,
    pub after: u32,
}

/// Emergency token rescue initiated.
/// Destination and amount are retained (on-chain financial facts).
#[derive(Clone)]
#[contracttype]
pub struct AuditRescueTokens {
    pub token: Address,
    pub to: Address,
    pub amount: i128,
}

/// Bridge timeout updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetBridgeTimeout {
    pub before: u64,
    pub after: u64,
}

/// Cross-chain dispute window updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetCrossChainDisputeWindow {
    pub before: u64,
    pub after: u64,
}

/// LP fee allocation percentage updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetLpFeeAllocation {
    pub before: u32,
    pub after: u32,
}

/// LP stake boost multiplier updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetLpStakeBoost {
    pub before: u32,
    pub after: u32,
}

/// LP rewards manually distributed into a pool.
#[derive(Clone)]
#[contracttype]
pub struct AuditDistributeLpRewards {
    pub pool_id: u32,
    pub amount: i128,
}

/// Per-pool per-token bet limits updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolTokenBetLimits {
    pub pool_id: u32,
    pub token: Address,
    pub new_min: i128,
    pub new_max: i128,
}

/// Token exchange rate updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetTokenExchangeRate {
    pub token: Address,
    pub rate_bps: i128,
}

/// Webhook registered.
/// URL field is `"[REDACTED]"` — URLs may embed auth tokens in the path.
#[derive(Clone)]
#[contracttype]
pub struct AuditRegisterWebhook {
    pub url_redacted: String,
}

/// Webhook unregistered.
/// Same redaction rationale as `AuditRegisterWebhook`.
#[derive(Clone)]
#[contracttype]
pub struct AuditUnregisterWebhook {
    pub url_redacted: String,
}

/// Pool template created.
#[derive(Clone)]
#[contracttype]
pub struct AuditCreatePoolTemplate {
    pub template_id: u32,
}

/// Pool template updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditUpdatePoolTemplate {
    pub template_id: u32,
}

/// Pool template deleted.
#[derive(Clone)]
#[contracttype]
pub struct AuditDeletePoolTemplate {
    pub template_id: u32,
}

/// Pool metadata updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolMetadata {
    pub pool_id: u32,
}

/// Pool extended metadata updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolExtMetadata {
    pub pool_id: u32,
}

/// Pool category updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolCategory {
    pub pool_id: u32,
}

/// Pool tags updated.
#[derive(Clone)]
#[contracttype]
pub struct AuditSetPoolTags {
    pub pool_id: u32,
}

// ============================================================================
// AdminActionDetail — tuple-variant enum (Soroban contracttype requirement)
// ============================================================================

/// Detailed parameters captured for each admin action.
///
/// Each variant wraps the corresponding `Audit*` struct so that indexers can
/// decode records without schema drift.  Secrets are redacted before this
/// value is constructed (see module docs).
///
/// Soroban's `#[contracttype]` macro requires **tuple variants** (no inline
/// named fields); all structured data lives in the wrapper struct.
#[derive(Clone)]
#[contracttype]
pub enum AdminActionDetail {
    /// Contract was initialized for the first time.
    Initialize(AuditInitialize),
    /// Bet fee rate and recipient updated.
    SetFeeConfig(AuditSetFeeConfig),
    /// Pool creation fee updated.
    SetCreationFee(AuditSetCreationFee),
    /// Pool creation-fee exemption flag toggled for an account.
    SetCreationFeeExemption(AuditSetCreationFeeExemption),
    /// Protocol fee (basis points) updated.
    SetProtocolFee(AuditSetProtocolFee),
    /// Volume-based fee tiers replaced (tier count recorded).
    SetVolumeFeeTiers(AuditSetVolumeFeeTiers),
    /// Per-pool bet limits updated.
    SetPoolBetLimits(AuditSetPoolBetLimits),
    /// Circuit-breaker config updated.
    SetCircuitBreakerConfig(AuditSetCircuitBreakerConfig),
    /// Rate-limit config updated.
    SetRateLimitConfig(AuditSetRateLimitConfig),
    /// User-exposure config updated.
    SetUserExposureConfig(AuditSetUserExposureConfig),
    /// Minimum settlement participant count updated.
    SetMinSettlementParticipants(AuditSetMinSettlementParticipants),
    /// Pool voided by its creator.
    VoidPool(AuditVoidPool),
    /// Treasury withdrawal rate limit updated.
    SetTreasuryWithdrawLimit(AuditSetTreasuryWithdrawLimit),
    /// Treasury recipient address rotated.
    RotateTreasuryRecipient(AuditRotateTreasuryRecipient),
    /// Tokens withdrawn from treasury.
    WithdrawTreasury(AuditWithdrawTreasury),
    /// Freeze-admin address updated.
    SetFreezeAdmin(AuditSetFreezeAdmin),
    /// Contract admin address updated directly.
    SetAdmin(AuditSetAdmin),
    /// New admin address staged for two-step transfer.
    ProposeAdmin(AuditProposeAdmin),
    /// Pending admin transfer accepted; caller became admin.
    AcceptAdmin(AuditAcceptAdmin),
    /// Pool frozen by freeze admin.
    FreezePool(AuditFreezePool),
    /// Pool unfrozen by freeze admin.
    UnfreezePool(AuditUnfreezePool),
    /// Contract-wide dispute window updated.
    SetDisputeWindow(AuditSetDisputeWindow),
    /// Pool disputed (resolution challenged).
    DisputePool(AuditDisputePool),
    /// Pool market paused.
    PauseMarket(AuditPauseMarket),
    /// Pool market unpaused.
    UnpauseMarket(AuditUnpauseMarket),
    /// Cooling period override applied to a pool.
    OverridePoolCooling(AuditOverridePoolCooling),
    /// Contract paused state changed via set_paused / pause_contract / unpause_contract.
    SetPaused(AuditSetPaused),
    /// Referral fee basis points updated.
    SetReferralBps(AuditSetReferralBps),
    /// Emergency token rescue initiated.
    RescueTokens(AuditRescueTokens),
    /// Bridge timeout updated.
    SetBridgeTimeout(AuditSetBridgeTimeout),
    /// Cross-chain dispute window updated.
    SetCrossChainDisputeWindow(AuditSetCrossChainDisputeWindow),
    /// LP fee allocation percentage updated.
    SetLpFeeAllocation(AuditSetLpFeeAllocation),
    /// LP stake boost multiplier updated.
    SetLpStakeBoost(AuditSetLpStakeBoost),
    /// LP rewards manually distributed into a pool.
    DistributeLpRewards(AuditDistributeLpRewards),
    /// Per-pool per-token bet limits updated.
    SetPoolTokenBetLimits(AuditSetPoolTokenBetLimits),
    /// Token exchange rate updated.
    SetTokenExchangeRate(AuditSetTokenExchangeRate),
    /// Webhook registered (URL redacted).
    RegisterWebhook(AuditRegisterWebhook),
    /// Webhook unregistered (URL redacted).
    UnregisterWebhook(AuditUnregisterWebhook),
    /// Pool template created.
    CreatePoolTemplate(AuditCreatePoolTemplate),
    /// Pool template updated.
    UpdatePoolTemplate(AuditUpdatePoolTemplate),
    /// Pool template deleted.
    DeletePoolTemplate(AuditDeletePoolTemplate),
    /// Pool metadata updated.
    SetPoolMetadata(AuditSetPoolMetadata),
    /// Pool extended metadata updated.
    SetPoolExtMetadata(AuditSetPoolExtMetadata),
    /// Pool category updated.
    SetPoolCategory(AuditSetPoolCategory),
    /// Pool tags updated.
    SetPoolTags(AuditSetPoolTags),
    /// Forward-compatible escape hatch for actions whose details are
    /// intentionally omitted or are fully sensitive.
    Redacted,
}

// ============================================================================
// AuditRecord and AuditPage
// ============================================================================

/// A single immutable audit record written on every admin action.
///
/// - `seq`       — monotonic sequence number (0-based); used as pagination cursor.
/// - `timestamp` — ledger timestamp at the time of the action.
/// - `actor`     — address that authorized the action.
/// - `action`    — human-readable action name (matches the entry-point name).
/// - `detail`    — structured parameters (before/after values, etc.).
#[derive(Clone)]
#[contracttype]
pub struct AuditRecord {
    pub seq: u64,
    pub timestamp: u64,
    pub actor: Address,
    pub action: soroban_sdk::Symbol,
    pub detail: AdminActionDetail,
}

/// Paginated result returned by `get_audit_log`.
#[derive(Clone)]
#[contracttype]
pub struct AuditPage {
    /// Records in ascending sequence order.
    pub records: Vec<AuditRecord>,
    /// Pass this as `cursor` to get the next page.
    /// Equals `total` when there are no more pages.
    pub next_cursor: u64,
    /// Total records ever appended (== current sequence counter).
    pub total: u64,
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Return the current sequence counter (next sequence to be written).
fn read_seq(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get::<_, u64>(&DataKey::AuditSeq)
        .unwrap_or(0)
}

// ============================================================================
// Write path
// ============================================================================

/// Append one audit record.
///
/// This is the **only** write path for the audit log.  It:
/// 1. Reads the current sequence counter.
/// 2. Stores the record under `DataKey::AuditRecord(seq)`.
/// 3. Bumps the TTL on the record to keep it alive for ~30 days.
/// 4. Increments and stores the sequence counter.
/// 5. Bumps the TTL on the counter key.
pub fn append(
    env: &Env,
    actor: Address,
    action: soroban_sdk::Symbol,
    detail: AdminActionDetail,
) {
    let seq = read_seq(env);

    let record = AuditRecord {
        seq,
        timestamp: env.ledger().timestamp(),
        actor,
        action,
        detail,
    };

    let record_key = DataKey::AuditRecord(seq);
    env.storage().persistent().set(&record_key, &record);
    env.storage()
        .persistent()
        .extend_ttl(&record_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

    let next_seq = seq + 1;
    env.storage()
        .persistent()
        .set(&DataKey::AuditSeq, &next_seq);
    env.storage().persistent().extend_ttl(
        &DataKey::AuditSeq,
        POOL_BUMP_THRESHOLD,
        POOL_BUMP_TARGET,
    );
}

// ============================================================================
// Redaction helper
// ============================================================================

/// Return the `"[REDACTED]"` sentinel as a `soroban_sdk::String`.
pub fn redacted(env: &Env) -> String {
    String::from_str(env, REDACTED)
}

// ============================================================================
// Query endpoint
// ============================================================================

/// Return up to `limit` audit records starting at absolute sequence `cursor`.
///
/// - `cursor = 0` retrieves from the very first record.
/// - Pass `page.next_cursor` from a previous call to get the next page.
/// - `limit` is capped at [`AUDIT_LOG_PAGE_MAX`] (50).
/// - Missing records (gaps from future compaction) are silently skipped.
pub fn get_audit_log(env: Env, cursor: u64, limit: u64) -> AuditPage {
    let total = read_seq(&env);
    let effective_limit = limit.min(AUDIT_LOG_PAGE_MAX);
    let mut records: Vec<AuditRecord> = Vec::new(&env);

    let mut seq = cursor;
    let mut fetched: u64 = 0;
    while seq < total && fetched < effective_limit {
        if let Some(record) = env
            .storage()
            .persistent()
            .get::<_, AuditRecord>(&DataKey::AuditRecord(seq))
        {
            records.push_back(record);
            fetched += 1;
        }
        seq += 1;
    }

    AuditPage {
        records,
        next_cursor: seq,
        total,
    }
}
