//! Shared types, data structures, and errors for the stellar-lend protocol contracts.

#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Map, String, Vec};

/// Error codes returned by the lending and analytics contract functions.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LendError {
    /// Action not authorized
    Unauthorized = 1,
    /// Invalid parameter supplied
    InvalidParameter = 2,
    /// Position not found
    PositionNotFound = 3,
    /// Pool not found
    PoolNotFound = 4,
    /// Policy not found
    PolicyNotFound = 5,
    /// Claim not found
    ClaimNotFound = 6,
    /// Health factor is below the liquidation threshold
    PositionUnhealthy = 7,
    /// Mathematical overflow during calculation
    MathOverflow = 8,
    /// Division by zero attempted
    DivisionByZero = 9,
    /// Invalid or stale price feed
    InvalidPriceFeed = 10,
    /// Insufficient reserves in insurance pool
    InsufficientReserves = 11,
    /// Active cover capacity reached
    CapacityExceeded = 12,
    /// Claim has already been processed
    ClaimAlreadyProcessed = 13,
    /// Policy expired or inactive
    PolicyNotActive = 14,
    /// Reentrancy or state lock violation
    StateLocked = 15,
    /// Compliance verification failed
    ComplianceCheckFailed = 16,
    /// Rate limit exceeded
    RateLimitExceeded = 17,
    /// Maximum asset limit reached
    MaxAssetsExceeded = 18,
    /// Nonce already used (replay protection)
    ReplayDetected = 19,
    /// Maximum payout per epoch exceeded
    MaxPayoutExceeded = 20,
}

/// Risk tier classification for user lending positions.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RiskTier {
    /// Safe: Health Factor >= 1.5 (15000 bps)
    Safe = 1,
    /// Caution: 1.2 <= Health Factor < 1.5
    Caution = 2,
    /// AtRisk: 1.0 <= Health Factor < 1.2
    AtRisk = 3,
    /// Liquidatable: Health Factor < 1.0 (10000 bps)
    Liquidatable = 4,
}

/// User reputation tier for interest discounts and borrowing advantages.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ReputationTier {
    /// Bronze: Score 0 - 399
    Bronze = 0,
    /// Silver: Score 400 - 699 (+200 bps LTV boost, -25 bps rate discount)
    Silver = 1,
    /// Gold: Score 700 - 899 (+400 bps LTV boost, -50 bps rate discount)
    Gold = 2,
    /// Platinum: Score 900 - 1000 (+600 bps LTV boost, -100 bps rate discount)
    Platinum = 3,
}

/// Asset deposited as collateral in a position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralAsset {
    pub asset: Address,
    pub amount: i128,
    pub price_usd: i128,
    pub liquidation_threshold_bps: u32,
    pub collateral_factor_bps: u32,
}

/// Asset borrowed against collateral in a position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BorrowAsset {
    pub asset: Address,
    pub borrowed_amount: i128,
    pub price_usd: i128,
    pub borrow_rate_bps: u32,
    pub accrued_interest: i128,
    pub last_accrual_time: u64,
}

/// Complete health assessment of a user position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionHealth {
    pub total_collateral_usd: i128,
    pub total_borrowed_usd: i128,
    pub liquidation_threshold_usd: i128,
    pub max_borrow_usd: i128,
    pub health_factor_bps: u64,
    pub current_ltv_bps: u32,
    pub max_ltv_bps: u32,
    pub risk_tier: RiskTier,
    pub is_liquidatable: bool,
    pub liquidation_price_usd: i128,
    pub max_withdrawable_usd: i128,
    pub max_borrowable_usd: i128,
}

/// Parameters for running an off-chain or on-chain position health simulation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SimulationParams {
    pub price_shocks_bps: Vec<(Address, i32)>,
    pub collateral_delta: Vec<(Address, i128)>,
    pub debt_delta: Vec<(Address, i128)>,
    pub time_delta_seconds: u64,
}

/// Detailed outcome of a position simulation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SimulationResult {
    pub initial_health_factor_bps: u64,
    pub simulated_health_factor_bps: u64,
    pub simulated_collateral_usd: i128,
    pub simulated_debt_usd: i128,
    pub simulated_liquidation_threshold_usd: i128,
    pub simulated_risk_tier: RiskTier,
    pub is_liquidatable: bool,
    pub shortfall_usd: i128,
    pub max_withdrawable_usd: i128,
    pub max_borrowable_usd: i128,
    pub stress_scenario_mild_hf_bps: u64,
    pub stress_scenario_moderate_hf_bps: u64,
    pub stress_scenario_severe_hf_bps: u64,
}

/// Insurance pool underwriting state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsurancePool {
    pub pool_id: u64,
    pub underwriting_asset: Address,
    pub total_staked: i128,
    pub total_shares: i128,
    pub active_cover_amount: i128,
    pub available_reserves: i128,
    pub max_capacity: i128,
    pub min_solvency_ratio_bps: u32,
    pub base_premium_rate_bps: u32,
    pub utilization_multiplier_bps: u32,
    pub is_paused: bool,
}

/// Insurance policy purchased by a lender.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsurancePolicy {
    pub policy_id: u64,
    pub holder: Address,
    pub pool_id: u64,
    pub cover_amount: i128,
    pub premium_paid: i128,
    pub start_time: u64,
    pub expiry_time: u64,
    pub is_claimed: bool,
    pub is_active: bool,
}

/// Claim filed against an insurance policy.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InsuranceClaim {
    pub claim_id: u64,
    pub policy_id: u64,
    pub claimant: Address,
    pub loss_amount: i128,
    pub payout_amount: i128,
    pub filing_time: u64,
    pub is_approved: bool,
    pub is_paid: bool,
    pub assessor: Address,
}

/// Reserve fund health metrics.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveMetrics {
    pub solvency_ratio_bps: u32,
    pub total_premiums_collected: i128,
    pub total_claims_paid: i128,
    pub active_policies_count: u32,
    pub available_liquidity: i128,
    pub utilization_rate_bps: u32,
}

/// User reputation profile tracking creditworthiness.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserReputation {
    pub user: Address,
    pub score: u32,
    pub tier: ReputationTier,
    pub total_borrowed_volume: i128,
    pub total_repaid_volume: i128,
    pub on_time_repayments_count: u32,
    pub late_repayments_count: u32,
    pub liquidation_count: u32,
    pub default_count: u32,
    pub last_activity_time: u64,
    pub ltv_boost_bps: u32,
    pub rate_discount_bps: u32,
}

/// Config for a deployed lending pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LendingPoolConfig {
    pub pool_id: u64,
    pub admin: Address,
    pub underlying_asset: Address,
    pub collateral_factor_bps: u32,
    pub liquidation_threshold_bps: u32,
    pub liquidation_bonus_bps: u32,
    pub base_rate_bps: u32,
    pub optimal_utilization_bps: u32,
    pub slope1_bps: u32,
    pub slope2_bps: u32,
    pub is_active: bool,
}
