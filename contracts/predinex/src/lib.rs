#![no_std]
// The soroban contractimpl/contractclient macros generate functions that exceed
// clippy's default argument limit. Allow this for macro-generated code only.
// TODO(#XXX): Migrate to #[contractevent] instead of deprecated Events::publish
#![allow(clippy::too_many_arguments)]
#![allow(deprecated)]
extern crate alloc;
use alloc::vec;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, Address, Env,
    String, Symbol, Vec,
};

mod benchmark_tests;
mod benchmarks;
mod bet_management_tests;
mod create_pool_validation_tests;
mod e2e_tests;
mod fee_config_tests;
mod fuzz;
mod fuzz_tests;
mod multi_asset_tests;
mod multi_user_tests;
mod pause_tests;
mod protocol_fee_tests;
mod test;
mod validation_hardening_tests;
mod validation_prop_tests;
mod webhook_test;

// ── Issue #175: Event schema versioning ──────────────────────────────────────
//
// Every event emitted by this contract uses the same topic layout:
//
//   (Symbol(event_name), Symbol(EVENT_SCHEMA_VERSION), ...identifiers)
//
// Topic position 0 is the event name (e.g. `create_pool`). Topic position 1 is
// always the schema version marker (currently `"v1"`). Subsequent topics carry
// pool / user identifiers as before. Indexers and frontend consumers can
// therefore pin a specific schema version with a positional topic filter, e.g.
// `[["create_pool", "v1"]]`, and reject events whose version they do not yet
// understand instead of silently mis-decoding payloads.
//
// Upgrade rules for future schema changes:
//   * A backward-compatible payload extension (additional optional fields)
//     SHOULD reuse the same version marker.
//   * A breaking change to topics or data shape MUST bump the version marker
//     (e.g. `"v2"`) and be documented in `web/docs/CONTRACT_EVENTS.md`.
//   * The contract MUST never emit two version markers for the same event in
//     the same release; consumers can rely on exactly one version per event.
//
// See `web/docs/CONTRACT_EVENTS.md` for the full per-event schema and the
// upgrade expectations published to consumers.
pub const EVENT_SCHEMA_VERSION: &str = "v1";

/// #191 — Contract state schema version for on-chain compatibility checks.
/// Bumped (e.g. "v2") whenever the persistent state layout changes in a
/// backward-incompatible way. Stored under `DataKey::ContractVersion`.
pub const CONTRACT_STATE_VERSION: &str = "v1";

/// Build the schema-version `Symbol` used as topic position 1 on every event.
fn event_version(env: &Env) -> Symbol {
    Symbol::new(env, EVENT_SCHEMA_VERSION)
}

// Dispute window: 7 days in seconds (configurable in future)
const DISPUTE_WINDOW_SECS: u64 = 7 * 24 * 3600;

// Precision multiplier for LP fee-per-share accumulator (avoids rounding to zero)
const LP_PRECISION: i128 = 1_000_000_000;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Pool(u32),
    UserBet(u32, Address),
    PoolOutcomes(u32),
    PoolOutcomeTotals(u32),
    UserOutcomeBets(u32, Address),
    PoolMetadata(u32),
    PoolTemplate(u32),
    PoolTemplateCounter,
    PoolCounter,
    Token,
    Treasury,
    TreasuryRecipient,
    FeeRate,
    FeeRecipient,
    DelegatedSettler(u32),
    FreezeAdmin,
    /// Per-pool minimum bet amount (in raw token units / i128).
    ///
    /// When absent, defaults to `DEFAULT_MIN_BET_STROOPS`.
    PoolMinBet(u32),
    /// Per-pool maximum bet amount (in raw token units / i128).
    ///
    /// When absent, defaults to `DEFAULT_MAX_BET_STROOPS`.
    /// A value of `0` is treated as "no maximum" in `place_bet`.
    PoolMaxBet(u32),
    /// #179 — per-pool creation fee in stroops. Set by the admin via
    /// `set_creation_fee`; defaults to 0 (no fee) when absent.
    CreationFee,
    /// Per-address creation-fee exemption flag. When present and `true`, the
    /// account is not charged the creation fee in `create_pool_internal`. Set
    /// by the treasury recipient via `set_creation_fee_exemption`.
    CreationFeeExempt(Address),
    /// #167 — protocol fee in basis points. Set by the treasury recipient via
    /// `set_protocol_fee`; defaults to 200 (2%) when absent.
    ProtocolFee,
    /// #158 — per-pool claim / payout progress for winner claims.
    PoolPayoutState(u32),
    /// #195 — floor(bps × pool volume) protocol fee for this market (set at settlement).
    PoolSettlementProtocolFee(u32),
    /// #195 — running total credited to aggregate `Treasury` from this pool (fee + dust).
    PoolTreasuryCredited(u32),
    /// #191 — contract state schema version stored on-chain for compatibility checks.
    ContractVersion,
    /// #635 — template that was used to create this pool, if any.
    PoolTemplateId(u32),
    /// #176 — who triggered settlement for this pool (Creator or Operator).
    PoolSettlementSource(u32),
    /// Maximum allowed total pool size. 0 disables the cap.
    MaxPoolSize,
    /// Threshold at/above which the pool enters automatic cooling. 0 disables.
    LargePoolThreshold,
    /// Cooling duration (seconds) applied when threshold is reached.
    LargePoolCoolingPeriodSecs,
    /// If present and in the future, pool is in mandatory cooling period.
    PoolCoolingUntil(u32),
    /// Max bets allowed per wallet within rate-limit window. 0 disables.
    RateLimitMaxBetsPerWindow,
    /// Rate-limit window length in seconds. 0 disables.
    RateLimitWindowSecs,
    /// Per-wallet rate-limit usage state.
    WalletRateLimit(Address),
    /// #350 — Whether the contract is paused for non-admin operations.
    Paused,
    /// #355 — Stored params for a scheduled pool awaiting activation.
    ScheduledPool(u32),
    /// #358 — Auto-incrementing scheduled claim id.
    ScheduledClaimCounter,
    /// #358 — Pending/cancelled/executed delayed claim entry.
    ScheduledClaim(u32),
    /// #358 — Prevent duplicate pending delayed claims per user/pool.
    ScheduledClaimByUserPool(u32, Address),
    /// #363 — Max treasury withdrawal in a configured time window. 0 disables.
    TreasuryWithdrawalMaxPerWindow,
    /// #363 — Treasury withdrawal rate-limit window length. 0 disables.
    TreasuryWithdrawalWindowSecs,
    /// #363 — Current treasury withdrawal rate-limit usage state.
    TreasuryWithdrawalState,
    /// List of all bettor addresses in a pool.
    PoolBettors(u32),
    /// Contract-wide cumulative betting volume across all pools, incremented by
    /// the bet amount on every `place_bet`. Read via `get_total_contract_volume`.
    TotalContractVolume,
    /// TWAP cumulative state per (pool, outcome).
    TwapState(u32, u32),
    /// Historical TWAP snapshots per (pool, outcome) for period lookback.
    TwapSnapshots(u32, u32),
    /// Per-pool TWAP lookback period in seconds. Defaults to `DEFAULT_TWAP_PERIOD_SECS`.
    PoolTwapPeriod(u32),
    /// Optional volume-based protocol fee tiers (`Vec<FeeTier>`). When absent or
    /// empty, the flat `ProtocolFee` applies. Set via `set_volume_fee_tiers`.
    VolumeFeeTiers,
    /// Protocol fee in basis points fixed for a pool at settlement when fee
    /// tiers are configured. Read by claim/preview so the deducted fee matches
    /// the tier resolved at settlement. Absent for pools settled under the flat
    /// fee (those fall back to the live `ProtocolFee`).
    PoolFeeBps(u32),
    /// Minimum number of participants a pool must have before it can be settled.
    /// Set by the treasury recipient; defaults to `DEFAULT_MIN_SETTLEMENT_PARTICIPANTS`.
    MinSettlementParticipants,
    /// #396 — Registered off-chain notification webhooks (Vec<Webhook>).
    Webhooks,
    /// #481 — Ordered list of token addresses accepted by a multi-asset pool.
    /// Absent for single-asset pools. Presence of this key marks the pool as
    /// multi-asset (together with `PoolIsMultiAsset`).
    PoolAllowedTokens(u32),
    /// #481 — Boolean flag set to `true` for multi-asset pools. Checked by
    /// `claim_winnings_internal` to redirect callers to `claim_multi_asset_winnings`.
    PoolIsMultiAsset(u32),
    /// #481 — Exchange rate for a token relative to the base token, in basis
    /// points. Rate convention: 1 bet-token = rate_bps / 10_000 base-tokens.
    /// Example: rate_bps = 5_000 means 1 alt-token is worth 0.5 base tokens.
    /// Set by the treasury recipient via `set_token_exchange_rate`.
    TokenExchangeRate(Address),
    /// #481 — Cumulative amount deposited into a multi-asset pool in a specific
    /// token (in that token's own units, not normalized). Used at claim time to
    /// compute per-token payouts and fees.
    PoolTokenDeposit(u32, Address),
    /// #481 — Per-pool, per-token minimum bet amount (in that token's own units).
    PoolTokenMinBet(u32, Address),
    /// #481 — Per-pool, per-token maximum bet amount (in that token's own units).
    /// A value of 0 means no upper limit.
    PoolTokenMaxBet(u32, Address),
    /// #481 — Fee owed per token for a multi-asset pool, populated on the first
    /// `claim_multi_asset_winnings` call. Treasury collects it via
    /// `collect_multi_asset_fees`.
    PoolTokenFeePending(u32, Address),
    /// #420 — Referral reward basis points (shared from protocol fee).
    ReferralBps,
    /// #420 — Accumulated referral rewards balance per referrer address.
    ReferralBalance(Address),
    /// #420 — Total volume generated through referrals across all referrers.
    TotalReferralVolume,
    /// Cumulative total winnings claimed by a user across all pools.
    UserTotalClaimed(Address),
    /// Claim history entries for a user (capped ring buffer).
    UserClaimHistory(Address),
    /// #625 — Pending rescue request waiting out the 24-hour timelock.
    /// Value: (token: Address, to: Address, amount: i128, not_before: u64)
    PendingRescue,
}

// #189 — TTL bump policy for persistent storage entries.
// Ledger closes every ~5 seconds on Stellar mainnet: 17,280 ledgers ≈ 1 day.
// Active pool records and user positions are extended to POOL_BUMP_TARGET
// whenever their remaining TTL falls below POOL_BUMP_THRESHOLD.
//
// Assumption: active pools and user positions must survive at least until the
// pool is settled and all participants have claimed. 30 days is a safe upper
// bound for most markets; operators running longer markets should call
// bump-only maintenance transactions before the threshold is reached.
const LEDGERS_PER_DAY: u32 = 17_280;
const POOL_BUMP_TARGET: u32 = LEDGERS_PER_DAY * 30; // extend to 30 days
const POOL_BUMP_THRESHOLD: u32 = LEDGERS_PER_DAY * 25; // trigger bump when < 25 days remain

/// #167 — Protocol fee bounds in basis points.
/// Minimum fee: 0 (0%) — no fee floor, allows fee-free operation.
/// Maximum fee: 1000 (10%) — protects users from excessive fees.
/// Default fee: 200 (2%) — matches the original hard-coded value.
const PROTOCOL_FEE_MIN_BPS: u32 = 0;
const PROTOCOL_FEE_MAX_BPS: u32 = 1000;
const PROTOCOL_FEE_DEFAULT_BPS: u32 = 200;

/// Maximum number of volume-based fee tiers accepted by `set_volume_fee_tiers`.
const MAX_FEE_TIERS: u32 = 5;

/// Default minimum participant count required to settle a pool. A value of 1
/// preserves the historical behaviour of allowing any pool with at least one
/// bettor to settle while blocking settlement of completely empty pools.
const DEFAULT_MIN_SETTLEMENT_PARTICIPANTS: u32 = 1;

/// #396 — Maximum webhooks that can be registered per contract instance.
const MAX_WEBHOOKS: u32 = 10;
/// #396 — Maximum byte length for a webhook URL.
const MAX_WEBHOOK_URL_LENGTH: u32 = 512;

/// #151 — Minimum pool lifetime in seconds (matches `web/docs/POOL_DURATION.md`).
const MIN_POOL_DURATION_SECS: u64 = 300;
/// #570 — Maximum pool lifetime in seconds (~1 year).
const MAX_POOL_DURATION_SECS: u64 = 31_536_000;
/// #570 — Minimum creator deposit in stroops (1 XLM).
pub const MIN_CREATOR_DEPOSIT: i128 = 10_000_000;

/// #154 — Maximum length for pool title in bytes.
const MAX_TITLE_LENGTH: u32 = 100;
/// #154 — Maximum length for pool description in bytes.
const MAX_DESCRIPTION_LENGTH: u32 = 1_000;
/// #154 — Maximum length for pool outcome labels in bytes.
const MAX_OUTCOME_LENGTH: u32 = 50;
const MIN_OUTCOME_COUNT: u32 = 2;
/// #634 — Hard upper bound on outcomes per pool. Prevents gas exhaustion from
/// unbounded storage writes and iteration in place_bet / settlement paths.
/// Raising this requires auditing all loops that iterate over outcomes.
const MAX_OUTCOME_COUNT: u32 = 20;
const MAX_METADATA_URI_LENGTH: u32 = 256;
const MAX_SCHEDULE_POOL_HORIZON_SECS: u64 = 30 * 24 * 60 * 60;
const SCHEDULED_CLAIM_EXECUTION_CAP: u32 = 10;

/// Contract-wide minimum bet amount to prevent dust attacks.
/// Any bet below this threshold is rejected regardless of per-pool limits.
/// 1 XLM = 10_000_000 stroops, so 1_000_000 = 0.1 XLM.
const MIN_BET_AMOUNT: i128 = 1_000_000;

/// Default per-pool minimum bet: 0 (no minimum past the contract-wide floor).
///
/// Admin/treasury can set explicit limits per pool. When absent, we
/// intentionally avoid enforcing UI-level constraints so existing pools /
/// contract tests keep working.
const DEFAULT_MIN_BET_STROOPS: i128 = 0;
/// Default per-pool maximum bet: 0 (no maximum).
const DEFAULT_MAX_BET_STROOPS: i128 = 0;
/// Default absolute cap for a pool total (A+B). 0 means "no cap".
const DEFAULT_MAX_POOL_SIZE_STROOPS: i128 = 0;
/// Default threshold for triggering automatic cooling. 0 means disabled.
const DEFAULT_LARGE_POOL_THRESHOLD_STROOPS: i128 = 0;
/// Default cooling duration for large pools.
const DEFAULT_LARGE_POOL_COOLING_PERIOD_SECS: u64 = 0;
/// Default TWAP lookback period: 1 hour.
pub const DEFAULT_TWAP_PERIOD_SECS: u64 = 3_600;
/// Minimum time between TWAP snapshots for a given pool/outcome.
pub const MIN_UPDATE_INTERVAL: u64 = 60;

pub const GRACE_PERIOD_SECS: u64 = 7 * 24 * 60 * 60; // 7 days grace period for refunds

/// Odds are represented in basis points: 10_000 = 100%.
pub const ODDS_SCALE: i128 = 10_000;
const MAX_TWAP_SNAPSHOTS: u32 = 64;

/// #156 — Typed contract error model. Replaces string panics for all failure
/// paths so SDK consumers can match on a stable error code rather than parsing
/// panic strings, and so error compatibility is preserved across upgrades.
#[contracterror]
#[derive(Clone, Debug, PartialEq)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    FeeOutOfBounds = 4,
    InvalidBetAmount = 5,
    InvalidOutcome = 6,
    PoolExpired = 7,
    PoolNotExpired = 8,
    PoolNotFound = 9,
    PoolNotOpen = 10,
    PoolAlreadySettled = 11,
    PoolAlreadyVoided = 12,
    PoolIsCancelled = 15,
    PoolIsFrozen = 16,
    PoolIsDisputed = 17,
    PoolNotSettled = 18,
    PoolNotFrozenOrDisputed = 19,
    PoolCannotBeVoided = 21,
    PoolMustBeSettledToDispute = 22,
    NoBetFound = 23,
    NothingToRefund = 24,
    NoWinningsToClaim = 25,
    InsufficientTreasuryBalance = 26,
    InvalidWithdrawalAmount = 27,
    FreezeAdminNotSet = 28,
    TitleEmpty = 29,
    TitleTooLong = 30,
    DescriptionEmpty = 31,
    DescriptionTooLong = 32,
    OutcomeEmpty = 33,
    OutcomeTooLong = 34,
    DuplicateOutcomeLabels = 35,
    DurationTooShort = 36,
    DurationTooLong = 37,
    FeeMustBeNonNegative = 38,
    StringWhitespaceOnly = 39,
    ExpiryOverflow = 40,
    PoolTotalOverflow = 41,
    UserBetOverflow = 42,
    TreasuryOverflow = 43,
    PoolSizeLimitExceeded = 46,
    InvalidCoolingPeriod = 47,
    InvalidRateLimitConfig = 48,
    RateLimitExceeded = 49,
    ContractPaused = 50,
    InsufficientParticipants = 51,
    WebhookLimitReached = 52,
    InvalidWebhookUrl = 53,
    WebhookNotFound = 54,
    /// #481 — Bet token is not in the pool's allowed-token list.
    UnsupportedToken = 55,
    /// #481 — No exchange rate is set for this token; admin must call
    /// `set_token_exchange_rate` before it can be used in a multi-asset pool.
    ExchangeRateNotSet = 56,
    /// #481 — The pool is multi-asset; callers must use
    /// `claim_multi_asset_winnings` instead of `claim_winnings`.
    MultiAssetClaimRequired = 57,
    /// Bet amount is below the pool's minimum bet limit.
    BetBelowMinBet = 58,
    /// Bet amount is above the pool's maximum bet limit.
    BetAboveMaxBet = 59,
    /// User has no winning bets to claim.
    NoWinningBets = 60,
    /// Referrer cannot refer themselves.
    SelfReferral = 61,
    /// No referral rewards available to claim.
    NoReferralRewards = 62,
    /// Pool grace period has not expired yet.
    PoolNotExpiredGracePeriod = 63,
    /// Computed pool deadline is not in the future.
    DeadlineInPast = 64,
    /// Creator deposit is below the minimum required at pool creation.
    InsufficientCreatorDeposit = 65,
    /// #634 — Outcome count exceeds the hard upper bound.
    TooManyOutcomes = 66,
    /// A duplicate token was provided in the allowed-token list.
    DuplicateToken = 67,
    /// A scheduled claim is not yet due for execution.
    ScheduledClaimNotDue = 68,
}

/// #176 — Settlement source tag indicating who initiated pool settlement.
/// Stored on-chain alongside the winning outcome so indexers and dashboards
/// can distinguish creator-initiated settlements from delegated-operator ones,
/// and leave a slot open for future oracle paths without a schema bump.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum SettlementSource {
    /// Admin called `settle_pool` directly.
    Admin,
    /// Pool creator called `settle_pool` directly.
    Creator,
    /// A delegated operator (assigned via `assign_settler`) called `settle_pool`.
    Operator,
}

/// #396 — Event types that can trigger an off-chain webhook notification.
///
/// Stored inside a `Webhook` entry; an indexer/satsuma that reads the contract
/// ledger uses this list to decide which on-chain events it should forward as
/// an HTTP POST to the registered URL.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum WebhookEventType {
    PoolCreated = 0,
    BetPlaced = 1,
    PoolSettled = 2,
    ClaimProcessed = 3,
    PoolDisputed = 4,
}

/// #396 — A single webhook registration entry.
///
/// `url` must be an HTTPS URL (validated on registration). `event_types`
/// lists the contract events the off-chain indexer should forward to `url`.
#[derive(Clone)]
#[contracttype]
pub struct Webhook {
    pub url: String,
    pub event_types: Vec<WebhookEventType>,
}

/// Explicit lifecycle status for a prediction pool.
///
/// Transitions:
///   Open  ──(cancel_pool)──►  Cancelled  (terminal)
///   Open  ──(void_pool called)──►  Voided
///   Open  ──(expiry reached + settle_pool called)──►  Settled(winning_outcome)
///   Open  ──(freeze_pool called)──►  Frozen
///   Settled  ──(dispute_pool called)──►  Disputed
///   Frozen/Disputed  ──(unfreeze_pool called)──►  Open
///
/// Cancelled, Settled, and Voided are terminal states.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum PoolStatus {
    /// Accepting bets; expiry has not yet passed.
    Open,
    /// Betting closed and a winning outcome has been declared.
    Settled(u32),
    /// Creator voided the pool; all participants can claim a full refund.
    Voided,
    /// Pool is temporarily frozen, blocking bets and claims.
    Frozen,
    /// Pool settlement is disputed, blocking claims pending review.
    Disputed,
    /// #160 — Creator cancelled the pool before any bet was placed. Terminal.
    Cancelled,
    /// #355 — Pool parameters are stored but betting opens at this timestamp.
    Scheduled(u64),
}

#[derive(Clone)]
#[contracttype]
pub struct Pool {
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub outcome_a_name: String,
    pub outcome_b_name: String,
    pub total_a: i128,
    pub total_b: i128,
    pub participant_count: u32,
    pub settled: bool,
    pub winning_outcome: Option<u32>,
    pub created_at: u64,
    pub expiry: u64,
    /// Current operational status of the pool. Defaults to `Open`.
    pub status: PoolStatus,
    /// Cumulative betting volume routed through this pool, incremented by the
    /// bet amount on every `place_bet`. Unlike `total_a`/`total_b` (which an
    /// indexer could net out by outcome), this is a monotonically increasing
    /// lifetime figure that persists unchanged through settlement and claims —
    /// an on-chain source for analytics displays without an off-chain indexer.
    pub cumulative_volume: i128,
    /// #635 — The template this pool was created from, if any.
    /// `Some(template_id)` when the pool was created via
    /// `create_pool_from_template`; `None` for pools created directly via
    /// `create_pool` or `create_pool_with_twap_period`.
    pub template_id: Option<u32>,
}

#[derive(Clone)]
#[contracttype]
pub struct PoolOutcome {
    pub index: u32,
    pub label: String,
    pub total: i128,
}

/// #679 — On-chain pool metadata (immutable after creation) exposed via
/// `get_pool_info` so callers do not need to deserialise the full `Pool`.
#[derive(Clone)]
#[contracttype]
pub struct PoolInfo {
    pub name: String,
    pub description: String,
}

/// #680 — A single entry in a pool's leaderboard.
#[derive(Clone)]
#[contracttype]
pub struct PoolLeaderboardEntry {
    pub user: Address,
    pub total_bet: i128,
    pub winnings_claimed: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct PoolTemplate {
    pub id: u32,
    pub title: String,
    pub description: String,
    pub outcomes: Vec<String>,
    pub duration: u64,
    pub metadata_uri: Option<String>,
    pub is_public: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct PoolTemplateOverrides {
    pub title: Option<String>,
    pub description: Option<String>,
    pub outcomes: Option<Vec<String>>,
    pub duration: Option<u64>,
    pub metadata_uri: Option<String>,
}

#[derive(Clone)]
#[contracttype]
pub struct ScheduledPool {
    pub pool_id: u32,
    pub creator: Address,
    pub open_at: u64,
}

#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum ScheduledClaimStatus {
    Pending,
    Executed,
    Cancelled,
}

#[derive(Clone)]
#[contracttype]
pub struct ScheduledClaim {
    pub id: u32,
    pub pool_id: u32,
    pub user: Address,
    pub claim_at: u64,
    pub status: ScheduledClaimStatus,
}

/// Per-pool bet limits exposed for frontend validation.
///
/// Values are in raw token units (the same units accepted by `place_bet`).
#[derive(Clone)]
#[contracttype]
pub struct PoolBetLimits {
    pub min_bet: i128,
    pub max_bet: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct CircuitBreakerConfig {
    pub max_pool_size: i128,
    pub large_pool_threshold: i128,
    pub cooling_period_secs: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct RateLimitConfig {
    pub max_bets_per_window: u32,
    pub window_secs: u64,
}

/// A single volume-based protocol fee tier.
///
/// When a pool's total volume at settlement is at least `volume_threshold`, the
/// associated `fee_bps` may apply (the highest matching tier wins). Pools whose
/// volume is below the first tier fall back to the flat default protocol fee.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub struct FeeTier {
    /// Minimum total pool volume (inclusive) for this tier to apply.
    pub volume_threshold: i128,
    /// Protocol fee in basis points charged when this tier is the match.
    pub fee_bps: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct WalletRateLimitState {
    pub window_start: u64,
    pub used: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct WalletRateLimitStatus {
    pub max_bets_per_window: u32,
    pub window_secs: u64,
    pub window_start: u64,
    pub used: u32,
    pub remaining: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct TreasuryWithdrawalRateLimitConfig {
    pub max_withdrawal_per_window: i128,
    pub withdrawal_window_secs: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct TreasuryWithdrawalRateLimitState {
    pub window_start: u64,
    pub used: i128,
}

/// Claim status for a user in a specific pool.
///
/// Transitions (winner):
///   NeverBet  ──(place_bet)──►  Claimable  ──(claim_winnings)──►  AlreadyClaimed
/// Transitions (loser):
///   NeverBet  ──(place_bet)──►  NotEligible
/// Transitions (voided pool):
///   NeverBet  ──(place_bet)──►  RefundClaimable  ──(claim_refund)──►  AlreadyClaimed
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum ClaimStatus {
    /// User has never placed a bet in this pool.
    NeverBet,
    /// Pool is settled, user bet on the winning side, and has not yet claimed.
    Claimable,
    /// Pool is voided, user has a stake, and has not yet claimed a refund.
    RefundClaimable,
    /// User bet on the losing side; no winnings available.
    NotEligible,
    /// User has already claimed (bet record removed).
    AlreadyClaimed,
}

#[derive(Clone)]
#[contracttype]
pub struct UserBet {
    pub amount_a: i128,
    pub amount_b: i128,
    pub total_bet: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct UserOutcomeBet {
    pub outcome: u32,
    pub amount: i128,
}

/// #172 — Position entry returned by `get_user_pools`.
///
/// Fields
/// ------
/// - `pool_id`   – the pool in which the user holds a position
/// - `amount_a`  – user's stake on outcome A
/// - `amount_b`  – user's stake on outcome B
/// - `total_bet` – total tokens staked by the user in this pool
///
/// This struct mirrors `UserBet` but carries the `pool_id` so dashboard
/// consumers can reconstruct the full position model from a single call.
#[derive(Clone)]
#[contracttype]
pub struct UserPoolPosition {
    pub pool_id: u32,
    pub amount_a: i128,
    pub amount_b: i128,
    pub total_bet: i128,
}

/// #159 — Result type returned by `preview_claimable_amount`.
///
/// Variants
/// --------
/// - `Unclaimable`  – pool is not yet settled (or is frozen/disputed/cancelled);
///                    no payout is available regardless of the user's position.
/// - `NeverBet`     – pool is settled but the user has no position (or already claimed).
/// - `NotEligible`  – pool is settled; user bet on the losing side.
/// - `Claimable(i128)` – pool is settled; user bet on the winning side and the
///                    value equals exactly what `claim_winnings` would transfer.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum ClaimPreview {
    /// Pool is not in a settled state; payout cannot be computed yet.
    Unclaimable,
    /// User has no active position in this pool (never bet or already claimed).
    NeverBet,
    /// User bet on the losing side; no payout available.
    NotEligible,
    /// User bet on the winning side; value is the exact transferable amount.
    Claimable(i128),
}

/// #158 — Per-pool payout tracking state for reconciliation.
///
/// Tracks cumulative claimed winning stake and paid out amounts
/// across multiple claims to enable fee-on-first-claim and dust-sweep-on-last.
#[derive(Clone, Default, PartialEq)]
#[contracttype]
pub struct PoolPayoutState {
    /// Whether the protocol fee has been credited to treasury for this pool.
    /// The fee is credited only once, on the first winner claim.
    pub fee_credited: bool,
    /// Cumulative winning stake that has been claimed (in terms of the winner's
    /// contribution to the winning side, not the payout amount).
    pub claimed_winning_stake: i128,
    /// Total payout amount that has been distributed to winners.
    pub paid_out: i128,
}

/// Event payload emitted by `claim_winnings`.
///
/// Fields
/// ------
/// - `amount`        – tokens transferred to the claimant
/// - `fee_amount`    – protocol fee credited to treasury (only on first claim)
/// - `winning_outcome` – which outcome was declared the winner (0 or 1)
/// - `total_pool_size` – total tokens in the pool at settlement time
#[derive(Clone)]
#[contracttype]
pub struct ClaimEvent {
    pub amount: i128,
    pub fee_amount: i128,
    pub winning_outcome: u32,
    pub total_pool_size: i128,
}

/// A single entry in a user's claim history for read-only analytics.
///
/// Fields
/// ------
/// - `pool_id`         – the pool from which winnings were claimed
/// - `amount`          – tokens transferred to the claimant
/// - `fee`             – protocol fee deducted from this claim
/// - `timestamp`       – ledger timestamp at the time of claim
/// - `winning_outcome` – which outcome was declared the winner
#[derive(Clone)]
#[contracttype]
pub struct UserClaimEntry {
    pub pool_id: u32,
    pub amount: i128,
    pub fee: i128,
    pub timestamp: u64,
    pub winning_outcome: u32,
}

/// #193 — Global contract configuration returned by `get_config`.
///
/// Provides a single view of all contract configuration values for
/// frontend bootstrapping and diagnostics, replacing multiple reads.
#[derive(Clone)]
#[contracttype]
pub struct ContractConfig {
    /// The token address used for bets and settlements.
    pub token: Address,
    /// The address authorized to receive protocol fees and rotate.
    pub treasury_recipient: Address,
    /// Per-pool creation fee in stroops (0 if not set).
    pub creation_fee: i128,
    /// Protocol fee in basis points (default: 200 = 2%).
    pub protocol_fee_bps: u32,
    /// Event schema version for indexer compatibility.
    pub event_schema_version: Symbol,
    /// #191 — contract state schema version for on-chain compatibility checks.
    pub contract_state_version: Symbol,
}

/// Event payload emitted by `place_bet`.
///
/// Fields
/// ------
/// - `outcome`   – which side was bet on (0 = A, 1 = B)
/// - `amount`    – tokens staked in this single bet
/// - `amount_a`  – user's cumulative stake on outcome A after this bet
/// - `amount_b`  – user's cumulative stake on outcome B after this bet
/// - `total_bet` – user's total exposure in this pool after this bet
///
/// The `amount_a`, `amount_b`, and `total_bet` values are identical to what
/// `get_user_bet` would return immediately after the call, allowing indexers
/// and UI consumers to maintain a local position model from events alone.
#[derive(Clone)]
#[contracttype]
pub struct BetEvent {
    pub outcome: u32,
    pub amount: i128,
    pub total_yes: i128,
    pub total_no: i128,
}

/// #169 — Event payload emitted by `create_pool`.
///
/// Fields
/// ------\n/// - `creator`        – address that created the pool
/// - `expiry`         – unix timestamp when the pool expires
/// - `title`          – short market title
/// - `outcome_a_name` – label for outcome A
/// - `outcome_b_name` – label for outcome B
///
/// This payload allows indexers to populate a lightweight market list entry
/// without performing follow-up reads for every new pool.
#[derive(Clone)]
#[contracttype]
pub struct CreatePoolEvent {
    pub creator: Address,
    pub expiry: u64,
    pub title: String,
    pub outcome_a_name: String,
    pub outcome_b_name: String,
}

/// #195 — Pool-level protocol revenue exposed for analytics and audits.
///
/// `settlement_protocol_fee` is the bps fee amount fixed when the pool is
/// settled (same value emitted on the `settle_pool` event). `treasury_credited`
/// increases as winners claim: protocol fee on the first winner claim, plus
/// payout rounding dust on the final claim — mirroring aggregate `Treasury`.
#[derive(Clone)]
#[contracttype]
pub struct PoolProtocolRevenue {
    pub settlement_protocol_fee: i128,
    pub treasury_credited: i128,
}

/// #176 — Event payload emitted by `settle_pool`, enriched with settlement source metadata.
#[derive(Clone)]
#[contracttype]
pub struct SettlePoolEvent {
    pub caller: Address,
    pub winning_outcome: u32,
    pub winning_side_total: i128,
    pub total_pool_volume: i128,
    pub fee_amount: i128,
    /// Whether the caller was the pool creator or a delegated operator.
    pub source: SettlementSource,
}

/// #351 — Result of a single pool settlement attempt in a batch call.
#[derive(Clone)]
#[contracttype]
pub struct SettleResult {
    pub pool_id: u32,
    pub success: bool,
}

/// #351 — Settlement request for a single pool in a batch call.
#[derive(Clone)]
#[contracttype]
pub struct PoolSettleRequest {
    pub pool_id: u32,
    pub winning_outcome: u32,
}

/// #356 — Event payload emitted alongside `place_bet` when a referrer is present.
#[derive(Clone)]
#[contracttype]
pub struct ReferralBetEvent {
    pub referrer: Address,
    pub pool_id: u32,
    pub outcome: u32,
    pub amount: i128,
}

/// #420 — Event payload emitted when a referrer claims their accumulated rewards.
#[derive(Clone)]
#[contracttype]
pub struct ReferralRewardClaimedEvent {
    pub referrer: Address,
    pub amount: i128,
}

/// #194 — Per-pool result returned by `claim_all_winnings`.
#[derive(Clone)]
#[contracttype]
pub struct ClaimAllEntry {
    pub pool_id: u32,
    pub amount: i128,
}

/// Event payload emitted by `cancel_bet` (partial/full bet cancellation).
///
/// Fields
/// ------
/// - `user`    – address that cancelled part (or all) of its position
/// - `pool_id` – the pool the bet was cancelled in
/// - `outcome` – which outcome the cancelled stake was on
/// - `amount`  – the refunded amount removed from the user's position
///
/// `user` and `pool_id` are also carried as event topics so indexers can filter
/// on them; they are duplicated here so a single payload fully describes the
/// cancellation without a follow-up read.
#[derive(Clone)]
#[contracttype]
pub struct BetCancelledEvent {
    pub user: Address,
    pub pool_id: u32,
    pub outcome: u32,
    pub amount: i128,
}

/// Event payload emitted by `refund_expired_pool`.
#[derive(Clone)]
#[contracttype]
pub struct PoolRefundedEvent {
    pub total_refunded: i128,
}

/// Event payload emitted by the enhanced `cancel_pool`.
#[derive(Clone)]
#[contracttype]
pub struct PoolCancelledEvent {
    pub cancelled_by: Address,
    pub reason: String,
    pub total_refunded: i128,
    pub participant_count: u32,
}

/// Event payload emitted by `extend_pool_duration`.
///
/// Fields
/// ------
/// - `creator`    – pool creator that extended the duration
/// - `new_expiry` – the pool's new expiry timestamp after the extension
#[derive(Clone)]
#[contracttype]
pub struct PoolDurationExtendedEvent {
    pub creator: Address,
    pub new_expiry: u64,
}

/// Per-pool/outcome TWAP accumulator.
///
/// `last_odds` is stored in basis points (`ODDS_SCALE` = 100%). The
/// accumulator stores `basis_points * seconds`, so dividing a cumulative delta
/// by elapsed seconds returns average odds in the same basis-point scale.
#[derive(Clone)]
#[contracttype]
pub struct TwapState {
    pub last_odds: i128,
    pub last_updated_at: u64,
    pub cumulative_odds_time: i128,
}

/// TWAP checkpoint for reconstructing bounded lookback windows.
#[derive(Clone)]
#[contracttype]
pub struct TwapSnapshot {
    pub timestamp: u64,
    pub odds: i128,
    pub cumulative_odds_time: i128,
}

/// Event payload emitted by `update_twap`.
#[derive(Clone)]
#[contracttype]
pub struct TwapUpdatedEvent {
    pub timestamp: u64,
    pub odds: Vec<i128>,
}

#[contract]
pub struct PredinexContract;

#[allow(clippy::too_many_arguments)]
#[contractimpl]
impl PredinexContract {
    pub fn initialize(
        env: Env,
        token: Address,
        treasury_recipient: Address,
        admin: Address,
    ) -> Result<(), ContractError> {
        if env.storage().persistent().has(&DataKey::Token) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Token, &token);
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryRecipient, &treasury_recipient);
        env.storage()
            .persistent()
            .set(&DataKey::FeeRecipient, &treasury_recipient);
        env.storage().persistent().set(&DataKey::FeeRate, &0u32);
        env.storage().persistent().set(&DataKey::Treasury, &0i128);
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.events()
            .publish((Symbol::new(&env, "AdminSet"), event_version(&env)), admin);
        // #191 — persist the contract state schema version on initialization.
        env.storage().persistent().set(
            &DataKey::ContractVersion,
            &Symbol::new(&env, CONTRACT_STATE_VERSION),
        );
        Ok(())
    }

    /// Configure the contract-wide bet fee in basis points.
    ///
    /// Only the treasury recipient may call this. The configured fee is deducted
    /// from each `place_bet` amount before it is added to the pool; the fee
    /// amount is transferred to the configured recipient.
    pub fn set_fee_config(
        env: Env,
        caller: Address,
        fee_rate: u32,
        fee_recipient: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if fee_rate > 10_000 {
            return Err(ContractError::FeeOutOfBounds);
        }

        env.storage().persistent().set(&DataKey::FeeRate, &fee_rate);
        env.storage()
            .persistent()
            .set(&DataKey::FeeRecipient, &fee_recipient);
        env.events().publish(
            (Symbol::new(&env, "FeeConfigUpdated"), event_version(&env)),
            (fee_rate, fee_recipient.clone()),
        );
        Ok(())
    }

    /// Return the contract-wide bet fee configuration.
    pub fn get_fee_config(env: Env) -> (u32, Address) {
        let fee_rate = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::FeeRate)
            .unwrap_or(0);
        let fee_recipient = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::FeeRecipient)
            .or_else(|| {
                env.storage()
                    .persistent()
                    .get::<_, Address>(&DataKey::TreasuryRecipient)
            })
            .unwrap_or_else(|| env.current_contract_address());
        (fee_rate, fee_recipient)
    }

    /// #179 — Set the per-pool creation fee (in stroops). Only the treasury
    /// recipient may call this so the admin key is the same as the withdrawal
    /// destination, keeping the permission model simple.
    /// Pass 0 to remove the fee requirement.
    pub fn set_creation_fee(env: Env, caller: Address, fee: i128) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        if fee < 0 {
            return Err(ContractError::FeeMustBeNonNegative);
        }
        env.storage().persistent().set(&DataKey::CreationFee, &fee);
        Ok(())
    }

    /// #179 — Return the current creation fee in stroops (0 if not set).
    pub fn get_creation_fee(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::CreationFee)
            .unwrap_or(0)
    }

    /// Grant or revoke a per-address exemption from the creation fee.
    ///
    /// Only the treasury recipient may call this (same permission model as
    /// `set_creation_fee`). When an account is exempt, `create_pool` /
    /// `create_multi_outcome_pool` / `schedule_pool` will not charge the
    /// configured creation fee for that creator. Passing `exempt = false`
    /// removes the exemption so the account is charged normally again.
    ///
    /// A `creation_fee_exemption_set` event is emitted with the affected
    /// account and the new flag so indexers can track exemptions.
    pub fn set_creation_fee_exemption(
        env: Env,
        caller: Address,
        account: Address,
        exempt: bool,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        let key = DataKey::CreationFeeExempt(account.clone());
        if exempt {
            env.storage().persistent().set(&key, &true);
            env.storage()
                .persistent()
                .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        } else {
            // Removing the entry keeps storage tidy and is equivalent to the
            // default (not exempt) for reads.
            env.storage().persistent().remove(&key);
        }

        env.events().publish(
            (
                Symbol::new(&env, "creation_fee_exemption_set"),
                event_version(&env),
            ),
            (account, exempt),
        );
        Ok(())
    }

    /// Return whether `account` is currently exempt from the creation fee.
    pub fn is_creation_fee_exempt(env: Env, account: Address) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::CreationFeeExempt(account))
            .unwrap_or(false)
    }

    /// #167 — Set the protocol fee in basis points.
    ///
    /// Only the treasury recipient may call this. The fee must be within
    /// [PROTOCOL_FEE_MIN_BPS, PROTOCOL_FEE_MAX_BPS] (0–1000 basis points, i.e., 0–10%).
    /// The fee applies to future settlements and claims; existing settled pools
    /// are not affected.
    ///
    /// # Arguments
    /// * `caller` – must be the current treasury recipient
    /// * `fee_bps` – new fee in basis points (1 bp = 0.01%)
    ///
    /// # Panics
    /// * "Unauthorized" – if caller is not the treasury recipient
    /// * "Fee out of bounds" – if fee_bps is outside [0, 1000]
    pub fn set_protocol_fee(env: Env, caller: Address, fee_bps: u32) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        if !(PROTOCOL_FEE_MIN_BPS..=PROTOCOL_FEE_MAX_BPS).contains(&fee_bps) {
            return Err(ContractError::FeeOutOfBounds);
        }
        env.storage()
            .persistent()
            .set(&DataKey::ProtocolFee, &fee_bps);

        env.events()
            .publish((Symbol::new(&env, "protocol_fee_set"),), (caller, fee_bps));
        Ok(())
    }

    /// #166 — Return the current protocol fee in basis points.
    ///
    /// The returned value is the canonical source of truth for fee display
    /// in frontends and analytics. Use `get_protocol_fee` to preview fees
    /// before placing bets or claiming winnings.
    ///
    /// # Returns
    /// The protocol fee in basis points (default: 200 = 2%).
    pub fn get_protocol_fee(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::ProtocolFee)
            .unwrap_or(PROTOCOL_FEE_DEFAULT_BPS)
    }

    /// Configure volume-based protocol fee tiers.
    ///
    /// Tiers let larger markets pay a reduced (or otherwise different) fee than
    /// the flat protocol fee. Each entry is a `(volume_threshold, fee_bps)`
    /// pair; at settlement the contract picks the highest tier whose
    /// `volume_threshold` is `<=` the pool's total volume. Pools below the first
    /// tier — and all pools when no tiers are configured — use the flat
    /// `ProtocolFee`, so the feature is fully backward compatible.
    ///
    /// Only the treasury recipient may call this. Passing an empty vector clears
    /// any configured tiers and restores flat-fee behaviour.
    ///
    /// Validation (rejected with `FeeOutOfBounds`):
    /// * at most `MAX_FEE_TIERS` (5) tiers
    /// * every `volume_threshold >= 0`
    /// * strictly ascending `volume_threshold` (no duplicates, defined order)
    /// * every `fee_bps` within `[PROTOCOL_FEE_MIN_BPS, PROTOCOL_FEE_MAX_BPS]`
    ///
    /// Emits `fee_tiers_updated` with the number of tiers now configured.
    pub fn set_volume_fee_tiers(
        env: Env,
        caller: Address,
        tiers: Vec<FeeTier>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        if tiers.len() > MAX_FEE_TIERS {
            return Err(ContractError::FeeOutOfBounds);
        }

        let mut prev_threshold: Option<i128> = None;
        for i in 0..tiers.len() {
            let tier = tiers.get(i).unwrap();
            if tier.volume_threshold < 0 {
                return Err(ContractError::FeeOutOfBounds);
            }
            if !(PROTOCOL_FEE_MIN_BPS..=PROTOCOL_FEE_MAX_BPS).contains(&tier.fee_bps) {
                return Err(ContractError::FeeOutOfBounds);
            }
            if let Some(prev) = prev_threshold {
                if tier.volume_threshold <= prev {
                    return Err(ContractError::FeeOutOfBounds);
                }
            }
            prev_threshold = Some(tier.volume_threshold);
        }

        if tiers.is_empty() {
            env.storage().persistent().remove(&DataKey::VolumeFeeTiers);
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::VolumeFeeTiers, &tiers);
            env.storage().persistent().extend_ttl(
                &DataKey::VolumeFeeTiers,
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        env.events().publish(
            (Symbol::new(&env, "fee_tiers_updated"), event_version(&env)),
            tiers.len(),
        );
        Ok(())
    }

    /// Return the configured volume fee tiers (empty when none are set).
    pub fn get_volume_fee_tiers(env: Env) -> Vec<FeeTier> {
        env.storage()
            .persistent()
            .get::<_, Vec<FeeTier>>(&DataKey::VolumeFeeTiers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Resolve the protocol fee (bps) that applies to a pool whose total volume
    /// is `volume`, honouring configured fee tiers.
    ///
    /// Returns the flat `ProtocolFee` when no tiers are configured or when the
    /// volume is below the first tier; otherwise the `fee_bps` of the highest
    /// tier whose threshold is `<= volume`.
    fn resolve_fee_bps_for_volume(env: &Env, volume: i128) -> u32 {
        let tiers = env
            .storage()
            .persistent()
            .get::<_, Vec<FeeTier>>(&DataKey::VolumeFeeTiers)
            .unwrap_or_else(|| Vec::new(env));

        // Tiers are stored in strictly ascending threshold order, so the last
        // tier whose threshold is satisfied is the highest matching tier.
        let mut matched: Option<u32> = None;
        for i in 0..tiers.len() {
            let tier = tiers.get(i).unwrap();
            if volume >= tier.volume_threshold {
                matched = Some(tier.fee_bps);
            } else {
                break;
            }
        }

        matched.unwrap_or_else(|| Self::get_protocol_fee(env.clone()))
    }

    /// Return the protocol fee (bps) used for a settled pool's payouts: the
    /// value fixed at settlement when fee tiers applied, otherwise the live flat
    /// `ProtocolFee` (preserving pre-tier behaviour for untiered pools).
    fn pool_effective_fee_bps(env: &Env, pool_id: u32) -> i128 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::PoolFeeBps(pool_id))
            .unwrap_or_else(|| Self::get_protocol_fee(env.clone())) as i128
    }

    /// Set per-pool bet limits.
    ///
    /// Only the treasury recipient may call this (same permission model as
    /// other admin configuration).
    ///
    /// - `min_bet` must be >= 0
    /// - `max_bet` must be >= 0, and either be 0 (no max) or >= `min_bet`
    pub fn set_pool_bet_limits(
        env: Env,
        caller: Address,
        pool_id: u32,
        min_bet: i128,
        max_bet: i128,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }

        // Ensure pool exists.
        let _pool_exists: Pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if min_bet < 0 || max_bet < 0 {
            return Err(ContractError::InvalidBetAmount);
        }
        if max_bet != 0 && min_bet > max_bet {
            return Err(ContractError::InvalidBetAmount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::PoolMinBet(pool_id), &min_bet);
        env.storage()
            .persistent()
            .set(&DataKey::PoolMaxBet(pool_id), &max_bet);

        // Keep bet limit entries alive alongside the pool for UI reads.
        env.storage().persistent().extend_ttl(
            &DataKey::PoolMinBet(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::PoolMaxBet(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "pool_bet_limits_set"),
                event_version(&env),
                pool_id,
            ),
            (min_bet, max_bet),
        );
        Ok(())
    }

    /// Configure pool circuit breaker for large pools.
    ///
    /// Only treasury recipient can modify this config.
    /// - `max_pool_size` must be >= 0 (0 disables cap)
    /// - `large_pool_threshold` must be >= 0 (0 disables auto-cooling)
    /// - If threshold > 0 then `cooling_period_secs` must be > 0
    /// - If both are set, `max_pool_size` must be 0 (disabled) or >= threshold
    pub fn set_circuit_breaker_config(
        env: Env,
        caller: Address,
        max_pool_size: i128,
        large_pool_threshold: i128,
        cooling_period_secs: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        if max_pool_size < 0 || large_pool_threshold < 0 {
            return Err(ContractError::InvalidBetAmount);
        }
        if large_pool_threshold > 0 && cooling_period_secs == 0 {
            return Err(ContractError::InvalidCoolingPeriod);
        }
        if max_pool_size > 0 && large_pool_threshold > 0 && max_pool_size < large_pool_threshold {
            return Err(ContractError::InvalidBetAmount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::MaxPoolSize, &max_pool_size);
        env.storage()
            .persistent()
            .set(&DataKey::LargePoolThreshold, &large_pool_threshold);
        env.storage()
            .persistent()
            .set(&DataKey::LargePoolCoolingPeriodSecs, &cooling_period_secs);

        env.events().publish(
            (
                Symbol::new(&env, "circuit_breaker_config_set"),
                event_version(&env),
            ),
            (max_pool_size, large_pool_threshold, cooling_period_secs),
        );
        Ok(())
    }

    /// Read current circuit breaker config.
    pub fn get_circuit_breaker_config(env: Env) -> CircuitBreakerConfig {
        CircuitBreakerConfig {
            max_pool_size: env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::MaxPoolSize)
                .unwrap_or(DEFAULT_MAX_POOL_SIZE_STROOPS),
            large_pool_threshold: env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::LargePoolThreshold)
                .unwrap_or(DEFAULT_LARGE_POOL_THRESHOLD_STROOPS),
            cooling_period_secs: env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::LargePoolCoolingPeriodSecs)
                .unwrap_or(DEFAULT_LARGE_POOL_COOLING_PERIOD_SECS),
        }
    }

    /// Configure per-wallet rate limiting.
    ///
    /// Only treasury recipient may call this.
    /// - `max_bets_per_window == 0` OR `window_secs == 0` disables limiter
    /// - Otherwise both must be > 0
    pub fn set_rate_limit_config(
        env: Env,
        caller: Address,
        max_bets_per_window: u32,
        window_secs: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        if (max_bets_per_window == 0 && window_secs > 0)
            || (max_bets_per_window > 0 && window_secs == 0)
        {
            return Err(ContractError::InvalidRateLimitConfig);
        }

        env.storage()
            .persistent()
            .set(&DataKey::RateLimitMaxBetsPerWindow, &max_bets_per_window);
        env.storage()
            .persistent()
            .set(&DataKey::RateLimitWindowSecs, &window_secs);

        env.events().publish(
            (
                Symbol::new(&env, "rate_limit_config_set"),
                event_version(&env),
            ),
            (max_bets_per_window, window_secs),
        );
        Ok(())
    }

    /// Return configured per-wallet rate limiting thresholds.
    pub fn get_rate_limit_config(env: Env) -> RateLimitConfig {
        RateLimitConfig {
            max_bets_per_window: env
                .storage()
                .persistent()
                .get::<_, u32>(&DataKey::RateLimitMaxBetsPerWindow)
                .unwrap_or(0),
            window_secs: env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::RateLimitWindowSecs)
                .unwrap_or(0),
        }
    }

    /// Return live per-wallet usage against current rate-limit config.
    pub fn get_wallet_rate_limit_status(env: Env, user: Address) -> WalletRateLimitStatus {
        let cfg = Self::get_rate_limit_config(env.clone());
        let now = env.ledger().timestamp();
        let state = env
            .storage()
            .persistent()
            .get::<_, WalletRateLimitState>(&DataKey::WalletRateLimit(user))
            .unwrap_or(WalletRateLimitState {
                window_start: now,
                used: 0,
            });
        let (window_start, used) =
            if cfg.window_secs > 0 && now.saturating_sub(state.window_start) >= cfg.window_secs {
                (now, 0u32)
            } else {
                (state.window_start, state.used)
            };
        let remaining = cfg.max_bets_per_window.saturating_sub(used);

        WalletRateLimitStatus {
            max_bets_per_window: cfg.max_bets_per_window,
            window_secs: cfg.window_secs,
            window_start,
            used,
            remaining,
        }
    }

    /// #193 — Return the complete contract configuration in a single call.
    ///
    /// Provides all configuration values needed for frontend bootstrapping
    /// and diagnostics. This replaces multiple individual reads and provides
    /// a stable interface for consumers.
    ///
    /// # Returns
    /// `ContractConfig` with token address, treasury recipient, creation fee,
    /// protocol fee, and event schema version.
    pub fn get_config(env: Env) -> Result<ContractConfig, ContractError> {
        let token: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        let creation_fee: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::CreationFee)
            .unwrap_or(0);
        let protocol_fee_bps: u32 = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ProtocolFee)
            .unwrap_or(PROTOCOL_FEE_DEFAULT_BPS);

        Ok(ContractConfig {
            token,
            treasury_recipient,
            creation_fee,
            protocol_fee_bps,
            event_schema_version: Symbol::new(&env, EVENT_SCHEMA_VERSION),
            contract_state_version: env
                .storage()
                .persistent()
                .get(&DataKey::ContractVersion)
                .unwrap_or(Symbol::new(&env, CONTRACT_STATE_VERSION)),
        })
    }

    /// Normalize a Soroban `String` to a comparable form by converting to
    /// lowercase bytes and stripping leading/trailing ASCII spaces.
    /// Uses a fixed 64-byte stack buffer — outcome labels longer than 64 bytes
    /// are compared on their first 64 bytes only, which is sufficient for
    /// practical market labels.
    fn normalize_outcome(env: &Env, s: &String) -> soroban_sdk::Bytes {
        let len = s.len() as usize;
        let mut raw = vec![0u8; len];
        s.copy_into_slice(&mut raw);
        let copy_len = if len < 64 { len } else { 64 };
        let mut buf = [0u8; 64];
        let mut i = 0usize;
        while i < copy_len {
            buf[i] = raw[i];
            i += 1;
        }

        let mut start = 0usize;
        let mut end = copy_len;
        while start < end && buf[start] == b' ' {
            start += 1;
        }
        while end > start && buf[end - 1] == b' ' {
            end -= 1;
        }

        let mut result = soroban_sdk::Bytes::new(env);
        let mut i = start;
        while i < end {
            let b = buf[i];
            let lower = if b.is_ascii_uppercase() { b + 32 } else { b };
            result.push_back(lower);
            i += 1;
        }
        result
    }

    /// Validate that a string is not empty or whitespace-only.
    fn validate_non_empty_string(
        s: &String,
        empty_err: ContractError,
        ws_err: ContractError,
    ) -> Result<(), ContractError> {
        let len = s.len() as usize;
        if len == 0 {
            return Err(empty_err);
        }

        let mut raw = vec![0u8; len];
        s.copy_into_slice(&mut raw);
        let mut has_non_whitespace = false;
        let mut i = 0usize;
        while i < len {
            let b = raw[i];
            if b != b' ' && b != b'\t' && b != b'\n' && b != b'\r' {
                has_non_whitespace = true;
                break;
            }
            i += 1;
        }

        if !has_non_whitespace {
            return Err(ws_err);
        }
        Ok(())
    }

    fn string_starts_with(s: &String, prefix: &[u8]) -> bool {
        let len = s.len() as usize;
        if len < prefix.len() {
            return false;
        }
        let mut raw = vec![0u8; len];
        s.copy_into_slice(&mut raw);
        let mut i = 0usize;
        while i < prefix.len() {
            if raw[i] != prefix[i] {
                return false;
            }
            i += 1;
        }
        true
    }

    fn validate_metadata_uri(uri: &Option<String>) -> Result<(), ContractError> {
        if let Some(value) = uri {
            if value.len() > MAX_METADATA_URI_LENGTH {
                return Err(ContractError::DescriptionTooLong);
            }
            if !Self::string_starts_with(value, b"https://")
                && !Self::string_starts_with(value, b"ipfs://")
                && !Self::string_starts_with(value, b"ar://")
            {
                return Err(ContractError::InvalidOutcome);
            }
        }
        Ok(())
    }

    fn validate_outcomes(env: &Env, outcomes: &Vec<String>) -> Result<(), ContractError> {
        if outcomes.len() < MIN_OUTCOME_COUNT || outcomes.len() > MAX_OUTCOME_COUNT {
            return Err(if outcomes.len() > MAX_OUTCOME_COUNT {
                ContractError::TooManyOutcomes
            } else {
                ContractError::InvalidOutcome
            });
        }

        for i in 0..outcomes.len() {
            let outcome = outcomes.get(i).unwrap();
            Self::validate_non_empty_string(
                &outcome,
                ContractError::OutcomeEmpty,
                ContractError::StringWhitespaceOnly,
            )?;
            if outcome.len() > MAX_OUTCOME_LENGTH {
                return Err(ContractError::OutcomeTooLong);
            }

            for j in (i + 1)..outcomes.len() {
                let other = outcomes.get(j).unwrap();
                if Self::normalize_outcome(env, &outcome) == Self::normalize_outcome(env, &other) {
                    return Err(ContractError::DuplicateOutcomeLabels);
                }
            }
        }

        Ok(())
    }

    fn read_outcomes(env: &Env, pool_id: u32, pool: &Pool) -> Vec<String> {
        if let Some(outcomes) = env
            .storage()
            .persistent()
            .get::<_, Vec<String>>(&DataKey::PoolOutcomes(pool_id))
        {
            return outcomes;
        }
        let mut outcomes = Vec::new(env);
        outcomes.push_back(pool.outcome_a_name.clone());
        outcomes.push_back(pool.outcome_b_name.clone());
        outcomes
    }

    fn read_outcome_totals(env: &Env, pool_id: u32, pool: &Pool) -> Vec<i128> {
        if let Some(totals) = env
            .storage()
            .persistent()
            .get::<_, Vec<i128>>(&DataKey::PoolOutcomeTotals(pool_id))
        {
            return totals;
        }
        let mut totals = Vec::new(env);
        totals.push_back(pool.total_a);
        totals.push_back(pool.total_b);
        totals
    }

    fn read_user_outcome_bets(env: &Env, pool_id: u32, user: Address, bet: &UserBet) -> Vec<i128> {
        if let Some(amounts) = env
            .storage()
            .persistent()
            .get::<_, Vec<i128>>(&DataKey::UserOutcomeBets(pool_id, user))
        {
            return amounts;
        }
        let mut amounts = Vec::new(env);
        amounts.push_back(bet.amount_a);
        amounts.push_back(bet.amount_b);
        amounts
    }

    fn sum_totals(totals: &Vec<i128>) -> Result<i128, ContractError> {
        let mut total = 0i128;
        for i in 0..totals.len() {
            total = total
                .checked_add(totals.get(i).unwrap())
                .ok_or(ContractError::PoolTotalOverflow)?;
        }
        Ok(total)
    }

    fn current_odds_for_outcome(totals: &Vec<i128>, outcome: u32) -> Result<i128, ContractError> {
        if outcome >= totals.len() {
            return Err(ContractError::InvalidOutcome);
        }
        if totals.len() == 0 {
            return Err(ContractError::InvalidOutcome);
        }

        let total = Self::sum_totals(totals)?;
        if total <= 0 {
            return Ok(ODDS_SCALE / totals.len() as i128);
        }

        Ok((totals.get(outcome).unwrap() * ODDS_SCALE) / total)
    }

    fn current_odds(env: &Env, pool_id: u32, pool: &Pool) -> Result<Vec<i128>, ContractError> {
        let totals = Self::read_outcome_totals(env, pool_id, pool);
        let mut odds = Vec::new(env);
        for outcome in 0..totals.len() {
            odds.push_back(Self::current_odds_for_outcome(&totals, outcome)?);
        }
        Ok(odds)
    }

    fn extend_twap_ttl(env: &Env, pool_id: u32, outcome: u32) {
        env.storage().persistent().extend_ttl(
            &DataKey::TwapState(pool_id, outcome),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::TwapSnapshots(pool_id, outcome),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
    }

    fn write_twap_checkpoint(env: &Env, pool_id: u32, outcome: u32, state: &TwapState) {
        let key = DataKey::TwapSnapshots(pool_id, outcome);
        let mut snapshots = env
            .storage()
            .persistent()
            .get::<_, Vec<TwapSnapshot>>(&key)
            .unwrap_or_else(|| Vec::new(env));
        snapshots.push_back(TwapSnapshot {
            timestamp: state.last_updated_at,
            odds: state.last_odds,
            cumulative_odds_time: state.cumulative_odds_time,
        });
        while snapshots.len() > MAX_TWAP_SNAPSHOTS {
            snapshots.remove(0);
        }
        env.storage().persistent().set(&key, &snapshots);
    }

    fn initialize_twap_for_pool(
        env: &Env,
        pool_id: u32,
        outcome_count: u32,
        twap_period_secs: u64,
        timestamp: u64,
    ) {
        env.storage()
            .persistent()
            .set(&DataKey::PoolTwapPeriod(pool_id), &twap_period_secs);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolTwapPeriod(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        let initial_odds = if outcome_count == 0 {
            0
        } else {
            ODDS_SCALE / outcome_count as i128
        };
        for outcome in 0..outcome_count {
            let state = TwapState {
                last_odds: initial_odds,
                last_updated_at: timestamp,
                cumulative_odds_time: 0,
            };
            env.storage()
                .persistent()
                .set(&DataKey::TwapState(pool_id, outcome), &state);
            Self::write_twap_checkpoint(env, pool_id, outcome, &state);
            Self::extend_twap_ttl(env, pool_id, outcome);
        }
    }

    fn cumulative_at(snapshots: &Vec<TwapSnapshot>, target: u64) -> Option<i128> {
        if snapshots.len() == 0 {
            return None;
        }

        let mut previous = snapshots.get(0).unwrap();
        if target < previous.timestamp {
            return None;
        }
        if target == previous.timestamp {
            return Some(previous.cumulative_odds_time);
        }

        for i in 1..snapshots.len() {
            let next = snapshots.get(i).unwrap();
            if target == next.timestamp {
                return Some(next.cumulative_odds_time);
            }
            if target < next.timestamp {
                let elapsed = target.saturating_sub(previous.timestamp) as i128;
                return previous
                    .odds
                    .checked_mul(elapsed)
                    .and_then(|weighted| previous.cumulative_odds_time.checked_add(weighted));
            }
            previous = next;
        }

        let elapsed = target.saturating_sub(previous.timestamp) as i128;
        previous
            .odds
            .checked_mul(elapsed)
            .and_then(|weighted| previous.cumulative_odds_time.checked_add(weighted))
    }

    fn create_pool_internal(
        env: &Env,
        creator: Address,
        title: String,
        description: String,
        outcomes: Vec<String>,
        duration: u64,
        metadata_uri: Option<String>,
        created_at: u64,
        status: PoolStatus,
        twap_period_secs: u64,
        template_id: Option<u32>,
    ) -> Result<u32, ContractError> {
        // Check length bounds before calling validate_non_empty_string, which
        // calls copy_into_slice internally. Attempting to copy an oversized
        // string would panic with a WasmVm error before the contract's own
        // validation runs, masking the typed ContractError. Length is checked
        // first so callers always receive TitleTooLong / DescriptionTooLong.
        if title.len() > MAX_TITLE_LENGTH {
            return Err(ContractError::TitleTooLong);
        }
        Self::validate_non_empty_string(
            &title,
            ContractError::TitleEmpty,
            ContractError::StringWhitespaceOnly,
        )?;

        if description.len() > MAX_DESCRIPTION_LENGTH {
            return Err(ContractError::DescriptionTooLong);
        }
        Self::validate_non_empty_string(
            &description,
            ContractError::DescriptionEmpty,
            ContractError::StringWhitespaceOnly,
        )?;

        // #634 — Fast-fail before validate_outcomes to surface a clear error
        // (TooManyOutcomes) and avoid allocating/iterating over a huge vec.
        if outcomes.len() > MAX_OUTCOME_COUNT {
            return Err(ContractError::TooManyOutcomes);
        }

        Self::validate_outcomes(env, &outcomes)?;
        Self::validate_metadata_uri(&metadata_uri)?;

        if duration < MIN_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooShort);
        }
        if duration == 0 || duration > MAX_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooLong);
        }
        // #570 — The computed deadline must be strictly in the future.
        let deadline = created_at
            .checked_add(duration)
            .ok_or(ContractError::ExpiryOverflow)?;
        if deadline <= env.ledger().timestamp() {
            return Err(ContractError::DeadlineInPast);
        }

        if twap_period_secs == 0 {
            return Err(ContractError::DurationTooShort);
        }

        let creation_fee: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::CreationFee)
            .unwrap_or(0);

        // Exempt creators (e.g. partners, the treasury, or promotional
        // accounts) skip the creation fee entirely.
        let fee_exempt = env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::CreationFeeExempt(creator.clone()))
            .unwrap_or(false);

        if creation_fee > 0 && !fee_exempt {
            let token_address: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Token)
                .ok_or(ContractError::NotInitialized)?;
            let token_client = token::Client::new(env, &token_address);
            let treasury_recipient: Address = env
                .storage()
                .persistent()
                .get(&DataKey::TreasuryRecipient)
                .ok_or(ContractError::NotInitialized)?;
            token_client.transfer(&creator, &treasury_recipient, &creation_fee);
        }

        let pool_id = Self::get_pool_counter(env) + 1;
        let expiry = created_at
            .checked_add(duration)
            .ok_or(ContractError::ExpiryOverflow)?;
        let outcome_a = outcomes.get(0).unwrap();
        let outcome_b = outcomes.get(1).unwrap();

        let pool = Pool {
            creator: creator.clone(),
            title: title.clone(),
            description: description.clone(),
            outcome_a_name: outcome_a.clone(),
            outcome_b_name: outcome_b.clone(),
            total_a: 0,
            total_b: 0,
            participant_count: 0,
            settled: false,
            winning_outcome: None,
            created_at,
            expiry,
            status,
            cumulative_volume: 0,
            template_id,
        };

        let mut totals = Vec::new(env);
        for _ in 0..outcomes.len() {
            totals.push_back(0i128);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage()
            .persistent()
            .set(&DataKey::PoolOutcomes(pool_id), &outcomes);
        env.storage()
            .persistent()
            .set(&DataKey::PoolOutcomeTotals(pool_id), &totals);
        Self::initialize_twap_for_pool(env, pool_id, outcomes.len(), twap_period_secs, created_at);
        if let Some(ref uri) = metadata_uri {
            env.storage()
                .persistent()
                .set(&DataKey::PoolMetadata(pool_id), uri);
        }
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::PoolOutcomes(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::PoolOutcomeTotals(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        if metadata_uri.is_some() {
            env.storage().persistent().extend_ttl(
                &DataKey::PoolMetadata(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::PoolCounter, &pool_id);

        env.events().publish(
            (Symbol::new(env, "create_pool"), pool_id),
            CreatePoolEvent {
                creator,
                expiry,
                title,
                outcome_a_name: outcome_a,
                outcome_b_name: outcome_b,
            },
        );

        Ok(pool_id)
    }

    pub fn create_pool(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcome_a: String,
        outcome_b: String,
        duration: u64,
        amount: i128,
    ) -> Result<u32, ContractError> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        creator.require_auth();

        // #570 — Minimum creator deposit.
        if amount < MIN_CREATOR_DEPOSIT {
            return Err(ContractError::InsufficientCreatorDeposit);
        }

        let mut outcomes = Vec::new(&env);
        outcomes.push_back(outcome_a);
        outcomes.push_back(outcome_b);
        Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            None,
            env.ledger().timestamp(),
            PoolStatus::Open,
            DEFAULT_TWAP_PERIOD_SECS,
            None,
        )
    }

    pub fn create_pool_with_twap_period(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcome_a: String,
        outcome_b: String,
        duration: u64,
        twap_period_secs: u64,
    ) -> Result<u32, ContractError> {
        creator.require_auth();

        let mut outcomes = Vec::new(&env);
        outcomes.push_back(outcome_a);
        outcomes.push_back(outcome_b);
        Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            None,
            env.ledger().timestamp(),
            PoolStatus::Open,
            twap_period_secs,
            None,
        )
    }

    pub fn create_multi_outcome_pool(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcomes: Vec<String>,
        duration: u64,
        metadata_uri: Option<String>,
    ) -> Result<u32, ContractError> {
        creator.require_auth();
        Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            metadata_uri,
            env.ledger().timestamp(),
            PoolStatus::Open,
            DEFAULT_TWAP_PERIOD_SECS,
            None,
        )
    }

    pub fn create_multi_pool_with_twap(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcomes: Vec<String>,
        duration: u64,
        metadata_uri: Option<String>,
        twap_period_secs: u64,
    ) -> Result<u32, ContractError> {
        creator.require_auth();
        Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            metadata_uri,
            env.ledger().timestamp(),
            PoolStatus::Open,
            twap_period_secs,
            None,
        )
    }

    pub fn schedule_pool(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcome_a: String,
        outcome_b: String,
        duration: u64,
        open_at: u64,
    ) -> Result<u32, ContractError> {
        creator.require_auth();
        let now = env.ledger().timestamp();
        if open_at <= now {
            return Err(ContractError::DurationTooShort);
        }
        let horizon = now
            .checked_add(MAX_SCHEDULE_POOL_HORIZON_SECS)
            .ok_or(ContractError::ExpiryOverflow)?;
        if open_at > horizon {
            return Err(ContractError::DurationTooLong);
        }

        let mut outcomes = Vec::new(&env);
        outcomes.push_back(outcome_a);
        outcomes.push_back(outcome_b);
        let pool_id = Self::create_pool_internal(
            &env,
            creator.clone(),
            title,
            description,
            outcomes,
            duration,
            None,
            open_at,
            PoolStatus::Scheduled(open_at),
            DEFAULT_TWAP_PERIOD_SECS,
            None,
        )?;
        let scheduled = ScheduledPool {
            pool_id,
            creator: creator.clone(),
            open_at,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledPool(pool_id), &scheduled);
        env.storage().persistent().extend_ttl(
            &DataKey::ScheduledPool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.events().publish(
            (
                Symbol::new(&env, "pool_scheduled"),
                event_version(&env),
                pool_id,
            ),
            (creator, open_at),
        );
        Ok(pool_id)
    }

    pub fn activate_scheduled_pool(env: Env, pool_id: u32) -> Result<(), ContractError> {
        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        let open_at = match pool.status {
            PoolStatus::Scheduled(open_at) => open_at,
            _ => return Err(ContractError::PoolNotOpen),
        };
        if env.ledger().timestamp() < open_at {
            return Err(ContractError::PoolNotExpired);
        }

        pool.status = PoolStatus::Open;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage()
            .persistent()
            .remove(&DataKey::ScheduledPool(pool_id));
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.events().publish(
            (
                Symbol::new(&env, "scheduled_pool_activated"),
                event_version(&env),
                pool_id,
            ),
            open_at,
        );
        Ok(())
    }

    pub fn cancel_scheduled_pool(
        env: Env,
        creator: Address,
        pool_id: u32,
    ) -> Result<(), ContractError> {
        creator.require_auth();
        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        if creator != pool.creator {
            return Err(ContractError::Unauthorized);
        }
        if !matches!(pool.status, PoolStatus::Scheduled(_)) {
            return Err(ContractError::PoolNotOpen);
        }
        pool.status = PoolStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage()
            .persistent()
            .remove(&DataKey::ScheduledPool(pool_id));
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.events().publish(
            (
                Symbol::new(&env, "scheduled_pool_cancelled"),
                event_version(&env),
                pool_id,
            ),
            creator,
        );
        Ok(())
    }

    pub fn get_scheduled_pools(env: Env, start_id: u32, count: u32) -> Vec<ScheduledPool> {
        let mut scheduled = Vec::new(&env);
        let pool_count = Self::get_pool_count(env.clone());

        // Early return if start_id is beyond the pool count to prevent overflow
        if start_id > pool_count {
            return scheduled;
        }

        let effective_count = if count > 100 { 100 } else { count };
        for i in 0..effective_count {
            let pool_id = start_id + i;
            if pool_id > pool_count {
                break;
            }
            if let Some(item) = env
                .storage()
                .persistent()
                .get::<_, ScheduledPool>(&DataKey::ScheduledPool(pool_id))
            {
                scheduled.push_back(item);
            }
        }
        scheduled
    }

    pub fn place_bet(
        env: Env,
        user: Address,
        pool_id: u32,
        outcome: u32,
        amount: i128,
        referrer: Option<Address>,
    ) -> Result<(), ContractError> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        user.require_auth();

        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(ContractError::InvalidBetAmount);
        }

        // #673 — Enforce contract-wide minimum bet to prevent dust.
        if amount < MIN_BET_AMOUNT {
            return Err(ContractError::BetBelowMinBet);
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if pool.status == PoolStatus::Frozen {
            if let Some(cooling_until) = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::PoolCoolingUntil(pool_id))
            {
                if env.ledger().timestamp() >= cooling_until {
                    pool.status = PoolStatus::Open;
                    env.storage()
                        .persistent()
                        .remove(&DataKey::PoolCoolingUntil(pool_id));
                } else {
                    return Err(ContractError::PoolIsFrozen);
                }
            }
        }

        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }

        if env.ledger().timestamp() >= pool.expiry {
            return Err(ContractError::PoolExpired);
        }

        let outcomes = Self::read_outcomes(&env, pool_id, &pool);
        if outcome >= outcomes.len() {
            return Err(ContractError::InvalidOutcome);
        }

        // Per-wallet rate limiting for abuse prevention.
        let max_bets_per_window: u32 = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::RateLimitMaxBetsPerWindow)
            .unwrap_or(0);
        let window_secs: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::RateLimitWindowSecs)
            .unwrap_or(0);
        if max_bets_per_window > 0 && window_secs > 0 {
            let now = env.ledger().timestamp();
            let key = DataKey::WalletRateLimit(user.clone());
            let mut rate_state = env
                .storage()
                .persistent()
                .get::<_, WalletRateLimitState>(&key)
                .unwrap_or(WalletRateLimitState {
                    window_start: now,
                    used: 0,
                });

            if now.saturating_sub(rate_state.window_start) >= window_secs {
                rate_state.window_start = now;
                rate_state.used = 0;
            }
            if rate_state.used >= max_bets_per_window {
                return Err(ContractError::RateLimitExceeded);
            }
            rate_state.used = rate_state
                .used
                .checked_add(1)
                .ok_or(ContractError::RateLimitExceeded)?;
            env.storage().persistent().set(&key, &rate_state);
            env.storage()
                .persistent()
                .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        }

        // Enforce per-pool bet limits (admin-configurable).
        let min_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMinBet(pool_id))
            .unwrap_or(DEFAULT_MIN_BET_STROOPS);
        let max_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMaxBet(pool_id))
            .unwrap_or(DEFAULT_MAX_BET_STROOPS);

        if min_bet > 0 && amount < min_bet {
            return Err(ContractError::BetBelowMinBet);
        }
        // max_bet == 0 => no maximum.
        if max_bet > 0 && amount > max_bet {
            return Err(ContractError::BetAboveMaxBet);
        }

        let mut totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let current_total = Self::sum_totals(&totals)?;
        let new_total = current_total
            .checked_add(amount)
            .ok_or(ContractError::PoolTotalOverflow)?;

        let max_pool_size: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::MaxPoolSize)
            .unwrap_or(DEFAULT_MAX_POOL_SIZE_STROOPS);
        if max_pool_size > 0 && new_total > max_pool_size {
            return Err(ContractError::PoolSizeLimitExceeded);
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        let (fee_rate, fee_recipient) = Self::get_fee_config(env.clone());
        let fee_amount = if fee_rate > 0 {
            amount
                .checked_mul(fee_rate as i128)
                .ok_or(ContractError::PoolTotalOverflow)?
                / 10_000
        } else {
            0
        };
        let net_amount = amount
            .checked_sub(fee_amount)
            .ok_or(ContractError::InvalidBetAmount)?;

        token_client.transfer(&user, &env.current_contract_address(), &amount);
        if fee_amount > 0 {
            token_client.transfer(&env.current_contract_address(), &fee_recipient, &fee_amount);
        }

        let current_outcome_total = totals.get(outcome).unwrap();
        totals.set(
            outcome,
            current_outcome_total
                .checked_add(net_amount)
                .ok_or(ContractError::PoolTotalOverflow)?,
        );

        if outcome == 0 {
            pool.total_a = pool
                .total_a
                .checked_add(net_amount)
                .ok_or(ContractError::PoolTotalOverflow)?;
        } else {
            pool.total_b = pool
                .total_b
                .checked_add(net_amount)
                .ok_or(ContractError::PoolTotalOverflow)?;
        }

        // Track cumulative betting volume for on-chain analytics. This figure
        // only ever grows and is never reset by settlement or claims, so it
        // diverges from total_a/total_b once winners withdraw.
        pool.cumulative_volume = pool
            .cumulative_volume
            .checked_add(net_amount)
            .ok_or(ContractError::PoolTotalOverflow)?;
        let total_contract_volume: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::TotalContractVolume)
            .unwrap_or(0)
            .checked_add(net_amount)
            .ok_or(ContractError::PoolTotalOverflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::TotalContractVolume, &total_contract_volume);

        let mut user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .unwrap_or(UserBet {
                amount_a: 0,
                amount_b: 0,
                total_bet: 0,
            });

        let is_first_bet = user_bet.total_bet == 0;
        if is_first_bet {
            pool.participant_count += 1;

            let mut bettors = env
                .storage()
                .persistent()
                .get::<_, Vec<Address>>(&DataKey::PoolBettors(pool_id))
                .unwrap_or_else(|| Vec::new(&env));
            bettors.push_back(user.clone());
            env.storage()
                .persistent()
                .set(&DataKey::PoolBettors(pool_id), &bettors);
            env.storage().persistent().extend_ttl(
                &DataKey::PoolBettors(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        // #189 — keep pool TTL alive on every write.
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage()
            .persistent()
            .set(&DataKey::PoolOutcomeTotals(pool_id), &totals);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolOutcomeTotals(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        if outcome == 0 {
            user_bet.amount_a = user_bet
                .amount_a
                .checked_add(net_amount)
                .ok_or(ContractError::UserBetOverflow)?;
        } else {
            user_bet.amount_b = user_bet
                .amount_b
                .checked_add(net_amount)
                .ok_or(ContractError::UserBetOverflow)?;
        }
        user_bet.total_bet = user_bet
            .total_bet
            .checked_add(net_amount)
            .ok_or(ContractError::UserBetOverflow)?;

        env.storage()
            .persistent()
            .set(&DataKey::UserBet(pool_id, user.clone()), &user_bet);
        let mut outcome_bets = env
            .storage()
            .persistent()
            .get::<_, Vec<i128>>(&DataKey::UserOutcomeBets(pool_id, user.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        while outcome_bets.len() < outcomes.len() {
            outcome_bets.push_back(0);
        }
        let current_user_outcome = outcome_bets.get(outcome).unwrap();
        outcome_bets.set(
            outcome,
            current_user_outcome
                .checked_add(net_amount)
                .ok_or(ContractError::UserBetOverflow)?,
        );
        env.storage().persistent().set(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            &outcome_bets,
        );
        // #189 — user position must survive at least as long as the pool.
        env.storage().persistent().extend_ttl(
            &DataKey::UserBet(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        // Calculate totals for the event
        let total_yes = pool.total_a;
        let total_no = pool.total_b;

        env.events().publish(
            (
                Symbol::new(&env, "place_bet"),
                event_version(&env),
                pool_id,
                user.clone(),
            ),
            BetEvent {
                outcome,
                amount: net_amount,
                total_yes,
                total_no,
            },
        );

        // #356 — emit referral_bet event alongside place_bet when referrer present.
        if let Some(ref_referrer) = referrer {
            env.events().publish(
                (
                    Symbol::new(&env, "referral_bet"),
                    event_version(&env),
                    pool_id,
                ),
                ReferralBetEvent {
                    referrer: ref_referrer,
                    pool_id,
                    outcome,
                    amount,
                },
            );
        }

        let large_pool_threshold: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::LargePoolThreshold)
            .unwrap_or(DEFAULT_LARGE_POOL_THRESHOLD_STROOPS);
        let cooling_period_secs: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::LargePoolCoolingPeriodSecs)
            .unwrap_or(DEFAULT_LARGE_POOL_COOLING_PERIOD_SECS);
        if large_pool_threshold > 0
            && cooling_period_secs > 0
            && current_total < large_pool_threshold
            && new_total >= large_pool_threshold
            && pool.status == PoolStatus::Open
        {
            let cooling_until = env
                .ledger()
                .timestamp()
                .checked_add(cooling_period_secs)
                .ok_or(ContractError::ExpiryOverflow)?;
            pool.status = PoolStatus::Frozen;
            env.storage()
                .persistent()
                .set(&DataKey::Pool(pool_id), &pool);
            env.storage().persistent().extend_ttl(
                &DataKey::Pool(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
            env.storage()
                .persistent()
                .set(&DataKey::PoolCoolingUntil(pool_id), &cooling_until);
            env.storage().persistent().extend_ttl(
                &DataKey::PoolCoolingUntil(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
            env.events().publish(
                (
                    Symbol::new(&env, "pool_cooling_started"),
                    event_version(&env),
                    pool_id,
                ),
                (cooling_until, new_total),
            );
        }
        Ok(())
    }

    /// Record the current outcome odds for TWAP reads.
    ///
    /// Callable by anyone. Odds are stored in basis points (`ODDS_SCALE` =
    /// 100%) and snapshots are accepted at most once per `MIN_UPDATE_INTERVAL`
    /// for each pool/outcome.
    pub fn update_twap(env: Env, pool_id: u32) -> Result<(), ContractError> {
        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        let outcomes = Self::read_outcomes(&env, pool_id, &pool);
        let odds = Self::current_odds(&env, pool_id, &pool)?;
        let now = env.ledger().timestamp();

        for outcome in 0..outcomes.len() {
            let state = env
                .storage()
                .persistent()
                .get::<_, TwapState>(&DataKey::TwapState(pool_id, outcome))
                .unwrap_or(TwapState {
                    last_odds: ODDS_SCALE / outcomes.len() as i128,
                    last_updated_at: pool.created_at,
                    cumulative_odds_time: 0,
                });
            if now.saturating_sub(state.last_updated_at) < MIN_UPDATE_INTERVAL {
                return Err(ContractError::RateLimitExceeded);
            }
        }

        for outcome in 0..outcomes.len() {
            let mut state = env
                .storage()
                .persistent()
                .get::<_, TwapState>(&DataKey::TwapState(pool_id, outcome))
                .unwrap_or(TwapState {
                    last_odds: ODDS_SCALE / outcomes.len() as i128,
                    last_updated_at: pool.created_at,
                    cumulative_odds_time: 0,
                });
            let elapsed = now.saturating_sub(state.last_updated_at) as i128;
            let weighted = state
                .last_odds
                .checked_mul(elapsed)
                .ok_or(ContractError::PoolTotalOverflow)?;
            state.cumulative_odds_time = state
                .cumulative_odds_time
                .checked_add(weighted)
                .ok_or(ContractError::PoolTotalOverflow)?;
            state.last_updated_at = now;
            state.last_odds = odds.get(outcome).unwrap();

            env.storage()
                .persistent()
                .set(&DataKey::TwapState(pool_id, outcome), &state);
            Self::write_twap_checkpoint(&env, pool_id, outcome, &state);
            Self::extend_twap_ttl(&env, pool_id, outcome);
        }

        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.events().publish(
            (
                Symbol::new(&env, "twap_updated"),
                event_version(&env),
                pool_id,
            ),
            TwapUpdatedEvent {
                timestamp: now,
                odds,
            },
        );
        Ok(())
    }

    /// Return average odds for `outcome` over `period_secs`.
    ///
    /// Passing `0` uses the pool's configured TWAP period, defaulting to one
    /// hour. The return value uses basis points (`10_000 = 100%`). When the
    /// requested window starts before available history, current odds are
    /// returned as a conservative fallback.
    pub fn get_twap(
        env: Env,
        pool_id: u32,
        outcome: u32,
        period_secs: u64,
    ) -> Result<i128, ContractError> {
        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        let totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let current_odds = Self::current_odds_for_outcome(&totals, outcome)?;
        let effective_period = if period_secs == 0 {
            env.storage()
                .persistent()
                .get::<_, u64>(&DataKey::PoolTwapPeriod(pool_id))
                .unwrap_or(DEFAULT_TWAP_PERIOD_SECS)
        } else {
            period_secs
        };
        if effective_period == 0 {
            return Err(ContractError::DurationTooShort);
        }

        let now = env.ledger().timestamp();
        let pool_age = now.saturating_sub(pool.created_at);
        if effective_period >= pool_age || pool_age == 0 {
            return Ok(current_odds);
        }

        let state = match env
            .storage()
            .persistent()
            .get::<_, TwapState>(&DataKey::TwapState(pool_id, outcome))
        {
            Some(state) => state,
            None => return Ok(current_odds),
        };
        let snapshots = match env
            .storage()
            .persistent()
            .get::<_, Vec<TwapSnapshot>>(&DataKey::TwapSnapshots(pool_id, outcome))
        {
            Some(snapshots) => snapshots,
            None => return Ok(current_odds),
        };
        let window_start = now.saturating_sub(effective_period);
        let start_cumulative = match Self::cumulative_at(&snapshots, window_start) {
            Some(value) => value,
            None => return Ok(current_odds),
        };
        let elapsed_since_update = now.saturating_sub(state.last_updated_at) as i128;
        let current_cumulative = state
            .last_odds
            .checked_mul(elapsed_since_update)
            .and_then(|weighted| state.cumulative_odds_time.checked_add(weighted))
            .ok_or(ContractError::PoolTotalOverflow)?;
        let numerator = current_cumulative
            .checked_sub(start_cumulative)
            .ok_or(ContractError::PoolTotalOverflow)?;
        Ok(numerator / effective_period as i128)
    }

    pub fn get_pool_twap_period(env: Env, pool_id: u32) -> Result<u64, ContractError> {
        if !env.storage().persistent().has(&DataKey::Pool(pool_id)) {
            return Err(ContractError::PoolNotFound);
        }
        Ok(env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::PoolTwapPeriod(pool_id))
            .unwrap_or(DEFAULT_TWAP_PERIOD_SECS))
    }

    /// Cancel part (or all) of a previously placed bet before the pool resolves.
    ///
    /// Lets a bettor reduce their exposure on a given outcome while the market is
    /// still live. The cancelled `amount` is transferred straight back to the
    /// caller and removed from the relevant outcome total and the user's position.
    ///
    /// # Conditions
    /// * Only the betting user may cancel their own position (`user.require_auth`).
    /// * Pool must exist and be `Open` (not settled, voided, cancelled, frozen,
    ///   or disputed) and not yet expired.
    /// * `amount` must be positive and at most the user's current stake on
    ///   `outcome`.
    /// * After the cancellation, any non-zero remaining stake on `outcome` must
    ///   still satisfy the pool's configured min/max bet limits. A full
    ///   cancellation (remaining == 0) is always allowed.
    ///
    /// # Post-conditions
    /// * `amount` is refunded to the caller.
    /// * The outcome total and the pool's `total_a`/`total_b` are reduced by
    ///   `amount`; `participant_count` is left unchanged even on a full
    ///   cancellation (the participant slot is retained).
    /// * A `bet_cancelled` event is emitted with `(user, pool_id, outcome, amount)`.
    ///
    /// # Errors
    /// * `PoolNotFound` — pool ID does not exist.
    /// * `PoolNotOpen` — pool is not in the `Open` state.
    /// * `PoolExpired` — pool expiry has already passed.
    /// * `InvalidOutcome` — `outcome` index is out of range.
    /// * `InvalidBetAmount` — `amount` is non-positive or exceeds the user's
    ///   stake on `outcome`.
    /// * `NoBetFound` — caller has no position in this pool.
    /// * `BetBelowMinBet` / `BetAboveMaxBet` — remaining stake would violate the
    ///   configured per-pool bet limits.
    pub fn cancel_bet(
        env: Env,
        user: Address,
        pool_id: u32,
        outcome: u32,
        amount: i128,
    ) -> Result<i128, ContractError> {
        user.require_auth();
        Self::require_not_paused(&env)?;

        // #645 — Multi-asset pools track per-token stakes; the base-token
        // refund path here is incorrect for alt-token bets.  Callers must use
        // `cancel_multi_asset_bet` (or the equivalent multi-asset flow) instead.
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        if amount <= 0 {
            return Err(ContractError::InvalidBetAmount);
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Cancellation is only allowed while the market is live.
        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }
        if env.ledger().timestamp() >= pool.expiry {
            return Err(ContractError::PoolExpired);
        }

        let outcomes = Self::read_outcomes(&env, pool_id, &pool);
        if outcome >= outcomes.len() {
            return Err(ContractError::InvalidOutcome);
        }

        let mut user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let mut outcome_bets = Self::read_user_outcome_bets(&env, pool_id, user.clone(), &user_bet);
        while outcome_bets.len() < outcomes.len() {
            outcome_bets.push_back(0);
        }
        let user_outcome_amount = outcome_bets.get(outcome).unwrap();

        // Cannot cancel more than the user staked on this outcome.
        if amount > user_outcome_amount {
            return Err(ContractError::InvalidBetAmount);
        }

        let remaining = user_outcome_amount
            .checked_sub(amount)
            .ok_or(ContractError::InvalidBetAmount)?;

        // Re-check per-pool bet limits against the remaining stake. A full
        // cancellation (remaining == 0) closes the position and is always allowed.
        if remaining > 0 {
            let min_bet: i128 = env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::PoolMinBet(pool_id))
                .unwrap_or(DEFAULT_MIN_BET_STROOPS);
            let max_bet: i128 = env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::PoolMaxBet(pool_id))
                .unwrap_or(DEFAULT_MAX_BET_STROOPS);
            if min_bet > 0 && remaining < min_bet {
                return Err(ContractError::InvalidBetAmount);
            }
            if max_bet > 0 && remaining > max_bet {
                return Err(ContractError::InvalidBetAmount);
            }
        }

        // Reduce the relevant outcome total.
        let mut totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let current_outcome_total = totals.get(outcome).unwrap();
        totals.set(
            outcome,
            current_outcome_total
                .checked_sub(amount)
                .ok_or(ContractError::InvalidBetAmount)?,
        );

        // Mirror `place_bet`: outcome 0 maps to total_a, every other outcome to
        // total_b, so cancellation exactly undoes what the bet added.
        if outcome == 0 {
            pool.total_a = pool
                .total_a
                .checked_sub(amount)
                .ok_or(ContractError::InvalidBetAmount)?;
            user_bet.amount_a = user_bet
                .amount_a
                .checked_sub(amount)
                .ok_or(ContractError::InvalidBetAmount)?;
        } else {
            pool.total_b = pool
                .total_b
                .checked_sub(amount)
                .ok_or(ContractError::InvalidBetAmount)?;
            user_bet.amount_b = user_bet
                .amount_b
                .checked_sub(amount)
                .ok_or(ContractError::InvalidBetAmount)?;
        }
        user_bet.total_bet = user_bet
            .total_bet
            .checked_sub(amount)
            .ok_or(ContractError::InvalidBetAmount)?;
        outcome_bets.set(outcome, remaining);

        // Refund the cancelled stake to the user.
        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        // Persist pool + outcome totals. `participant_count` is intentionally
        // left untouched, even when the user's position drops to zero.
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage()
            .persistent()
            .set(&DataKey::PoolOutcomeTotals(pool_id), &totals);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolOutcomeTotals(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        // Persist the user's reduced position.
        env.storage()
            .persistent()
            .set(&DataKey::UserBet(pool_id, user.clone()), &user_bet);
        env.storage().persistent().set(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            &outcome_bets,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::UserBet(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "bet_cancelled"),
                event_version(&env),
                pool_id,
                user.clone(),
            ),
            BetCancelledEvent {
                user,
                pool_id,
                outcome,
                amount,
            },
        );

        Ok(amount)
    }

    /// #160 — Cancel a pool before it is settled.
    /// Cancel a pool and refund all participants.
    ///
    /// Allows:
    /// 1. The creator to cancel the pool before expiry (if status is Open).
    /// 2. The admin to cancel the pool at any time (emergency cancel).
    /// 3. Anyone to trigger cancellation after expiry if the pool hasn't been settled.
    pub fn cancel_pool(
        env: Env,
        caller: Address,
        pool_id: u32,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;

        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        if reason.len() > 256 {
            return Err(ContractError::DescriptionTooLong);
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        match pool.status {
            PoolStatus::Settled(_) => return Err(ContractError::PoolAlreadySettled),
            PoolStatus::Voided => return Err(ContractError::PoolAlreadyVoided),
            PoolStatus::Cancelled => return Err(ContractError::PoolIsCancelled),
            _ => {}
        }

        let admin = Self::get_admin(env.clone());
        let is_admin = admin.is_some() && admin.unwrap() == caller;
        let is_creator = pool.creator == caller;
        let is_expired = env.ledger().timestamp() > pool.expiry;

        let auth_ok = is_admin
            || (is_creator && pool.status == PoolStatus::Open)
            || (is_expired && pool.status == PoolStatus::Open);

        if !auth_ok {
            return Err(ContractError::Unauthorized);
        }

        // Refund all participants (bettors).
        let bettors = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&DataKey::PoolBettors(pool_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut total_refunded: i128 = 0;
        let mut participant_count: u32 = 0;

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        for bettor in bettors.iter() {
            if let Some(user_bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&DataKey::UserBet(pool_id, bettor.clone()))
            {
                let refund = user_bet.total_bet;
                if refund > 0 {
                    token_client.transfer(&env.current_contract_address(), &bettor, &refund);
                    total_refunded = total_refunded.checked_add(refund).unwrap_or(total_refunded);
                    participant_count += 1;
                }
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserBet(pool_id, bettor.clone()));
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserOutcomeBets(pool_id, bettor.clone()));
            }
        }

        pool.status = PoolStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);

        // #189 — cancelled pool must stay accessible for queries/records.
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "cancel_pool"),
                event_version(&env),
                pool_id,
            ),
            PoolCancelledEvent {
                cancelled_by: caller,
                reason,
                total_refunded,
                participant_count,
            },
        );

        Ok(())
    }

    /// Extend an open pool's duration before it expires.
    ///
    /// Gives a market more time to resolve without having to settle/void and
    /// recreate it. The expiry is pushed out by `additional_seconds`, subject to
    /// a hard cap of `MAX_POOL_DURATION_SECS` total lifetime measured from the
    /// pool's `created_at` timestamp.
    ///
    /// # Conditions
    /// * Only the pool creator may extend (`creator.require_auth`).
    /// * Pool must exist and be `Open` (extension is rejected for settled,
    ///   voided, cancelled, frozen, or disputed pools).
    /// * Pool must not have expired yet.
    /// * `additional_seconds` must be positive — duration can only be increased.
    /// * The resulting expiry must not exceed `created_at + MAX_POOL_DURATION_SECS`.
    ///
    /// # Post-conditions
    /// * `pool.expiry` is increased by `additional_seconds`.
    /// * A `pool_duration_extended` event is emitted carrying the new expiry.
    ///
    /// Returns the pool's new expiry timestamp.
    ///
    /// # Errors
    /// * `PoolNotFound` — pool ID does not exist.
    /// * `Unauthorized` — caller is not the pool creator.
    /// * `PoolNotOpen` — pool is not in the `Open` state (covers frozen/disputed).
    /// * `PoolExpired` — pool expiry has already passed.
    /// * `DurationTooShort` — `additional_seconds` is zero.
    /// * `DurationTooLong` — extension would exceed `MAX_POOL_DURATION_SECS`.
    /// * `ExpiryOverflow` — expiry arithmetic overflowed.
    pub fn extend_pool_duration(
        env: Env,
        creator: Address,
        pool_id: u32,
        additional_seconds: u64,
    ) -> Result<u64, ContractError> {
        creator.require_auth();
        Self::require_not_paused(&env)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if creator != pool.creator {
            return Err(ContractError::Unauthorized);
        }

        // Only open pools can be extended — frozen/disputed/settled/voided/
        // cancelled all reject here.
        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }

        if env.ledger().timestamp() >= pool.expiry {
            return Err(ContractError::PoolExpired);
        }

        // Duration can only be increased.
        if additional_seconds == 0 {
            return Err(ContractError::DurationTooShort);
        }

        let new_expiry = pool
            .expiry
            .checked_add(additional_seconds)
            .ok_or(ContractError::ExpiryOverflow)?;

        // Enforce the maximum total lifetime measured from creation.
        let max_expiry = pool
            .created_at
            .checked_add(MAX_POOL_DURATION_SECS)
            .ok_or(ContractError::ExpiryOverflow)?;
        if new_expiry > max_expiry {
            return Err(ContractError::DurationTooLong);
        }

        pool.expiry = new_expiry;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "pool_duration_extended"),
                event_version(&env),
                pool_id,
            ),
            PoolDurationExtendedEvent {
                creator,
                new_expiry,
            },
        );

        Ok(new_expiry)
    }

    /// Assign a delegated settler for a pool. Only the pool creator can call this.
    pub fn assign_settler(
        env: Env,
        creator: Address,
        pool_id: u32,
        settler: Address,
    ) -> Result<(), ContractError> {
        creator.require_auth();

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if creator != pool.creator {
            return Err(ContractError::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::DelegatedSettler(pool_id), &settler);

        env.events().publish(
            (
                Symbol::new(&env, "assign_settler"),
                event_version(&env),
                pool_id,
            ),
            (creator, settler),
        );
        Ok(())
    }

    /// Get the delegated settler for a pool, if one has been assigned.
    pub fn get_delegated_settler(env: Env, pool_id: u32) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::DelegatedSettler(pool_id))
    }

    /// Set the minimum number of participants a pool must have before it can be
    /// settled. A creator could otherwise settle a market with a single
    /// participant (or none); requiring a threshold prevents unfair early
    /// settlement of thin markets.
    ///
    /// Only the treasury recipient may call this. The value persists and applies
    /// to all future `settle_pool` / `settle_pools` calls. Pass 0 to disable the
    /// check entirely. Emits `min_settlement_participants_set`.
    pub fn set_min_settlement_participants(
        env: Env,
        caller: Address,
        min_participants: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        env.storage()
            .persistent()
            .set(&DataKey::MinSettlementParticipants, &min_participants);

        env.events().publish(
            (
                Symbol::new(&env, "min_settlement_participants_set"),
                event_version(&env),
            ),
            min_participants,
        );
        Ok(())
    }

    /// Return the configured minimum participant count required to settle a pool
    /// (defaults to `DEFAULT_MIN_SETTLEMENT_PARTICIPANTS`).
    pub fn get_min_settlement_participants(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::MinSettlementParticipants)
            .unwrap_or(DEFAULT_MIN_SETTLEMENT_PARTICIPANTS)
    }

    /// Internal settlement logic shared by `settle_pool` and `settle_pools`.
    /// Does NOT call `require_auth` — the caller must authenticate before calling.
    fn settle_single_pool(
        env: &Env,
        caller: &Address,
        pool_id: u32,
        winning_outcome: u32,
    ) -> Result<(), ContractError> {
        Self::require_not_paused(env)?;
        Self::require_admin(env, caller)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        let source = SettlementSource::Admin;

        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolAlreadySettled);
        }

        if env.ledger().timestamp() < pool.expiry {
            return Err(ContractError::PoolNotExpired);
        }

        // Block settlement of pools that have not reached the configured minimum
        // participant count, preventing unfair early settlement of thin markets.
        let min_participants = Self::get_min_settlement_participants(env.clone());
        if pool.participant_count < min_participants {
            return Err(ContractError::InsufficientParticipants);
        }

        let outcomes = Self::read_outcomes(env, pool_id, &pool);
        if winning_outcome >= outcomes.len() {
            return Err(ContractError::InvalidOutcome);
        }

        pool.status = PoolStatus::Settled(winning_outcome);
        pool.settled = true;
        pool.winning_outcome = Some(winning_outcome);

        // #171 — compute totals for the enriched settlement event.
        // #167 — use configurable protocol fee instead of hard-coded 2%.
        let totals = Self::read_outcome_totals(env, pool_id, &pool);
        let winning_side_total = totals.get(winning_outcome).unwrap();
        let total_pool_volume = Self::sum_totals(&totals)?;
        // Resolve the fee against any configured volume tiers (flat fee when
        // none apply). When tiers are configured we lock the resolved bps for
        // this pool so winner claims deduct exactly the fee fixed here.
        let fee_bps = Self::resolve_fee_bps_for_volume(env, total_pool_volume);
        let fee_amount = total_pool_volume
            .checked_mul(fee_bps as i128)
            .ok_or(ContractError::PoolTotalOverflow)?
            / 10000;
        if env.storage().persistent().has(&DataKey::VolumeFeeTiers) {
            env.storage()
                .persistent()
                .set(&DataKey::PoolFeeBps(pool_id), &fee_bps);
            env.storage().persistent().extend_ttl(
                &DataKey::PoolFeeBps(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        // #195 — record the market's protocol fee for pool-level reporting.
        env.storage()
            .persistent()
            .set(&DataKey::PoolSettlementProtocolFee(pool_id), &fee_amount);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolSettlementProtocolFee(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        // #176 — persist the settlement source so it can be queried off-chain
        // without replaying event history.
        env.storage()
            .persistent()
            .set(&DataKey::PoolSettlementSource(pool_id), &source);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolSettlementSource(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        // #189 — keep pool accessible for claim operations after settlement.
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        // #176 — emit enriched settlement event including source metadata.
        env.events().publish(
            (Symbol::new(env, "settle_pool"), event_version(env), pool_id),
            SettlePoolEvent {
                caller: caller.clone(),
                winning_outcome,
                winning_side_total,
                total_pool_volume,
                fee_amount,
                source,
            },
        );
        Ok(())
    }

    pub fn settle_pool(
        env: Env,
        caller: Address,
        pool_id: u32,
        winning_outcome: u32,
    ) -> Result<(), ContractError> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        caller.require_auth();
        Self::settle_single_pool(&env, &caller, pool_id, winning_outcome)
    }

    /// #351 — Batch settle multiple expired pools in a single call.
    ///
    /// Accepts up to 20 `(pool_id, winning_outcome)` pairs. Each pool is
    /// validated independently — a failure for one pool does not block others.
    /// Only callers authorized to settle each respective pool may do so.
    ///
    /// Returns a `Vec<SettleResult>` with one entry per requested pool
    /// indicating whether settlement succeeded.
    pub fn settle_pools(
        env: Env,
        caller: Address,
        pools: Vec<PoolSettleRequest>,
    ) -> Vec<SettleResult> {
        caller.require_auth();
        let mut results = Vec::new(&env);
        let cap = if pools.len() > 20 { 20 } else { pools.len() };
        for i in 0..cap {
            let req = pools.get(i).unwrap();
            let success =
                Self::settle_single_pool(&env, &caller, req.pool_id, req.winning_outcome).is_ok();
            results.push_back(SettleResult {
                pool_id: req.pool_id,
                success,
            });
        }
        results
    }

    /// #176 — Return the settlement source for a pool, or `None` if not yet settled.
    pub fn get_settlement_source(env: Env, pool_id: u32) -> Option<SettlementSource> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolSettlementSource(pool_id))
    }

    /// Mark a pool as void. Only the creator may call this before the pool is
    /// settled or already voided. Once voided, users call `claim_refund` to
    /// recover their original stakes in full.
    pub fn void_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if caller != pool.creator {
            return Err(ContractError::Unauthorized);
        }

        match pool.status {
            PoolStatus::Open => {}
            PoolStatus::Voided => return Err(ContractError::PoolAlreadyVoided),
            PoolStatus::Cancelled => return Err(ContractError::PoolIsCancelled),
            _ => return Err(ContractError::PoolCannotBeVoided),
        }

        pool.status = PoolStatus::Voided;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        // #189 — voided pool must stay accessible for refund claims.
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (Symbol::new(&env, "void_pool"), event_version(&env), pool_id),
            caller,
        );
        Ok(())
    }

    /// Refund a user's original stake from a voided or cancelled pool. No fee is taken.
    /// The bet entry is removed after the refund to prevent double-claims.
    pub fn claim_refund(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError> {
        user.require_auth();
        Self::require_not_paused(&env)?;

        // #618 — Multi-asset pools require per-token refund logic.
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Refunds are allowed only for voided or cancelled pools.
        if pool.status != PoolStatus::Voided && pool.status != PoolStatus::Cancelled {
            return Err(ContractError::PoolNotSettled);
        }

        let user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let refund = user_bet.total_bet;
        if refund == 0 {
            return Err(ContractError::NothingToRefund);
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(&env.current_contract_address(), &user, &refund);

        env.storage()
            .persistent()
            .remove(&DataKey::UserBet(pool_id, user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::UserOutcomeBets(pool_id, user.clone()));

        env.events().publish(
            (
                Symbol::new(&env, "claim_refund"),
                event_version(&env),
                pool_id,
                user,
            ),
            refund,
        );

        Ok(refund)
    }

    /// #412 — Claim a refund from an expired but unsettled pool.
    ///
    /// When a pool's expiry timestamp has passed and the creator never called
    /// `settle_pool`, user funds would otherwise be stuck. This function lets
    /// any bettor reclaim their original stake in full — no protocol fee is
    /// deducted (fees only apply to winning payouts).
    ///
    /// # Conditions
    /// * Pool must exist.
    /// * Pool status must be `Open` (not already settled, voided, cancelled, etc.).
    /// * Current ledger timestamp must be strictly greater than `pool.expiry`.
    /// * Caller must have an active bet record in the pool.
    ///
    /// # Post-conditions
    /// * The user's bet record is removed — double-claim is impossible.
    /// * The full `total_bet` amount is transferred back to the user.
    /// * A `claim_expired` event is emitted.
    ///
    /// # Errors
    /// * `PoolNotFound` — pool ID does not exist.
    /// * `PoolNotOpen` — pool is already settled, voided, cancelled, or frozen.
    /// * `PoolNotExpired` — pool expiry has not yet passed.
    /// * `NoBetFound` — caller has no bet in this pool.
    /// * `NothingToRefund` — bet record exists but total_bet is zero.
    pub fn claim_expired(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError> {
        user.require_auth();
        Self::require_not_paused(&env)?;

        // #618 — Multi-asset pools require per-token refund logic.
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Only open (unsettled) pools qualify — any terminal or frozen state is rejected.
        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }

        // Pool must have actually expired.
        if env.ledger().timestamp() <= pool.expiry {
            return Err(ContractError::PoolNotExpired);
        }

        let user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let refund = user_bet.total_bet;
        if refund == 0 {
            return Err(ContractError::NothingToRefund);
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        // Transfer original stake back — no fee deducted.
        token_client.transfer(&env.current_contract_address(), &user, &refund);

        // Remove bet record to prevent double-claim.
        env.storage()
            .persistent()
            .remove(&DataKey::UserBet(pool_id, user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::UserOutcomeBets(pool_id, user.clone()));

        env.events().publish(
            (
                Symbol::new(&env, "claim_expired"),
                event_version(&env),
                pool_id,
                user,
            ),
            refund,
        );

        Ok(refund)
    }

    pub fn refund_expired_pool(env: Env, pool_id: u32) -> Result<(), ContractError> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        Self::require_not_paused(&env)?;

        // #646 — Multi-asset pools hold user stakes in various alternative
        // tokens (PoolTokenDeposit entries), not the base token.  Refunding
        // via DataKey::Token would drain the wrong balance and leave alt-token
        // funds permanently locked.  Callers must use the multi-asset refund
        // path instead.
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }

        if env.ledger().timestamp() < pool.expiry + GRACE_PERIOD_SECS {
            return Err(ContractError::PoolNotExpiredGracePeriod);
        }

        pool.status = PoolStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        let bettors = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&DataKey::PoolBettors(pool_id))
            .unwrap_or_else(|| Vec::new(&env));

        let mut total_refunded: i128 = 0;
        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        for bettor in bettors.iter() {
            if let Some(user_bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&DataKey::UserBet(pool_id, bettor.clone()))
            {
                let refund = user_bet.total_bet;
                if refund > 0 {
                    token_client.transfer(&env.current_contract_address(), &bettor, &refund);
                    total_refunded = total_refunded.checked_add(refund).unwrap_or(total_refunded);
                }
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserBet(pool_id, bettor.clone()));
                env.storage()
                    .persistent()
                    .remove(&DataKey::UserOutcomeBets(pool_id, bettor.clone()));
            }
        }

        env.events().publish(
            (
                Symbol::new(&env, "refund_expired_pool"),
                event_version(&env),
                pool_id,
            ),
            PoolRefundedEvent { total_refunded },
        );

        Ok(())
    }

    /// Claim winnings from a settled pool.
    ///
    /// # Atomicity note (#200)
    /// Soroban transactions are fully atomic: if any step panics the entire
    /// transaction is rolled back, so treasury state and token balances can
    /// never diverge due to a partial execution. The ordering below is
    /// nevertheless chosen to be defensively correct in isolation:
    ///
    ///   1. All reads and validations (no mutations yet).
    ///   2. Token transfer to the winner — if this fails, no state has changed.
    ///   3. Update the per-pool payout state (#158) so reconciliation holds.
    ///   4. Treasury ledger update — fee credited *once* per pool, plus the
    ///      payout-rounding dust on the final claim.
    ///   5. Remove the bet record — prevents any future duplicate-claim attempt.
    ///   6. Emit events — always last so they reflect final committed state.
    ///
    /// # Payout rounding policy (#158)
    /// Per-claim payout is computed via integer floor division:
    ///
    /// ```text
    /// winnings = floor(user_winning_bet * net_pool_balance / pool_winning_total)
    /// ```
    ///
    /// where `net_pool_balance = total_pool_balance - fee` and
    /// `fee = floor(total_pool_balance * 2 / 100)`. Because every claim rounds
    /// down, the sum of winner payouts can be up to `n_winners - 1` token
    /// units below `net_pool_balance`. That residual ("payout dust") is
    /// **swept to the treasury** on the claim that brings the cumulative
    /// claimed winning stake up to `pool_winning_total` (i.e. the final
    /// winner). The 2 % protocol fee is credited to the treasury only on the
    /// **first** claim. After every winner has claimed:
    ///
    /// ```text
    /// total_pool_balance == fee + payout_dust + sum(payouts)
    /// contract_balance_attributable_to_pool == fee + payout_dust
    ///                                       == treasury_credit_for_pool
    /// ```
    ///
    /// See `web/docs/PAYOUT_ROUNDING.md` for indexer / UI guidance.
    pub fn claim_winnings(env: Env, user: Address, pool_id: u32) -> Result<i128, ContractError> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        user.require_auth();
        Self::claim_winnings_internal(&env, user, pool_id)
    }

    fn claim_winnings_internal(
        env: &Env,
        user: Address,
        pool_id: u32,
    ) -> Result<i128, ContractError> {
        Self::require_not_paused(env)?;

        // #481 — Multi-asset pools must use claim_multi_asset_winnings.
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::MultiAssetClaimRequired);
        }

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        let winning_outcome = match pool.status {
            PoolStatus::Settled(outcome) => outcome,
            PoolStatus::Frozen => return Err(ContractError::PoolIsFrozen),
            PoolStatus::Disputed => return Err(ContractError::PoolIsDisputed),
            PoolStatus::Cancelled => return Err(ContractError::PoolIsCancelled),
            _ => return Err(ContractError::PoolNotSettled),
        };

        let user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let user_outcome_bets = Self::read_user_outcome_bets(env, pool_id, user.clone(), &user_bet);
        let user_winning_bet = user_outcome_bets.get(winning_outcome).unwrap_or(0);

        if user_winning_bet == 0 {
            return Err(ContractError::NoWinningsToClaim);
        }

        let totals = Self::read_outcome_totals(env, pool_id, &pool);
        let pool_winning_total = totals.get(winning_outcome).unwrap();
        if pool_winning_total == 0 {
            return Err(ContractError::NoWinningBets);
        }
        let total_pool_balance = Self::sum_totals(&totals)?;
        if total_pool_balance == 0 {
            return Ok(0);
        }

        let fee_bps = Self::pool_effective_fee_bps(env, pool_id);
        let fee = total_pool_balance
            .checked_mul(fee_bps)
            .ok_or(ContractError::PoolTotalOverflow)?
            / 10000;
        let net_pool_balance = total_pool_balance - fee;

        let winnings = user_winning_bet
            .checked_mul(net_pool_balance)
            .ok_or(ContractError::PoolTotalOverflow)?
            / pool_winning_total;

        // #158 — load (or default) the per-pool payout state and figure out
        // (a) whether this is the first claim (so we credit the fee), and
        // (b) whether this is the final claim (so we sweep payout dust).
        // Decide both *before* any mutation so the math is straightforward.
        let mut payout_state: PoolPayoutState = env
            .storage()
            .persistent()
            .get(&DataKey::PoolPayoutState(pool_id))
            .unwrap_or_default();

        let is_first_claim = !payout_state.fee_credited;
        let new_claimed_winning_stake = payout_state.claimed_winning_stake + user_winning_bet;
        let new_paid_out = payout_state.paid_out + winnings;
        let is_final_claim = new_claimed_winning_stake == pool_winning_total;

        // The dust is the residual of the floor-division payouts. By
        // construction it is non-negative and strictly less than `n_winners`
        // token units. It is swept to the treasury exclusively on the final
        // claim so reconciliation `total_pool_balance == fee + dust + sum(payouts)`
        // holds the moment the last winner withdraws.
        let payout_dust: i128 = if is_final_claim {
            net_pool_balance - new_paid_out
        } else {
            0
        };

        // Step 2: update all state BEFORE the external token transfer
        // (checks-effects-interactions pattern). If the transfer below panics,
        // the transaction reverts — but because state was mutated first the bet
        // record is already gone, preventing any retry that could double-claim.

        // Credit the treasury ledger (fee on first claim, dust on final claim).
        let treasury_delta = (if is_first_claim { fee } else { 0 }) + payout_dust;
        if treasury_delta > 0 {
            let current_treasury: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Treasury)
                .unwrap_or(0);
            let next_treasury = current_treasury
                .checked_add(treasury_delta)
                .ok_or(ContractError::TreasuryOverflow)?;
            env.storage()
                .persistent()
                .set(&DataKey::Treasury, &next_treasury);

            // #195 — per-pool attribution must move in lockstep with aggregate Treasury.
            let credit_key = DataKey::PoolTreasuryCredited(pool_id);
            let prev_pool_credit: i128 = env.storage().persistent().get(&credit_key).unwrap_or(0);
            let next_pool_credit = prev_pool_credit
                .checked_add(treasury_delta)
                .ok_or(ContractError::TreasuryOverflow)?;
            env.storage()
                .persistent()
                .set(&credit_key, &next_pool_credit);
            env.storage().persistent().extend_ttl(
                &credit_key,
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        payout_state.claimed_winning_stake = new_claimed_winning_stake;
        payout_state.paid_out = new_paid_out;
        if is_first_claim {
            payout_state.fee_credited = true;
        }
        let payout_key = DataKey::PoolPayoutState(pool_id);
        env.storage().persistent().set(&payout_key, &payout_state);
        env.storage()
            .persistent()
            .extend_ttl(&payout_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

        // Remove the bet record to prevent duplicate claims — must happen
        // before the external transfer so a re-entrant or retried call cannot
        // find the bet record and claim a second time.
        env.storage()
            .persistent()
            .remove(&DataKey::UserBet(pool_id, user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::UserOutcomeBets(pool_id, user.clone()));

        // Step 3: transfer tokens to the winner AFTER all state has been committed.
        // If the transfer panics the transaction reverts, but the bet record is
        // already removed so the invariant holds — no double-claim is possible.
        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(env, &token_address);
        token_client.transfer(&env.current_contract_address(), &user, &winnings);

        // Step 4: emit events in final committed state.
        let analytics_user = user.clone();
        env.events().publish(
            (Symbol::new(env, "claim_winnings"), pool_id, user),
            ClaimEvent {
                amount: winnings,
                fee_amount: fee,
                winning_outcome,
                total_pool_size: total_pool_balance,
            },
        );

        // Step 5: update user analytics.
        let total_key = DataKey::UserTotalClaimed(analytics_user.clone());
        let prev_total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&total_key, &(prev_total + winnings));

        let history_key = DataKey::UserClaimHistory(analytics_user.clone());
        let mut history: Vec<UserClaimEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(env));
        history.push_back(UserClaimEntry {
            pool_id,
            amount: winnings,
            fee,
            timestamp: env.ledger().timestamp(),
            winning_outcome,
        });
        while history.len() > 50 {
            history.remove(0);
        }
        env.storage().persistent().set(&history_key, &history);
        env.storage()
            .persistent()
            .extend_ttl(&history_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        env.storage()
            .persistent()
            .extend_ttl(&total_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

        Ok(winnings)
    }

    pub fn schedule_claim(
        env: Env,
        user: Address,
        pool_id: u32,
        claim_at: u64,
    ) -> Result<u32, ContractError> {
        user.require_auth();
        let now = env.ledger().timestamp();
        if claim_at <= now {
            return Err(ContractError::DurationTooShort);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::ScheduledClaimByUserPool(pool_id, user.clone()))
        {
            return Err(ContractError::RateLimitExceeded);
        }
        env.storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        env.storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ScheduledClaimCounter)
            .unwrap_or(1);
        let entry = ScheduledClaim {
            id,
            pool_id,
            user: user.clone(),
            claim_at,
            status: ScheduledClaimStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledClaim(id), &entry);
        env.storage().persistent().set(
            &DataKey::ScheduledClaimByUserPool(pool_id, user.clone()),
            &id,
        );
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledClaimCounter, &(id + 1));
        env.events().publish(
            (
                Symbol::new(&env, "claim_scheduled"),
                event_version(&env),
                pool_id,
                user,
            ),
            (id, claim_at),
        );
        Ok(id)
    }

    pub fn cancel_scheduled_claim(
        env: Env,
        user: Address,
        scheduled_claim_id: u32,
    ) -> Result<(), ContractError> {
        user.require_auth();
        let mut entry: ScheduledClaim = env
            .storage()
            .persistent()
            .get(&DataKey::ScheduledClaim(scheduled_claim_id))
            .ok_or(ContractError::NoBetFound)?;
        if entry.user != user || entry.status != ScheduledClaimStatus::Pending {
            return Err(ContractError::NoBetFound);
        }
        entry.status = ScheduledClaimStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledClaim(scheduled_claim_id), &entry);
        env.storage()
            .persistent()
            .remove(&DataKey::ScheduledClaimByUserPool(
                entry.pool_id,
                entry.user.clone(),
            ));
        env.events().publish(
            (
                Symbol::new(&env, "scheduled_claim_cancelled"),
                event_version(&env),
                entry.pool_id,
                entry.user,
            ),
            scheduled_claim_id,
        );
        Ok(())
    }

    pub fn execute_scheduled_claims(env: Env) -> Result<Vec<ClaimAllEntry>, ContractError> {
        let now = env.ledger().timestamp();
        let next_id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ScheduledClaimCounter)
            .unwrap_or(1);
        let mut results = Vec::new(&env);
        let mut saw_pending = false;
        let mut id = 1u32;
        while id < next_id && results.len() < SCHEDULED_CLAIM_EXECUTION_CAP {
            let key = DataKey::ScheduledClaim(id);
            if let Some(mut entry) = env.storage().persistent().get::<_, ScheduledClaim>(&key) {
                if entry.status == ScheduledClaimStatus::Pending {
                    saw_pending = true;
                    if entry.claim_at <= now {
                        let amount =
                            Self::claim_winnings_internal(&env, entry.user.clone(), entry.pool_id)?;
                        entry.status = ScheduledClaimStatus::Executed;
                        env.storage().persistent().set(&key, &entry);
                        env.storage()
                            .persistent()
                            .remove(&DataKey::ScheduledClaimByUserPool(
                                entry.pool_id,
                                entry.user.clone(),
                            ));
                        env.events().publish(
                            (
                                Symbol::new(&env, "scheduled_claim_executed"),
                                event_version(&env),
                                entry.pool_id,
                                entry.user,
                            ),
                            (id, amount),
                        );
                        results.push_back(ClaimAllEntry {
                            pool_id: entry.pool_id,
                            amount,
                        });
                    }
                }
            }
            id += 1;
        }
        if results.is_empty() && saw_pending {
            return Err(ContractError::ScheduledClaimNotDue);
        }
        Ok(results)
    }

    pub fn get_scheduled_claims(env: Env, start_id: u32, count: u32) -> Vec<ScheduledClaim> {
        let mut claims = Vec::new(&env);
        let next_id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ScheduledClaimCounter)
            .unwrap_or(1);
        let effective_count = if count > 100 { 100 } else { count };
        for offset in 0..effective_count {
            let id = start_id + offset;
            if id >= next_id {
                break;
            }
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, ScheduledClaim>(&DataKey::ScheduledClaim(id))
            {
                if entry.status == ScheduledClaimStatus::Pending {
                    claims.push_back(entry);
                }
            }
        }
        claims
    }

    /// #194 — Claim winnings from multiple settled pools in a single transaction.
    ///
    /// Delegates each pool to `claim_winnings_internal` so that all safety
    /// invariants, CEI ordering, analytics updates (UserTotalClaimed /
    /// UserClaimHistory), multi-asset guards, and fee/dust accounting are
    /// handled in one canonical place. Pools that are ineligible (not settled,
    /// no winning bet, already claimed, multi-asset) are silently skipped so a
    /// partial batch never reverts the whole transaction.
    ///
    /// Returns a vec of `ClaimAllEntry` (pool_id + amount transferred) for every
    /// pool from which tokens were actually sent. An empty vec means nothing was
    /// claimable. The list is capped at 20 pool IDs per call to bound compute costs.
    pub fn claim_all_winnings(
        env: Env,
        user: Address,
        pool_ids: Vec<u32>,
    ) -> Result<Vec<ClaimAllEntry>, ContractError> {
        user.require_auth();

        let mut results = Vec::new(&env);
        let cap = if pool_ids.len() > 20 {
            20
        } else {
            pool_ids.len()
        };

        for i in 0..cap {
            let pool_id = pool_ids.get(i).ok_or(ContractError::PoolNotFound)?;

            // Skip multi-asset pools — callers must use claim_multi_asset_winnings.
            if env
                .storage()
                .persistent()
                .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
                .unwrap_or(false)
            {
                continue;
            }

            // Skip pools with no settled status, no user bet, or no winning stake.
            // claim_winnings_internal returns a typed error for each — we skip on
            // any error so a single ineligible pool never aborts the whole batch.
            match Self::claim_winnings_internal(&env, user.clone(), pool_id) {
                Ok(amount) => {
                    results.push_back(ClaimAllEntry { pool_id, amount });
                }
                Err(_) => continue,
            }
        }

        Ok(results)
    }

    /// #158 — Return the per-pool payout-tracking state, or `None` if the
    /// pool has not yet had any winners claim. Useful for indexers and UI
    /// previews that want to display pending dust or check whether the
    /// protocol fee has been credited yet.
    pub fn get_pool_payout_state(env: Env, pool_id: u32) -> Option<PoolPayoutState> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolPayoutState(pool_id))
    }

    /// #195 — Return per-pool protocol fee (fixed at settlement) and cumulative
    /// treasury credits from this pool (fee + payout dust), for analytics and audits.
    ///
    /// For multi-asset pools, includes both collected fees (already credited to Treasury)
    /// and pending fees (awaiting collection via collect_multi_asset_fees).
    pub fn get_pool_protocol_revenue(env: Env, pool_id: u32) -> PoolProtocolRevenue {
        let fee_key = DataKey::PoolSettlementProtocolFee(pool_id);
        let credit_key = DataKey::PoolTreasuryCredited(pool_id);
        if env.storage().persistent().has(&fee_key) {
            env.storage()
                .persistent()
                .extend_ttl(&fee_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        }
        if env.storage().persistent().has(&credit_key) {
            env.storage().persistent().extend_ttl(
                &credit_key,
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }
        let settlement_protocol_fee: i128 = env.storage().persistent().get(&fee_key).unwrap_or(0);
        let mut treasury_credited: i128 = env.storage().persistent().get(&credit_key).unwrap_or(0);

        // Include pending multi-asset fees (not yet collected).
        if let Some(allowed) = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&DataKey::PoolAllowedTokens(pool_id))
        {
            let mut pending_normalized: i128 = 0;
            for i in 0..allowed.len() {
                let tok = match allowed.get(i) {
                    Some(t) => t,
                    None => break,
                };
                let fee_t: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolTokenFeePending(pool_id, tok.clone()))
                    .unwrap_or(0);
                if fee_t > 0 {
                    let exchange_rate: i128 = env
                        .storage()
                        .persistent()
                        .get(&DataKey::TokenExchangeRate(tok))
                        .unwrap_or(10_000);
                    let normalized_fee = fee_t * exchange_rate / 10_000;
                    pending_normalized += normalized_fee;
                }
            }
            treasury_credited += pending_normalized;
        }

        PoolProtocolRevenue {
            settlement_protocol_fee,
            treasury_credited,
        }
    }

    /// Return the cumulative total winnings claimed by a user across all pools.
    ///
    /// This is incremented on every successful `claim_winnings`,
    /// `claim_all_winnings`, `execute_scheduled_claims`, and
    /// `claim_multi_asset_winnings` call.
    pub fn get_total_user_claims(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::UserTotalClaimed(user))
            .unwrap_or(0)
    }

    /// Return a paginated slice of a user's claim history.
    ///
    /// Entries are ordered oldest-first (FIFO). The history is capped at the
    /// 50 most recent claims per user; older entries are dropped automatically.
    ///
    /// # Arguments
    /// * `user`         – the claimant address
    /// * `start_cursor` – zero-based index to start from (for pagination)
    /// * `limit`        – maximum entries to return (capped at 20)
    pub fn get_user_claim_history(
        env: Env,
        user: Address,
        start_cursor: u32,
        limit: u32,
    ) -> Vec<UserClaimEntry> {
        let history: Vec<UserClaimEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::UserClaimHistory(user))
            .unwrap_or_else(|| Vec::new(&env));

        let effective_limit = if limit > 20 { 20 } else { limit };
        let mut result = Vec::new(&env);
        let len: u32 = history.len();
        if start_cursor >= len {
            return result;
        }
        let mut end = start_cursor + effective_limit;
        if end > len {
            end = len;
        }
        let mut i = start_cursor;
        while i < end {
            result.push_back(history.get(i).unwrap());
            i += 1;
        }
        result
    }

    /// Return the current treasury balance (credited fees only).
    ///
    /// Note: This returns only fees that have been collected via claim_winnings
    /// (for single-asset pools) or collect_multi_asset_fees (for multi-asset pools).
    /// Pending multi-asset fees awaiting collection are not included here, but can
    /// be viewed per-pool via get_pool_protocol_revenue.
    pub fn get_treasury_balance(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Treasury)
            .unwrap_or(0)
    }

    /// #164 — Return the amount currently withdrawable from the treasury.
    ///
    /// This is the single source of truth for withdrawal eligibility. The
    /// frontend should call this method instead of reimplementing the
    /// validation logic from `withdraw_treasury`. If future versions introduce
    /// reserved balances or per-pool accounting rules, this method will be
    /// updated in lockstep with `withdraw_treasury` so callers remain correct
    /// without any off-chain changes.
    ///
    /// A withdrawal of any amount `a` where `0 < a <= get_withdrawable_treasury()`
    /// is guaranteed to pass the balance check in `withdraw_treasury`.
    pub fn get_withdrawable_treasury(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::Treasury)
            .unwrap_or(0)
    }

    pub fn get_treasury_recipient(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::TreasuryRecipient)
    }

    pub fn set_treasury_withdraw_limit(
        env: Env,
        caller: Address,
        max_withdrawal_per_window: i128,
        withdrawal_window_secs: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if max_withdrawal_per_window < 0
            || (max_withdrawal_per_window == 0 && withdrawal_window_secs > 0)
            || (max_withdrawal_per_window > 0 && withdrawal_window_secs == 0)
        {
            return Err(ContractError::InvalidRateLimitConfig);
        }
        env.storage().persistent().set(
            &DataKey::TreasuryWithdrawalMaxPerWindow,
            &max_withdrawal_per_window,
        );
        env.storage().persistent().set(
            &DataKey::TreasuryWithdrawalWindowSecs,
            &withdrawal_window_secs,
        );
        env.storage()
            .persistent()
            .remove(&DataKey::TreasuryWithdrawalState);
        env.events().publish(
            (
                Symbol::new(&env, "treasury_withdraw_limit_set"),
                event_version(&env),
            ),
            (max_withdrawal_per_window, withdrawal_window_secs),
        );
        Ok(())
    }

    pub fn get_treasury_withdraw_limit(env: Env) -> TreasuryWithdrawalRateLimitConfig {
        TreasuryWithdrawalRateLimitConfig {
            max_withdrawal_per_window: env
                .storage()
                .persistent()
                .get::<_, i128>(&DataKey::TreasuryWithdrawalMaxPerWindow)
                .unwrap_or(0),
            withdrawal_window_secs: env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::TreasuryWithdrawalWindowSecs)
                .unwrap_or(0),
        }
    }

    /// Rotate the treasury recipient address. Only callable by the current treasury recipient.
    /// Emits an event with both old and new addresses for audit trail.
    pub fn rotate_treasury_recipient(
        env: Env,
        caller: Address,
        new_recipient: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let current_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;

        if caller != current_recipient {
            return Err(ContractError::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::TreasuryRecipient, &new_recipient);

        env.events().publish(
            (
                Symbol::new(&env, "treasury_recipient_rotated"),
                event_version(&env),
            ),
            (current_recipient, new_recipient),
        );
        Ok(())
    }

    pub fn withdraw_treasury(env: Env, caller: Address, amount: i128) -> Result<(), ContractError> {
        caller.require_auth();

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;

        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }

        if amount <= 0 {
            return Err(ContractError::InvalidWithdrawalAmount);
        }

        let current_treasury: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Treasury)
            .unwrap_or(0);

        if amount > current_treasury {
            return Err(ContractError::InsufficientTreasuryBalance);
        }

        Self::record_treasury_withdrawal_rate_limit(&env, amount)?;

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);

        token_client.transfer(
            &env.current_contract_address(),
            &treasury_recipient,
            &amount,
        );

        env.storage()
            .persistent()
            .set(&DataKey::Treasury, &(current_treasury - amount));

        env.events().publish(
            (Symbol::new(&env, "treasury_withdrawn"), event_version(&env)),
            (caller.clone(), treasury_recipient, amount),
        );
        Ok(())
    }

    /// Set (or replace) the freeze admin address. Only callable by the treasury recipient.
    pub fn set_freeze_admin(
        env: Env,
        caller: Address,
        freeze_admin: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;

        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }

        env.storage()
            .persistent()
            .set(&DataKey::FreezeAdmin, &freeze_admin);

        env.events().publish(
            (Symbol::new(&env, "freeze_admin_set"), event_version(&env)),
            freeze_admin,
        );
        Ok(())
    }

    /// #632 — Set (or replace) the contract admin address.
    ///
    /// The admin role is a dedicated privileged account separate from the
    /// treasury recipient and freeze admin. Only the treasury recipient may
    /// assign the admin. The admin address is used by `require_admin` for any
    /// operation that needs a contract-level admin check.
    pub fn set_admin(env: Env, caller: Address, admin: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        env.storage().persistent().set(&DataKey::Admin, &admin);

        env.events()
            .publish((Symbol::new(&env, "admin_set"), event_version(&env)), admin);
        Ok(())
    }

    /// #632 — Return the current contract admin address, if one has been set.
    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Admin)
    }

    /// Freeze a pool, blocking new bets and claim payouts.
    /// Callable only by the freeze admin.
    pub fn freeze_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if pool.status == PoolStatus::Frozen {
            return Err(ContractError::PoolIsFrozen);
        }

        pool.status = PoolStatus::Frozen;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "pool_frozen"),
                event_version(&env),
                pool_id,
            ),
            caller,
        );
        Ok(())
    }

    /// Mark a settled pool as disputed, blocking claim payouts pending review.
    /// Callable only by the freeze admin.
    pub fn dispute_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if !matches!(pool.status, PoolStatus::Settled(_)) {
            return Err(ContractError::PoolMustBeSettledToDispute);
        }

        if pool.status == PoolStatus::Disputed {
            return Err(ContractError::PoolIsDisputed);
        }

        pool.status = PoolStatus::Disputed;
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "pool_disputed"),
                event_version(&env),
                pool_id,
            ),
            caller,
        );
        Ok(())
    }

    /// Unfreeze a frozen or disputed pool, restoring it to Open status.
    /// Callable only by the freeze admin.
    pub fn unfreeze_pool(env: Env, caller: Address, pool_id: u32) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_freeze_admin(&env, &caller)?;

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        if pool.status != PoolStatus::Frozen && pool.status != PoolStatus::Disputed {
            return Err(ContractError::PoolNotFrozenOrDisputed);
        }

        pool.status = PoolStatus::Open;
        env.storage()
            .persistent()
            .remove(&DataKey::PoolCoolingUntil(pool_id));
        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "pool_unfrozen"),
                event_version(&env),
                pool_id,
            ),
            caller,
        );
        Ok(())
    }

    /// Treasury admin override for automatic cooling locks.
    pub fn override_pool_cooling(
        env: Env,
        caller: Address,
        pool_id: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }

        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        if pool.status == PoolStatus::Frozen {
            pool.status = PoolStatus::Open;
            env.storage()
                .persistent()
                .set(&DataKey::Pool(pool_id), &pool);
            env.storage().persistent().extend_ttl(
                &DataKey::Pool(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }
        env.storage()
            .persistent()
            .remove(&DataKey::PoolCoolingUntil(pool_id));

        env.events().publish(
            (
                Symbol::new(&env, "pool_cooling_overridden"),
                event_version(&env),
                pool_id,
            ),
            caller,
        );
        Ok(())
    }

    /// Return pool data and extend its TTL on every read so active pools stay
    /// accessible throughout their lifecycle. (#189)
    pub fn get_pool(env: Env, pool_id: u32) -> Option<Pool> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        let pool: Option<Pool> = env.storage().persistent().get(&DataKey::Pool(pool_id));
        if pool.is_some() {
            env.storage().persistent().extend_ttl(
                &DataKey::Pool(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }
        pool
    }

    /// #679 — Return the immutable metadata (name, description) for a pool.
    /// Named `get_pool_info` to avoid collision with the existing
    /// `get_pool_metadata` (which returns the off-chain metadata URI).
    pub fn get_pool_info(env: Env, pool_id: u32) -> Option<PoolInfo> {
        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))?;
        Some(PoolInfo {
            name: pool.title,
            description: pool.description,
        })
    }

    /// #680 — Return the leaderboard for a pool, ordered by total bet descending.
    ///
    /// Supports cursor-based pagination: pass `cursor` as the last seen user address
    /// (or `None` to start from the top). `limit` is capped at 50 entries per call.
    ///
    /// Each entry includes the user address, total bet amount, and whether winnings
    /// have been claimed (for settled pools).
    pub fn get_leaderboard(
        env: Env,
        pool_id: u32,
        limit: u32,
        cursor: Option<Address>,
    ) -> Vec<PoolLeaderboardEntry> {
        let effective_limit = if limit > 50 { 50 } else { limit };
        let mut result = Vec::new(&env);

        let bettors: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PoolBettors(pool_id))
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..bettors.len() {
            let user = bettors.get(i).unwrap();

            // Skip entries before cursor.
            if let Some(ref cursor_addr) = cursor {
                if user == cursor_addr.clone() {
                    continue;
                }
            }

            if let Some(bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            {
                let winnings_claimed =
                    match Self::get_claim_status(env.clone(), pool_id, user.clone()) {
                        ClaimStatus::AlreadyClaimed => true,
                        _ => false,
                    };

                result.push_back(PoolLeaderboardEntry {
                    user,
                    total_bet: bet.total_bet,
                    winnings_claimed,
                });
            }
        }

        // Sort by total_bet descending using a simple bubble sort (Vec has no sort).
        let n = result.len();
        for i in 0..n {
            for j in (i + 1)..n {
                let a = result.get(i).unwrap().total_bet;
                let b = result.get(j).unwrap().total_bet;
                if b > a {
                    let entry_i = result.get(i).unwrap();
                    let entry_j = result.get(j).unwrap();
                    let tmp = entry_i.clone();
                    result.set(i, entry_j.clone());
                    result.set(j, tmp);
                }
            }
        }

        // Apply limit.
        let mut limited = Vec::new(&env);
        let count = if effective_limit < result.len() {
            effective_limit
        } else {
            result.len()
        };
        for i in 0..count {
            limited.push_back(result.get(i).unwrap());
        }
        limited
    }

    /// #635 — Return the template ID used to create this pool, if any.
    ///
    /// Returns `Some(template_id)` when the pool was created via
    /// `create_pool_from_template`, or `None` for pools created directly.
    /// This provides an on-chain way for frontends to determine template
    /// association without off-chain indexing.
    pub fn get_pool_template_id(env: Env, pool_id: u32) -> Option<u32> {
        let pool: Option<Pool> = env.storage().persistent().get(&DataKey::Pool(pool_id));
        pool?.template_id
    }

    /// Return the per-pool bet limits (min/max) used by `place_bet`.
    ///
    /// When min/max were never explicitly set by the admin, returns defaults.
    pub fn get_pool_bet_limits(env: Env, pool_id: u32) -> Option<PoolBetLimits> {
        let pool_exists: Option<Pool> = env.storage().persistent().get(&DataKey::Pool(pool_id));
        pool_exists.as_ref()?;

        let min_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMinBet(pool_id))
            .unwrap_or(DEFAULT_MIN_BET_STROOPS);
        let max_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMaxBet(pool_id))
            .unwrap_or(DEFAULT_MAX_BET_STROOPS);

        // Keep bet limit entries alive while the pool is being queried.
        // Note: legacy pools may not have explicit entries set yet, so guard
        // against missing keys.
        if env
            .storage()
            .persistent()
            .has(&DataKey::PoolMinBet(pool_id))
        {
            env.storage().persistent().extend_ttl(
                &DataKey::PoolMinBet(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::PoolMaxBet(pool_id))
        {
            env.storage().persistent().extend_ttl(
                &DataKey::PoolMaxBet(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        Some(PoolBetLimits { min_bet, max_bet })
    }

    pub fn get_pool_count(env: Env) -> u32 {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        env.storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0)
    }

    /// Get a batch of pools for pagination-friendly listing.
    /// Returns pools from start_id up to count pools (or fewer if some don't exist).
    pub fn get_pools_batch(env: Env, start_id: u32, count: u32) -> Vec<Option<Pool>> {
        let mut pools = Vec::new(&env);
        let pool_count = Self::get_pool_count(env.clone());

        // Early return if start_id is beyond the pool count to prevent overflow
        if start_id > pool_count {
            return pools;
        }

        let effective_count = if count > 100 { 100 } else { count };

        for i in 0..effective_count {
            let pool_id = start_id + i;
            if pool_id > pool_count {
                break;
            }
            let pool = env.storage().persistent().get(&DataKey::Pool(pool_id));
            pools.push_back(pool);
        }

        pools
    }

    /// #411 — Return a paginated slice of pools in insertion order.
    ///
    /// Callable by anyone (no auth required). Pools are returned in ascending
    /// pool-ID order (which matches insertion order since IDs are sequential).
    /// `start` is the 1-based pool ID to begin from; `limit` is capped at 20
    /// to bound ledger reads. Returns an empty vec when `start > pool_count`.
    pub fn list_pools(env: Env, start: u32, limit: u32) -> Vec<Pool> {
        let effective_limit = if limit > 20 { 20 } else { limit };
        let pool_count = Self::get_pool_count(env.clone());

        if start > pool_count || effective_limit == 0 {
            return Vec::new(&env);
        }

        let end = (start + effective_limit).min(pool_count + 1);
        let mut result = Vec::new(&env);
        for pool_id in start..end {
            if let Some(pool) = env
                .storage()
                .persistent()
                .get::<_, Pool>(&DataKey::Pool(pool_id))
            {
                env.storage().persistent().extend_ttl(
                    &DataKey::Pool(pool_id),
                    POOL_BUMP_THRESHOLD,
                    POOL_BUMP_TARGET,
                );
                result.push_back(pool);
            }
        }
        result
    }

    pub fn get_pool_outcomes(env: Env, pool_id: u32) -> Vec<PoolOutcome> {
        let mut result = Vec::new(&env);
        if let Some(pool) = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            let outcomes = Self::read_outcomes(&env, pool_id, &pool);
            let totals = Self::read_outcome_totals(&env, pool_id, &pool);
            for i in 0..outcomes.len() {
                result.push_back(PoolOutcome {
                    index: i,
                    label: outcomes.get(i).unwrap(),
                    total: totals.get(i).unwrap_or(0),
                });
            }
        }
        result
    }

    pub fn get_pool_metadata(env: Env, pool_id: u32) -> Option<String> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolMetadata(pool_id))
    }

    pub fn set_pool_metadata(
        env: Env,
        creator: Address,
        pool_id: u32,
        metadata_uri: Option<String>,
    ) -> Result<(), ContractError> {
        creator.require_auth();
        let pool: Pool = env
            .storage()
            .persistent()
            .get(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        if creator != pool.creator {
            return Err(ContractError::Unauthorized);
        }
        Self::validate_metadata_uri(&metadata_uri)?;
        match metadata_uri {
            Some(uri) => {
                env.storage()
                    .persistent()
                    .set(&DataKey::PoolMetadata(pool_id), &uri);
                env.storage().persistent().extend_ttl(
                    &DataKey::PoolMetadata(pool_id),
                    POOL_BUMP_THRESHOLD,
                    POOL_BUMP_TARGET,
                );
                env.events().publish(
                    (
                        Symbol::new(&env, "pool_metadata_set"),
                        event_version(&env),
                        pool_id,
                    ),
                    uri,
                );
            }
            None => {
                env.storage()
                    .persistent()
                    .remove(&DataKey::PoolMetadata(pool_id));
                env.events().publish(
                    (
                        Symbol::new(&env, "pool_metadata_cleared"),
                        event_version(&env),
                        pool_id,
                    ),
                    creator,
                );
            }
        }
        Ok(())
    }

    pub fn create_pool_template(
        env: Env,
        caller: Address,
        title: String,
        description: String,
        outcomes: Vec<String>,
        duration: u64,
        metadata_uri: Option<String>,
        is_public: bool,
    ) -> Result<u32, ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if title.len() > MAX_TITLE_LENGTH {
            return Err(ContractError::TitleTooLong);
        }
        Self::validate_non_empty_string(
            &title,
            ContractError::TitleEmpty,
            ContractError::StringWhitespaceOnly,
        )?;
        if description.len() > MAX_DESCRIPTION_LENGTH {
            return Err(ContractError::DescriptionTooLong);
        }
        Self::validate_non_empty_string(
            &description,
            ContractError::DescriptionEmpty,
            ContractError::StringWhitespaceOnly,
        )?;
        Self::validate_outcomes(&env, &outcomes)?;
        Self::validate_metadata_uri(&metadata_uri)?;
        if duration < MIN_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooShort);
        }
        if duration == 0 || duration > MAX_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooLong);
        }

        let template_id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::PoolTemplateCounter)
            .unwrap_or(1);
        let template = PoolTemplate {
            id: template_id,
            title,
            description,
            outcomes,
            duration,
            metadata_uri,
            is_public,
        };
        env.storage()
            .persistent()
            .set(&DataKey::PoolTemplate(template_id), &template);
        env.storage()
            .persistent()
            .set(&DataKey::PoolTemplateCounter, &(template_id + 1));
        env.events().publish(
            (
                Symbol::new(&env, "pool_template_created"),
                event_version(&env),
                template_id,
            ),
            caller,
        );
        Ok(template_id)
    }

    pub fn update_pool_template(
        env: Env,
        caller: Address,
        template_id: u32,
        template: PoolTemplate,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if !env
            .storage()
            .persistent()
            .has(&DataKey::PoolTemplate(template_id))
        {
            return Err(ContractError::PoolNotFound);
        }
        if template.title.len() > MAX_TITLE_LENGTH {
            return Err(ContractError::TitleTooLong);
        }
        Self::validate_non_empty_string(
            &template.title,
            ContractError::TitleEmpty,
            ContractError::StringWhitespaceOnly,
        )?;
        if template.description.len() > MAX_DESCRIPTION_LENGTH {
            return Err(ContractError::DescriptionTooLong);
        }
        Self::validate_non_empty_string(
            &template.description,
            ContractError::DescriptionEmpty,
            ContractError::StringWhitespaceOnly,
        )?;
        Self::validate_outcomes(&env, &template.outcomes)?;
        Self::validate_metadata_uri(&template.metadata_uri)?;
        if template.duration < MIN_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooShort);
        }
        if template.duration == 0 || template.duration > MAX_POOL_DURATION_SECS {
            return Err(ContractError::DurationTooLong);
        }
        let saved = PoolTemplate {
            id: template_id,
            title: template.title,
            description: template.description,
            outcomes: template.outcomes,
            duration: template.duration,
            metadata_uri: template.metadata_uri,
            is_public: template.is_public,
        };
        env.storage()
            .persistent()
            .set(&DataKey::PoolTemplate(template_id), &saved);
        env.events().publish(
            (
                Symbol::new(&env, "pool_template_updated"),
                event_version(&env),
                template_id,
            ),
            caller,
        );
        Ok(())
    }

    pub fn delete_pool_template(
        env: Env,
        caller: Address,
        template_id: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if !env
            .storage()
            .persistent()
            .has(&DataKey::PoolTemplate(template_id))
        {
            return Err(ContractError::PoolNotFound);
        }
        env.storage()
            .persistent()
            .remove(&DataKey::PoolTemplate(template_id));
        env.events().publish(
            (
                Symbol::new(&env, "pool_template_deleted"),
                event_version(&env),
                template_id,
            ),
            caller,
        );
        Ok(())
    }

    pub fn get_templates(env: Env) -> Vec<PoolTemplate> {
        let mut templates = Vec::new(&env);
        let next_id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::PoolTemplateCounter)
            .unwrap_or(1);
        let mut id = 1u32;
        while id < next_id && templates.len() < 50 {
            if let Some(template) = env
                .storage()
                .persistent()
                .get::<_, PoolTemplate>(&DataKey::PoolTemplate(id))
            {
                templates.push_back(template);
            }
            id += 1;
        }
        templates
    }

    pub fn get_public_templates(env: Env) -> Vec<PoolTemplate> {
        let next_id = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::PoolTemplateCounter)
            .unwrap_or(1);
        let mut public_templates = Vec::new(&env);
        let mut id = 1u32;
        while id < next_id {
            if let Some(t) = env
                .storage()
                .persistent()
                .get::<_, PoolTemplate>(&DataKey::PoolTemplate(id))
            {
                if t.is_public {
                    public_templates.push_back(t);
                }
            }
            id += 1;
        }
        public_templates
    }

    pub fn create_pool_from_template(
        env: Env,
        creator: Address,
        template_id: u32,
        overrides: PoolTemplateOverrides,
    ) -> Result<u32, ContractError> {
        creator.require_auth();
        let template: PoolTemplate = env
            .storage()
            .persistent()
            .get(&DataKey::PoolTemplate(template_id))
            .ok_or(ContractError::PoolNotFound)?;
        let title = overrides.title.unwrap_or(template.title);
        let description = overrides.description.unwrap_or(template.description);
        let outcomes = overrides.outcomes.unwrap_or(template.outcomes);
        let duration = overrides.duration.unwrap_or(template.duration);
        let metadata_uri = overrides.metadata_uri.or(template.metadata_uri);
        let pool_id = Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            metadata_uri,
            env.ledger().timestamp(),
            PoolStatus::Open,
            DEFAULT_TWAP_PERIOD_SECS,
            Some(template_id),
        )?;
        env.events().publish(
            (
                Symbol::new(&env, "pool_created_from_template"),
                event_version(&env),
                template_id,
                pool_id,
            ),
            (),
        );
        Ok(pool_id)
    }

    /// #172 — Scan a bounded range of pools and return all positions the user
    /// holds within that range.
    ///
    /// The scan checks pools `[start_id, start_id + count)` and returns a
    /// `UserPoolPosition` entry for each pool where the user has an active bet
    /// record. Claimed positions are not included because the bet record is
    /// removed after a successful claim.
    ///
    /// The result is capped at 100 pools per call to bound compute costs.
    /// Callers should paginate with successive `start_id` values to walk the
    /// full pool space.
    ///
    /// # Arguments
    /// * `user`     – the address whose positions are queried
    /// * `start_id` – first pool ID to scan (inclusive)
    /// * `count`    – number of pool IDs to scan; capped at 100
    ///
    /// # Returns
    /// A `Vec<UserPoolPosition>` containing one entry per pool where `user` has
    /// an unclaimed position. The entries appear in ascending `pool_id` order.
    /// An empty vec means the user has no open positions in the scanned range.
    pub fn get_user_pools(
        env: Env,
        user: Address,
        start_id: u32,
        count: u32,
    ) -> Vec<UserPoolPosition> {
        let mut result = Vec::new(&env);
        let pool_count = Self::get_pool_count(env.clone());

        // Early return if start_id is beyond the pool count to prevent overflow
        if start_id > pool_count {
            return result;
        }

        let effective_count = if count > 100 { 100 } else { count };

        for i in 0..effective_count {
            let pool_id = start_id + i;
            if pool_id > pool_count {
                break;
            }
            let key = DataKey::UserBet(pool_id, user.clone());
            if let Some(bet) = env.storage().persistent().get::<_, UserBet>(&key) {
                // #189 — extend position TTL on read so dashboard queries keep entries alive.
                env.storage()
                    .persistent()
                    .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
                result.push_back(UserPoolPosition {
                    pool_id,
                    amount_a: bet.amount_a,
                    amount_b: bet.amount_b,
                    total_bet: bet.total_bet,
                });
            }
        }

        result
    }

    fn is_initialized(env: &Env) -> bool {
        env.storage().persistent().has(&DataKey::Token)
    }

    fn get_pool_counter(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0)
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    fn require_freeze_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let freeze_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::FreezeAdmin)
            .ok_or(ContractError::FreezeAdminNotSet)?;
        if caller != &freeze_admin {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        if caller != &admin {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn require_treasury_recipient(env: &Env, caller: &Address) -> Result<(), ContractError> {
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != &treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn record_treasury_withdrawal_rate_limit(env: &Env, amount: i128) -> Result<(), ContractError> {
        let max_per_window: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::TreasuryWithdrawalMaxPerWindow)
            .unwrap_or(0);
        let window_secs: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::TreasuryWithdrawalWindowSecs)
            .unwrap_or(0);
        if max_per_window == 0 || window_secs == 0 {
            return Ok(());
        }

        let now = env.ledger().timestamp();
        let mut state = env
            .storage()
            .persistent()
            .get::<_, TreasuryWithdrawalRateLimitState>(&DataKey::TreasuryWithdrawalState)
            .unwrap_or(TreasuryWithdrawalRateLimitState {
                window_start: now,
                used: 0,
            });
        if now.saturating_sub(state.window_start) >= window_secs {
            state.window_start = now;
            state.used = 0;
        }
        let next_used = state
            .used
            .checked_add(amount)
            .ok_or(ContractError::RateLimitExceeded)?;
        if next_used > max_per_window {
            return Err(ContractError::RateLimitExceeded);
        }
        state.used = next_used;
        env.storage()
            .persistent()
            .set(&DataKey::TreasuryWithdrawalState, &state);
        Ok(())
    }

    /// #350 — Pause or unpause the contract. Only the treasury recipient may call this.
    /// While paused, sensitive operations (place_bet, settle_pool, claim_winnings,
    /// claim_refund, void_pool) are blocked. Treasury withdrawals and admin functions
    /// remain operational.
    pub fn set_paused(env: Env, caller: Address, paused: bool) -> Result<(), ContractError> {
        caller.require_auth();
        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;
        if caller != treasury_recipient {
            return Err(ContractError::Unauthorized);
        }
        env.storage().persistent().set(&DataKey::Paused, &paused);

        let event_name = if paused {
            Symbol::new(&env, "contract_paused")
        } else {
            Symbol::new(&env, "contract_unpaused")
        };
        env.events()
            .publish((event_name, event_version(&env)), caller);
        Ok(())
    }

    /// #456 — Pause the contract. Convenience wrapper around `set_paused(true)`.
    /// Only the treasury recipient (admin) may call this.
    /// Emits a `PoolPaused` event.
    pub fn pause_contract(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        env.storage().persistent().set(&DataKey::Paused, &true);
        env.events().publish(
            (Symbol::new(&env, "PoolPaused"), event_version(&env)),
            caller,
        );
        Ok(())
    }

    /// #456 — Unpause the contract. Convenience wrapper around `set_paused(false)`.
    /// Only the treasury recipient (admin) may call this.
    /// Emits a `PoolUnpaused` event.
    pub fn unpause_contract(env: Env, caller: Address) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        env.storage().persistent().set(&DataKey::Paused, &false);
        env.events().publish(
            (Symbol::new(&env, "PoolUnpaused"), event_version(&env)),
            caller,
        );
        Ok(())
    }

    /// Return whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Return the user's bet record and extend its TTL on every read. (#189)
    pub fn get_user_bet(env: Env, pool_id: u32, user: Address) -> Option<UserBet> {
        if !Self::is_initialized(&env) {
            panic_with_error!(&env, ContractError::NotInitialized);
        }
        let key = DataKey::UserBet(pool_id, user);
        let bet: Option<UserBet> = env.storage().persistent().get(&key);
        if bet.is_some() {
            env.storage()
                .persistent()
                .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        }
        bet
    }

    /// Return the claim status for `user` in `pool_id`.
    ///
    /// | Pool state  | Bet record present?        | Result            |
    /// |-------------|----------------------------|-------------------|
    /// | Any         | No                         | NeverBet or AlreadyClaimed* |
    /// | Open        | Yes                        | NotEligible (not yet settleable) |
    /// | Settled(w)  | Yes, bet on winning side   | Claimable         |
    /// | Settled(w)  | Yes, bet on losing side    | NotEligible       |
    /// | Voided      | Yes                        | RefundClaimable   |
    /// | Cancelled   | Yes                        | RefundClaimable   |
    /// | Any         | No (was removed by claim)  | AlreadyClaimed**  |
    ///
    /// */**  Once a claim is made the bet record is deleted, so the method
    /// returns `AlreadyClaimed` when the pool is settled/voided but no record
    /// exists — distinguishing it from `NeverBet` (pool still open/cancelled).
    pub fn get_claim_status(env: Env, pool_id: u32, user: Address) -> ClaimStatus {
        let pool = match env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            Some(p) => p,
            None => return ClaimStatus::NeverBet,
        };

        let bet: Option<UserBet> = env
            .storage()
            .persistent()
            .get(&DataKey::UserBet(pool_id, user.clone()));

        match pool.status {
            PoolStatus::Cancelled => match bet {
                Some(_) => ClaimStatus::RefundClaimable,
                None => ClaimStatus::AlreadyClaimed,
            },
            PoolStatus::Voided => match bet {
                Some(_) => ClaimStatus::RefundClaimable,
                None => ClaimStatus::AlreadyClaimed,
            },
            PoolStatus::Settled(winning_outcome) => match bet {
                None => ClaimStatus::AlreadyClaimed,
                Some(b) => {
                    let outcome_bets = Self::read_user_outcome_bets(&env, pool_id, user, &b);
                    let winning_stake = outcome_bets.get(winning_outcome).unwrap_or(0);
                    if winning_stake > 0 {
                        ClaimStatus::Claimable
                    } else {
                        ClaimStatus::NotEligible
                    }
                }
            },
            _ => match bet {
                Some(_) => ClaimStatus::NotEligible,
                None => ClaimStatus::NeverBet,
            },
        }
    }

    /// #159 — Read-only payout preview for a user in a given pool.
    ///
    /// Returns a `ClaimPreview` that the frontend can use to display the
    /// claimable amount or explain why nothing is claimable, without
    /// reimplementing payout logic off-chain.
    ///
    /// The `Claimable(amount)` value is computed with the same formula used by
    /// `claim_winnings`, so the preview is always exact for settled pools.
    ///
    /// | Pool status          | Bet record          | Result              |
    /// |----------------------|---------------------|---------------------|
    /// | Open / Frozen /      | any                 | Unclaimable         |
    /// | Disputed             |                     |                     |
    /// | Cancelled            | absent / claimed    | NeverBet            |
    /// | Cancelled            | present             | Claimable(total_bet)|
    /// | Voided               | absent / claimed    | NeverBet            |
    /// | Voided               | present             | Claimable(total_bet)|
    /// | Settled(w)           | absent / claimed    | NeverBet            |
    /// | Settled(w)           | losing side only    | NotEligible         |
    /// | Settled(w)           | winning side > 0    | Claimable(amount)   |
    pub fn preview_claimable_amount(env: Env, pool_id: u32, user: Address) -> ClaimPreview {
        let pool = match env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            Some(p) => p,
            None => return ClaimPreview::Unclaimable,
        };

        let winning_outcome = match pool.status {
            PoolStatus::Settled(outcome) => outcome,
            PoolStatus::Voided | PoolStatus::Cancelled => {
                // For voided/cancelled pools, return the user's total bet as refund
                let bet: UserBet = match env
                    .storage()
                    .persistent()
                    .get(&DataKey::UserBet(pool_id, user))
                {
                    Some(b) => b,
                    None => return ClaimPreview::NeverBet,
                };
                return ClaimPreview::Claimable(bet.total_bet);
            }
            _ => return ClaimPreview::Unclaimable,
        };

        let bet: UserBet = match env
            .storage()
            .persistent()
            .get(&DataKey::UserBet(pool_id, user.clone()))
        {
            Some(b) => b,
            None => return ClaimPreview::NeverBet,
        };

        let outcome_bets = Self::read_user_outcome_bets(&env, pool_id, user, &bet);
        let user_winning_bet = outcome_bets.get(winning_outcome).unwrap_or(0);

        if user_winning_bet == 0 {
            return ClaimPreview::NotEligible;
        }

        let totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let pool_winning_total = totals.get(winning_outcome).unwrap();
        if pool_winning_total == 0 {
            return ClaimPreview::Unclaimable;
        }
        let total_pool_balance = match Self::sum_totals(&totals) {
            Ok(total) => total,
            Err(_) => return ClaimPreview::Unclaimable,
        };
        if total_pool_balance == 0 {
            return ClaimPreview::Claimable(0);
        }
        let fee_bps = Self::pool_effective_fee_bps(&env, pool_id);
        let fee = match total_pool_balance.checked_mul(fee_bps) {
            Some(f) => f / 10000,
            None => return ClaimPreview::Unclaimable,
        };
        let net_pool_balance = total_pool_balance - fee;
        let amount = match user_winning_bet.checked_mul(net_pool_balance) {
            Some(a) => a / pool_winning_total,
            None => return ClaimPreview::Unclaimable,
        };

        ClaimPreview::Claimable(amount)
    }

    pub fn get_participant_count(env: Env, pool_id: u32) -> u32 {
        env.storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .map(|p| p.participant_count)
            .unwrap_or(0)
    }

    /// Return the cumulative betting volume for a single pool.
    ///
    /// This is the lifetime sum of every `place_bet` amount on the pool and is
    /// not reduced by settlement or claims. Returns 0 for unknown pools.
    pub fn get_pool_volume(env: Env, pool_id: u32) -> i128 {
        env.storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .map(|p| p.cumulative_volume)
            .unwrap_or(0)
    }

    /// Return the contract-wide cumulative betting volume across all pools.
    ///
    /// Incremented by every `place_bet` and never decremented, providing an
    /// on-chain total-volume figure for frontends without an off-chain indexer.
    pub fn get_total_contract_volume(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::TotalContractVolume)
            .unwrap_or(0)
    }

    /// Return the contract-wide cumulative betting volume across all pools.
    ///
    /// Public alias for `get_total_contract_volume` so frontends that call
    /// `get_total_volume` have a stable entry point. Both functions read the
    /// same `DataKey::TotalContractVolume` accumulator, which is incremented
    /// by every `place_bet` and never decremented.
    pub fn get_total_volume(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::TotalContractVolume)
            .unwrap_or(0)
    }

    // ── #420 Referral tracking ────────────────────────────────────────────────

    /// Set the referral fee in basis points. 0 disables referrals.
    /// Only callable by the treasury recipient. Max 1000 bps (10%).
    pub fn set_referral_bps(env: Env, caller: Address, bps: u32) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;
        if bps > PROTOCOL_FEE_MAX_BPS {
            return Err(ContractError::FeeOutOfBounds);
        }
        env.storage().persistent().set(&DataKey::ReferralBps, &bps);
        env.events().publish(
            (Symbol::new(&env, "referral_bps_set"), event_version(&env)),
            (caller, bps),
        );
        Ok(())
    }

    /// Return the current referral fee in basis points (0 = disabled).
    pub fn get_referral_bps(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<_, u32>(&DataKey::ReferralBps)
            .unwrap_or(0)
    }

    /// Place a bet with an optional referrer. When referral_bps > 0 and a
    /// referrer is provided, `referral_bps` of the bet amount is credited to
    /// the referrer's claimable balance. Self-referral is rejected.
    pub fn place_bet_with_referral(
        env: Env,
        user: Address,
        pool_id: u32,
        outcome: u32,
        amount: i128,
        referrer: Address,
    ) -> Result<(), ContractError> {
        if user == referrer {
            return Err(ContractError::SelfReferral);
        }

        let bps = Self::get_referral_bps(env.clone());

        // Delegate to place_bet (which handles all pool/bet validation).
        Self::place_bet(
            env.clone(),
            user,
            pool_id,
            outcome,
            amount,
            Some(referrer.clone()),
        )?;

        // Credit referral reward if bps > 0.
        if bps > 0 {
            let reward = (amount * bps as i128) / 10_000;
            if reward > 0 {
                let key = DataKey::ReferralBalance(referrer.clone());
                let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
                let next = current
                    .checked_add(reward)
                    .ok_or(ContractError::TreasuryOverflow)?;
                env.storage().persistent().set(&key, &next);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

                let total: i128 = env
                    .storage()
                    .persistent()
                    .get::<_, i128>(&DataKey::TotalReferralVolume)
                    .unwrap_or(0)
                    .checked_add(amount)
                    .ok_or(ContractError::TreasuryOverflow)?;
                env.storage()
                    .persistent()
                    .set(&DataKey::TotalReferralVolume, &total);
            }
        }
        Ok(())
    }

    /// Claim all accumulated referral rewards for the caller.
    /// Transfers the balance from the contract to the referrer and resets it.
    pub fn claim_referral_rewards(env: Env, referrer: Address) -> Result<i128, ContractError> {
        referrer.require_auth();
        let key = DataKey::ReferralBalance(referrer.clone());
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if balance == 0 {
            return Err(ContractError::NoReferralRewards);
        }

        let token_address = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &referrer, &balance);

        env.storage().persistent().remove(&key);

        env.events().publish(
            (
                Symbol::new(&env, "referral_reward_claimed"),
                event_version(&env),
            ),
            ReferralRewardClaimedEvent {
                referrer,
                amount: balance,
            },
        );
        Ok(balance)
    }

    /// Return the pending referral reward balance for `referrer`.
    pub fn get_referrer_balance(env: Env, referrer: Address) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::ReferralBalance(referrer))
            .unwrap_or(0)
    }

    /// Return the contract-wide cumulative volume of referred bets.
    pub fn get_total_referral_volume(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get::<_, i128>(&DataKey::TotalReferralVolume)
            .unwrap_or(0)
    }

    // ── #396 Webhook management ───────────────────────────────────────────────

    /// Register (or update) an off-chain webhook subscription.
    ///
    /// Only callable by the treasury recipient. The `url` must start with
    /// `https://` and be at most 512 bytes long. A maximum of 10 webhooks may
    /// be registered per contract. If a webhook with the same URL already
    /// exists its event-type list is replaced in-place (does not count toward
    /// the cap). Emits a `webhook_registered` event on success.
    pub fn register_webhook(
        env: Env,
        caller: Address,
        url: String,
        event_types: Vec<WebhookEventType>,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        // URL must be HTTPS and within the length cap.
        if url.len() > MAX_WEBHOOK_URL_LENGTH || !Self::string_starts_with(&url, b"https://") {
            return Err(ContractError::InvalidWebhookUrl);
        }

        let mut webhooks: Vec<Webhook> = env
            .storage()
            .persistent()
            .get(&DataKey::Webhooks)
            .unwrap_or_else(|| Vec::new(&env));

        // Check for an existing entry with the same URL; replace it in-place.
        let mut replaced = false;
        let mut i = 0u32;
        while i < webhooks.len() {
            let existing = webhooks.get(i).unwrap();
            if existing.url == url {
                webhooks.set(
                    i,
                    Webhook {
                        url: url.clone(),
                        event_types: event_types.clone(),
                    },
                );
                replaced = true;
                break;
            }
            i += 1;
        }

        // No existing entry — enforce the 10-webhook cap before inserting.
        if !replaced {
            if webhooks.len() >= MAX_WEBHOOKS {
                return Err(ContractError::WebhookLimitReached);
            }
            webhooks.push_back(Webhook {
                url: url.clone(),
                event_types: event_types.clone(),
            });
        }

        env.storage()
            .persistent()
            .set(&DataKey::Webhooks, &webhooks);
        env.storage().persistent().extend_ttl(
            &DataKey::Webhooks,
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (Symbol::new(&env, "webhook_registered"), event_version(&env)),
            (url, event_types.len()),
        );
        Ok(())
    }

    /// Remove a previously registered webhook by its URL.
    ///
    /// Only callable by the treasury recipient. Returns `WebhookNotFound` when
    /// no entry matches. Emits a `webhook_unregistered` event on success.
    pub fn unregister_webhook(env: Env, caller: Address, url: String) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        let mut webhooks: Vec<Webhook> = env
            .storage()
            .persistent()
            .get(&DataKey::Webhooks)
            .unwrap_or_else(|| Vec::new(&env));

        let mut found_index: Option<u32> = None;
        let mut i = 0u32;
        while i < webhooks.len() {
            if webhooks.get(i).unwrap().url == url {
                found_index = Some(i);
                break;
            }
            i += 1;
        }

        let idx = found_index.ok_or(ContractError::WebhookNotFound)?;
        webhooks.remove(idx);

        if webhooks.is_empty() {
            env.storage().persistent().remove(&DataKey::Webhooks);
        } else {
            env.storage()
                .persistent()
                .set(&DataKey::Webhooks, &webhooks);
            env.storage().persistent().extend_ttl(
                &DataKey::Webhooks,
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        env.events().publish(
            (
                Symbol::new(&env, "webhook_unregistered"),
                event_version(&env),
            ),
            url,
        );
        Ok(())
    }

    /// Return all currently registered webhooks.
    ///
    /// Returns an empty `Vec` when no webhooks have been registered.
    pub fn get_webhooks(env: Env) -> Vec<Webhook> {
        env.storage()
            .persistent()
            .get(&DataKey::Webhooks)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // ── #481 Multi-Asset Pool Functions ──────────────────────────────────────

    /// Set the exchange rate for a token relative to the base token.
    ///
    /// Rate convention: `rate_bps` represents how many base-token units equal
    /// one unit of `token`, scaled by 10_000.
    /// Example: `rate_bps = 5_000` → 1 alt-token = 0.5 base tokens.
    ///
    /// Only callable by the treasury recipient. Must be set before `token` can
    /// appear in any multi-asset pool's allowed-token list.
    pub fn set_token_exchange_rate(
        env: Env,
        caller: Address,
        token: Address,
        rate_bps: i128,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        if rate_bps <= 0 {
            return Err(ContractError::FeeOutOfBounds);
        }

        env.storage()
            .persistent()
            .set(&DataKey::TokenExchangeRate(token.clone()), &rate_bps);

        env.events().publish(
            (Symbol::new(&env, "token_rate_set"), event_version(&env)),
            (token, rate_bps),
        );
        Ok(())
    }

    /// Return the exchange rate (in bps) for `token`, or `None` if not set.
    pub fn get_token_exchange_rate(env: Env, token: Address) -> Option<i128> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenExchangeRate(token))
    }

    /// Create a multi-asset prediction pool that accepts bets in any of the
    /// specified token addresses.
    ///
    /// All tokens in `allowed_tokens` must already have an exchange rate set via
    /// `set_token_exchange_rate`. The list must be non-empty and contain no
    /// duplicate addresses. Pool creation fees apply as normal.
    pub fn create_multi_asset_pool(
        env: Env,
        creator: Address,
        title: String,
        description: String,
        outcomes: Vec<String>,
        duration: u64,
        allowed_tokens: Vec<Address>,
        metadata_uri: Option<String>,
    ) -> Result<u32, ContractError> {
        creator.require_auth();

        if allowed_tokens.is_empty() {
            return Err(ContractError::NotInitialized);
        }

        // Dedup check and exchange-rate presence check.
        let mut seen: Vec<Address> = Vec::new(&env);
        for i in 0..allowed_tokens.len() {
            let tok = allowed_tokens.get(i).ok_or(ContractError::PoolNotFound)?;
            for j in 0..seen.len() {
                if seen.get(j).ok_or(ContractError::PoolNotFound)? == tok {
                    return Err(ContractError::DuplicateToken);
                }
            }
            if !env
                .storage()
                .persistent()
                .has(&DataKey::TokenExchangeRate(tok.clone()))
            {
                return Err(ContractError::ExchangeRateNotSet);
            }
            seen.push_back(tok);
        }

        let pool_id = Self::create_pool_internal(
            &env,
            creator,
            title,
            description,
            outcomes,
            duration,
            metadata_uri,
            env.ledger().timestamp(),
            PoolStatus::Open,
            DEFAULT_TWAP_PERIOD_SECS,
            None,
        )?;
        env.storage()
            .persistent()
            .set(&DataKey::PoolAllowedTokens(pool_id), &allowed_tokens);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolAllowedTokens(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage()
            .persistent()
            .set(&DataKey::PoolIsMultiAsset(pool_id), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::PoolIsMultiAsset(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        Ok(pool_id)
    }

    /// Return the list of allowed token addresses for a multi-asset pool, or
    /// `None` for single-asset pools.
    pub fn get_pool_allowed_tokens(env: Env, pool_id: u32) -> Option<Vec<Address>> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolAllowedTokens(pool_id))
    }

    /// Set per-pool, per-token bet limits for a multi-asset pool.
    ///
    /// `min_bet = 0` disables the lower bound; `max_bet = 0` disables the upper
    /// bound. Only callable by the treasury recipient.
    pub fn set_pool_token_bet_limits(
        env: Env,
        caller: Address,
        pool_id: u32,
        token: Address,
        min_bet: i128,
        max_bet: i128,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::PoolNotFound);
        }

        if min_bet > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::PoolTokenMinBet(pool_id, token.clone()), &min_bet);
        }
        if max_bet > 0 {
            env.storage()
                .persistent()
                .set(&DataKey::PoolTokenMaxBet(pool_id, token), &max_bet);
        }
        Ok(())
    }

    /// Place a bet in a multi-asset pool using the specified `bet_token`.
    ///
    /// The bet amount is normalised to base-token units using the stored
    /// exchange rate before being recorded in pool totals and user positions.
    /// This keeps the odds and proportional-share logic identical to
    /// single-asset pools. The actual `bet_token` tokens are held in escrow.
    ///
    /// Referral events are emitted when a `referrer` is supplied, but no
    /// referral-fee token transfer occurs for multi-asset bets (the bet token
    /// type is ambiguous for the referrer).
    pub fn place_multi_asset_bet(
        env: Env,
        user: Address,
        pool_id: u32,
        outcome: u32,
        amount: i128,
        bet_token: Address,
        referrer: Option<Address>,
    ) -> Result<(), ContractError> {
        user.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(ContractError::InvalidBetAmount);
        }

        // #673 — Enforce contract-wide minimum bet to prevent dust.
        if amount < MIN_BET_AMOUNT {
            return Err(ContractError::BetBelowMinBet);
        }

        // Validate referrer is not the user themselves.
        if let Some(ref ref_addr) = referrer {
            if ref_addr == &user {
                return Err(ContractError::SelfReferral);
            }
        }

        // Pool must be a multi-asset pool.
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::PoolIsMultiAsset(pool_id))
            .unwrap_or(false)
        {
            return Err(ContractError::PoolNotFound);
        }

        // Validate bet_token is in the allowed list.
        let allowed: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PoolAllowedTokens(pool_id))
            .ok_or(ContractError::PoolNotFound)?;
        let mut token_allowed = false;
        for i in 0..allowed.len() {
            if allowed.get(i).ok_or(ContractError::PoolNotFound)? == bet_token {
                token_allowed = true;
                break;
            }
        }
        if !token_allowed {
            return Err(ContractError::UnsupportedToken);
        }

        // Fetch exchange rate.
        let rate_bps: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TokenExchangeRate(bet_token.clone()))
            .ok_or(ContractError::ExchangeRateNotSet)?;

        // Normalise to base units. Use checked_mul to guard against overflow.
        let normalized = amount
            .checked_mul(rate_bps)
            .ok_or(ContractError::PoolTotalOverflow)?
            / 10_000;

        if normalized <= 0 {
            return Err(ContractError::InvalidBetAmount);
        }

        // Per-token min/max limits (checked against raw amount, not normalised).
        let min_bet: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolTokenMinBet(pool_id, bet_token.clone()))
            .unwrap_or(0);
        if min_bet > 0 && amount < min_bet {
            return Err(ContractError::BetBelowMinBet);
        }
        let max_bet: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolTokenMaxBet(pool_id, bet_token.clone()))
            .unwrap_or(0);
        if max_bet > 0 && amount > max_bet {
            return Err(ContractError::BetAboveMaxBet);
        }

        // Enforce pool-wide bet limits (admin-configurable via set_pool_bet_limits).
        // Checked against the normalised amount so the same cap applies uniformly
        // across all accepted tokens, matching the behaviour of single-asset place_bet.
        let pool_min_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMinBet(pool_id))
            .unwrap_or(DEFAULT_MIN_BET_STROOPS);
        let pool_max_bet: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::PoolMaxBet(pool_id))
            .unwrap_or(DEFAULT_MAX_BET_STROOPS);
        if pool_min_bet > 0 && normalized < pool_min_bet {
            return Err(ContractError::BetBelowMinBet);
        }
        // pool_max_bet == 0 => no maximum.
        if pool_max_bet > 0 && normalized > pool_max_bet {
            return Err(ContractError::BetAboveMaxBet);
        }

        // Load and validate pool.
        let mut pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // #615 — Auto-thaw cooling period (same logic as single-asset place_bet).
        if pool.status == PoolStatus::Frozen {
            if let Some(cooling_until) = env
                .storage()
                .persistent()
                .get::<_, u64>(&DataKey::PoolCoolingUntil(pool_id))
            {
                if env.ledger().timestamp() >= cooling_until {
                    pool.status = PoolStatus::Open;
                    env.storage()
                        .persistent()
                        .remove(&DataKey::PoolCoolingUntil(pool_id));
                } else {
                    return Err(ContractError::PoolIsFrozen);
                }
            }
        }

        if pool.status != PoolStatus::Open {
            return Err(ContractError::PoolNotOpen);
        }
        if env.ledger().timestamp() >= pool.expiry {
            return Err(ContractError::PoolExpired);
        }

        let outcomes = Self::read_outcomes(&env, pool_id, &pool);
        if outcome >= outcomes.len() {
            return Err(ContractError::InvalidOutcome);
        }

        // #615 — Per-wallet rate limiting (mirrors single-asset place_bet).
        let max_bets_per_window: u32 = env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::RateLimitMaxBetsPerWindow)
            .unwrap_or(0);
        let window_secs: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::RateLimitWindowSecs)
            .unwrap_or(0);
        if max_bets_per_window > 0 && window_secs > 0 {
            let now = env.ledger().timestamp();
            let key = DataKey::WalletRateLimit(user.clone());
            let mut rate_state = env
                .storage()
                .persistent()
                .get::<_, WalletRateLimitState>(&key)
                .unwrap_or(WalletRateLimitState {
                    window_start: now,
                    used: 0,
                });

            if now.saturating_sub(rate_state.window_start) >= window_secs {
                rate_state.window_start = now;
                rate_state.used = 0;
            }
            if rate_state.used >= max_bets_per_window {
                return Err(ContractError::RateLimitExceeded);
            }
            rate_state.used = rate_state
                .used
                .checked_add(1)
                .ok_or(ContractError::RateLimitExceeded)?;
            env.storage().persistent().set(&key, &rate_state);
            env.storage()
                .persistent()
                .extend_ttl(&key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        }

        // Transfer bet_token from user to contract.
        token::Client::new(&env, &bet_token).transfer(
            &user,
            &env.current_contract_address(),
            &amount,
        );

        // Track cumulative deposit per token.
        let deposit_key = DataKey::PoolTokenDeposit(pool_id, bet_token.clone());
        let prev_deposit: i128 = env.storage().persistent().get(&deposit_key).unwrap_or(0);
        let new_deposit = prev_deposit
            .checked_add(amount)
            .ok_or(ContractError::PoolTotalOverflow)?;
        env.storage().persistent().set(&deposit_key, &new_deposit);
        env.storage()
            .persistent()
            .extend_ttl(&deposit_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

        // Update pool totals and user positions using the normalised amount
        // (same path as regular place_bet, so odds and claims work identically).
        let mut totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let current_total = Self::sum_totals(&totals)?;
        let outcome_current = totals.get(outcome).unwrap_or(0);
        let outcome_new = outcome_current
            .checked_add(normalized)
            .ok_or(ContractError::PoolTotalOverflow)?;
        totals.set(outcome, outcome_new);
        let new_total = current_total
            .checked_add(normalized)
            .ok_or(ContractError::PoolTotalOverflow)?;

        // Load user_bet early to check for first-time bet.
        let _user_bet: UserBet = env
            .storage()
            .persistent()
            .get(&DataKey::UserBet(pool_id, user.clone()))
            .unwrap_or(UserBet {
                amount_a: 0,
                amount_b: 0,
                total_bet: 0,
            });

        // Update binary-pool fields for backward compat (odds display, TWAP).
        if outcome == 0 {
            pool.total_a = pool
                .total_a
                .checked_add(normalized)
                .ok_or(ContractError::PoolTotalOverflow)?;
        } else if outcome == 1 {
            pool.total_b = pool
                .total_b
                .checked_add(normalized)
                .ok_or(ContractError::PoolTotalOverflow)?;
        }
        let mut user_bet: UserBet = env
            .storage()
            .persistent()
            .get(&DataKey::UserBet(pool_id, user.clone()))
            .unwrap_or(UserBet {
                amount_a: 0,
                amount_b: 0,
                total_bet: 0,
            });

        let is_first_bet = user_bet.total_bet == 0;
        if is_first_bet {
            pool.participant_count += 1;
        }
        pool.cumulative_volume = pool
            .cumulative_volume
            .checked_add(normalized)
            .ok_or(ContractError::PoolTotalOverflow)?;

        env.storage()
            .persistent()
            .set(&DataKey::Pool(pool_id), &pool);
        env.storage().persistent().extend_ttl(
            &DataKey::Pool(pool_id),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage()
            .persistent()
            .set(&DataKey::PoolOutcomeTotals(pool_id), &totals);
        if outcome == 0 {
            user_bet.amount_a = user_bet
                .amount_a
                .checked_add(normalized)
                .ok_or(ContractError::UserBetOverflow)?;
        } else {
            user_bet.amount_b = user_bet
                .amount_b
                .checked_add(normalized)
                .ok_or(ContractError::UserBetOverflow)?;
        }
        user_bet.total_bet = user_bet
            .total_bet
            .checked_add(normalized)
            .ok_or(ContractError::UserBetOverflow)?;
        env.storage()
            .persistent()
            .set(&DataKey::UserBet(pool_id, user.clone()), &user_bet);

        let mut outcome_bets: Vec<i128> = env
            .storage()
            .persistent()
            .get(&DataKey::UserOutcomeBets(pool_id, user.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        while outcome_bets.len() < outcomes.len() {
            outcome_bets.push_back(0);
        }
        let cur = outcome_bets.get(outcome).unwrap_or(0);
        outcome_bets.set(
            outcome,
            cur.checked_add(normalized)
                .ok_or(ContractError::UserBetOverflow)?,
        );
        env.storage().persistent().set(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            &outcome_bets,
        );

        env.storage().persistent().extend_ttl(
            &DataKey::UserBet(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::UserOutcomeBets(pool_id, user.clone()),
            POOL_BUMP_THRESHOLD,
            POOL_BUMP_TARGET,
        );

        env.events().publish(
            (
                Symbol::new(&env, "place_bet"),
                event_version(&env),
                pool_id,
                user.clone(),
            ),
            BetEvent {
                outcome,
                amount: normalized,
                total_yes: pool.total_a,
                total_no: pool.total_b,
            },
        );

        // Referral event only — no token transfer for multi-asset referrals.
        if let Some(ref ref_addr) = referrer {
            env.events().publish(
                (
                    Symbol::new(&env, "referral_bet"),
                    event_version(&env),
                    pool_id,
                ),
                ReferralBetEvent {
                    referrer: ref_addr.clone(),
                    pool_id,
                    outcome,
                    amount: normalized,
                },
            );
        }

        // #615 — Max pool size enforcement (mirrors single-asset place_bet).
        let max_pool_size: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::MaxPoolSize)
            .unwrap_or(DEFAULT_MAX_POOL_SIZE_STROOPS);
        if max_pool_size > 0 && new_total > max_pool_size {
            return Err(ContractError::PoolSizeLimitExceeded);
        }

        // #615 — Large-pool cooling threshold (mirrors single-asset place_bet).
        let large_pool_threshold: i128 = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::LargePoolThreshold)
            .unwrap_or(DEFAULT_LARGE_POOL_THRESHOLD_STROOPS);
        let cooling_period_secs: u64 = env
            .storage()
            .persistent()
            .get::<_, u64>(&DataKey::LargePoolCoolingPeriodSecs)
            .unwrap_or(DEFAULT_LARGE_POOL_COOLING_PERIOD_SECS);
        if large_pool_threshold > 0
            && cooling_period_secs > 0
            && current_total < large_pool_threshold
            && new_total >= large_pool_threshold
            && pool.status == PoolStatus::Open
        {
            let cooling_until = env
                .ledger()
                .timestamp()
                .checked_add(cooling_period_secs)
                .ok_or(ContractError::ExpiryOverflow)?;
            pool.status = PoolStatus::Frozen;
            env.storage()
                .persistent()
                .set(&DataKey::Pool(pool_id), &pool);
            env.storage().persistent().extend_ttl(
                &DataKey::Pool(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
            env.storage()
                .persistent()
                .set(&DataKey::PoolCoolingUntil(pool_id), &cooling_until);
            env.storage().persistent().extend_ttl(
                &DataKey::PoolCoolingUntil(pool_id),
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
            env.events().publish(
                (
                    Symbol::new(&env, "pool_cooling_started"),
                    event_version(&env),
                    pool_id,
                ),
                (cooling_until, new_total),
            );
        }
        Ok(())
    }

    /// Claim winnings from a settled multi-asset pool.
    ///
    /// The winner receives their proportional share of **every token** held in
    /// the pool. Proportion is computed using normalised (base-equivalent) stake
    /// amounts, so mixed-currency pools distribute all token balances fairly.
    ///
    /// Fee accounting: on the first claim the per-token fee is computed and
    /// stored in `PoolTokenFeePending`. The treasury recipient collects it via
    /// `collect_multi_asset_fees`.
    pub fn claim_multi_asset_winnings(
        env: Env,
        user: Address,
        pool_id: u32,
    ) -> Result<i128, ContractError> {
        user.require_auth();
        Self::require_not_paused(&env)?;

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        let winning_outcome = match pool.status {
            PoolStatus::Settled(o) => o,
            PoolStatus::Frozen => return Err(ContractError::PoolIsFrozen),
            PoolStatus::Disputed => return Err(ContractError::PoolIsDisputed),
            PoolStatus::Cancelled => return Err(ContractError::PoolIsCancelled),
            _ => return Err(ContractError::PoolNotSettled),
        };

        let user_bet = env
            .storage()
            .persistent()
            .get::<_, UserBet>(&DataKey::UserBet(pool_id, user.clone()))
            .ok_or(ContractError::NoBetFound)?;

        let user_outcome_bets =
            Self::read_user_outcome_bets(&env, pool_id, user.clone(), &user_bet);
        let user_norm_winning = user_outcome_bets.get(winning_outcome).unwrap_or(0);

        if user_norm_winning == 0 {
            return Err(ContractError::NoWinningsToClaim);
        }

        let totals = Self::read_outcome_totals(&env, pool_id, &pool);
        let total_norm_winning = totals.get(winning_outcome).unwrap_or(0);

        let fee_bps = Self::pool_effective_fee_bps(&env, pool_id);

        let allowed: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PoolAllowedTokens(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Populate per-token fee on first claim.
        let mut payout_state: PoolPayoutState = env
            .storage()
            .persistent()
            .get(&DataKey::PoolPayoutState(pool_id))
            .unwrap_or_default();

        let is_first_claim = !payout_state.fee_credited;
        if is_first_claim {
            for i in 0..allowed.len() {
                let tok = allowed.get(i).ok_or(ContractError::PoolNotFound)?;
                let deposit: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolTokenDeposit(pool_id, tok.clone()))
                    .unwrap_or(0);
                let fee_t = deposit * fee_bps as i128 / 10_000;
                if fee_t > 0 {
                    env.storage()
                        .persistent()
                        .set(&DataKey::PoolTokenFeePending(pool_id, tok), &fee_t);
                }
            }
            payout_state.fee_credited = true;
        }

        // Payout: user receives (net_T × user_norm / total_norm_winning) of each token.
        let mut total_norm_paid: i128 = 0;
        for i in 0..allowed.len() {
            let tok = allowed.get(i).ok_or(ContractError::PoolNotFound)?;
            let deposit: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::PoolTokenDeposit(pool_id, tok.clone()))
                .unwrap_or(0);
            let fee_t: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::PoolTokenFeePending(pool_id, tok.clone()))
                .unwrap_or(0);
            let net_t = deposit - fee_t;
            if net_t <= 0 {
                continue;
            }
            let payout_t = net_t * user_norm_winning / total_norm_winning;
            if payout_t > 0 {
                token::Client::new(&env, &tok).transfer(
                    &env.current_contract_address(),
                    &user,
                    &payout_t,
                );
                total_norm_paid += payout_t;
            }
        }

        // Update payout state bookkeeping.
        let new_claimed = payout_state
            .claimed_winning_stake
            .checked_add(user_norm_winning)
            .ok_or(ContractError::PoolTotalOverflow)?;
        payout_state.claimed_winning_stake = new_claimed;
        payout_state.paid_out = payout_state
            .paid_out
            .checked_add(total_norm_paid)
            .ok_or(ContractError::PoolTotalOverflow)?;

        // #617 — Dust sweep: on the final claim, transfer remaining per-token
        // dust to the treasury recipient so funds are not permanently locked.
        let is_final_claim = new_claimed == total_norm_winning;
        if is_final_claim {
            let treasury_recipient: Address = env
                .storage()
                .persistent()
                .get(&DataKey::TreasuryRecipient)
                .ok_or(ContractError::NotInitialized)?;
            for i in 0..allowed.len() {
                let tok = allowed.get(i).ok_or(ContractError::PoolNotFound)?;
                let deposit: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolTokenDeposit(pool_id, tok.clone()))
                    .unwrap_or(0);
                let fee_t: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::PoolTokenFeePending(pool_id, tok.clone()))
                    .unwrap_or(0);
                let net_t = deposit - fee_t;
                if net_t <= 0 {
                    continue;
                }
                let token_bal =
                    token::Client::new(&env, &tok).balance(&env.current_contract_address());
                let dust = if token_bal > fee_t {
                    token_bal - fee_t
                } else {
                    0
                };
                if dust > 0 {
                    token::Client::new(&env, &tok).transfer(
                        &env.current_contract_address(),
                        &treasury_recipient,
                        &dust,
                    );
                    let credit_key = DataKey::PoolTreasuryCredited(pool_id);
                    let prev_credit: i128 =
                        env.storage().persistent().get(&credit_key).unwrap_or(0);
                    env.storage()
                        .persistent()
                        .set(&credit_key, &(prev_credit + dust));
                    env.storage().persistent().extend_ttl(
                        &credit_key,
                        POOL_BUMP_THRESHOLD,
                        POOL_BUMP_TARGET,
                    );
                }
            }
        }

        let payout_key = DataKey::PoolPayoutState(pool_id);
        env.storage().persistent().set(&payout_key, &payout_state);
        env.storage()
            .persistent()
            .extend_ttl(&payout_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

        // Remove user's bet records to prevent double-claim.
        env.storage()
            .persistent()
            .remove(&DataKey::UserBet(pool_id, user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::UserOutcomeBets(pool_id, user.clone()));

        let analytics_user = user.clone();
        env.events().publish(
            (
                Symbol::new(&env, "claim_winnings"),
                event_version(&env),
                pool_id,
                user,
            ),
            total_norm_paid,
        );

        let total_key = DataKey::UserTotalClaimed(analytics_user.clone());
        let prev_total: i128 = env.storage().persistent().get(&total_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&total_key, &(prev_total + total_norm_paid));

        let history_key = DataKey::UserClaimHistory(analytics_user.clone());
        let mut history: Vec<UserClaimEntry> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(UserClaimEntry {
            pool_id,
            amount: total_norm_paid,
            fee: 0,
            timestamp: env.ledger().timestamp(),
            winning_outcome,
        });
        while history.len() > 50 {
            history.remove(0);
        }
        env.storage().persistent().set(&history_key, &history);
        env.storage()
            .persistent()
            .extend_ttl(&history_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);
        env.storage()
            .persistent()
            .extend_ttl(&total_key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET);

        Ok(total_norm_paid)
    }

    /// Rescue tokens accidentally sent directly to the contract address.
    ///
    /// Transfers `amount` of `token` from the contract balance to `to`.
    /// Only the treasury recipient (admin) may call this. Emits a
    /// `tokens_rescued` event on success.
    ///
    /// This is a best-effort safety valve: the admin is trusted to only
    /// rescue tokens that are not currently locked in active pools.
    pub fn rescue_tokens(
        env: Env,
        caller: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        token::Client::new(&env, &token).transfer(&env.current_contract_address(), &to, &amount);

        env.events().publish(
            (Symbol::new(&env, "tokens_rescued"), event_version(&env)),
            (token, to, amount),
        );

        Ok(())
    }

    /// Transfer accumulated per-token fees to the treasury recipient.
    ///
    /// Call this after the first `claim_multi_asset_winnings` on a pool has
    /// run (which populates `PoolTokenFeePending`). Only the treasury recipient
    /// may call this.
    pub fn collect_multi_asset_fees(
        env: Env,
        caller: Address,
        pool_id: u32,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_treasury_recipient(&env, &caller)?;

        let pool = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Only callable on settled pools.
        match pool.status {
            PoolStatus::Settled(_) => {}
            _ => return Err(ContractError::PoolNotSettled),
        }

        let treasury_recipient: Address = env
            .storage()
            .persistent()
            .get(&DataKey::TreasuryRecipient)
            .ok_or(ContractError::NotInitialized)?;

        let allowed: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::PoolAllowedTokens(pool_id))
            .ok_or(ContractError::PoolNotFound)?;

        // Compute total normalized fee value to credit to Treasury ledger.
        let mut total_normalized_fee: i128 = 0;

        for i in 0..allowed.len() {
            let tok = allowed.get(i).ok_or(ContractError::PoolNotFound)?;
            let fee_key = DataKey::PoolTokenFeePending(pool_id, tok.clone());
            let fee_t: i128 = env.storage().persistent().get(&fee_key).unwrap_or(0);
            if fee_t > 0 {
                // Transfer the token-denominated fee to the treasury recipient.
                token::Client::new(&env, &tok).transfer(
                    &env.current_contract_address(),
                    &treasury_recipient,
                    &fee_t,
                );

                // Convert fee to normalized (base-equivalent) amount for Treasury tracking.
                let exchange_rate: i128 = env
                    .storage()
                    .persistent()
                    .get(&DataKey::TokenExchangeRate(tok.clone()))
                    .unwrap_or(10_000);
                let normalized_fee = fee_t
                    .checked_mul(exchange_rate)
                    .ok_or(ContractError::PoolTotalOverflow)?
                    / 10_000;

                total_normalized_fee = total_normalized_fee
                    .checked_add(normalized_fee)
                    .ok_or(ContractError::TreasuryOverflow)?;

                // Remove the pending fee record.
                env.storage().persistent().remove(&fee_key);
            }
        }

        // Credit the aggregate Treasury and per-pool attribution ledgers.
        if total_normalized_fee > 0 {
            let current_treasury: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Treasury)
                .unwrap_or(0);
            let next_treasury = current_treasury
                .checked_add(total_normalized_fee)
                .ok_or(ContractError::TreasuryOverflow)?;
            env.storage()
                .persistent()
                .set(&DataKey::Treasury, &next_treasury);

            let credit_key = DataKey::PoolTreasuryCredited(pool_id);
            let prev_pool_credit: i128 = env.storage().persistent().get(&credit_key).unwrap_or(0);
            let next_pool_credit = prev_pool_credit
                .checked_add(total_normalized_fee)
                .ok_or(ContractError::TreasuryOverflow)?;
            env.storage()
                .persistent()
                .set(&credit_key, &next_pool_credit);
            env.storage().persistent().extend_ttl(
                &credit_key,
                POOL_BUMP_THRESHOLD,
                POOL_BUMP_TARGET,
            );
        }

        Ok(())
    }
}
