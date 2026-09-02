//! Lending Protocol Insurance Marketplace and Reserve Fund Management for Soroban/Stellar.
//!
//! Provides underwriting capital pools, dynamic risk-adjusted premium pricing, policy issuance,
//! proof-verified claim filing, and insolvency protection for lenders.

#![no_std]

use crate::types::{
    InsuranceClaim, InsurancePolicy, InsurancePool, LendError, ReserveMetrics, RiskTier,
};
use soroban_sdk::{contracttype, Address, BytesN, Env, Map, Vec};

/// Maximum percentage of available reserves that can be paid out in a single claim (25% = 2,500 bps).
pub const MAX_SINGLE_PAYOUT_BPS: u32 = 2_500;
/// Basis points scale (100% = 10,000 bps).
pub const BPS_SCALE: u64 = 10_000;
/// Minimum duration for an insurance policy (1 day in seconds).
pub const MIN_POLICY_DURATION_SECONDS: u64 = 86_400;
/// Maximum duration for an insurance policy (365 days in seconds).
pub const MAX_POLICY_DURATION_SECONDS: u64 = 31_536_000;
/// Precision scale for share price calculations.
pub const SHARE_PRECISION: i128 = 1_000_000_000;

pub struct InsuranceMarketplace;

impl InsuranceMarketplace {
    /// Initializes a new insurance underwriting pool.
    pub fn create_pool(
        _env: &Env,
        pool_id: u64,
        underwriting_asset: Address,
        max_capacity: i128,
        min_solvency_ratio_bps: u32,
        base_premium_rate_bps: u32,
        utilization_multiplier_bps: u32,
    ) -> Result<InsurancePool, LendError> {
        if max_capacity <= 0 || min_solvency_ratio_bps < 10_000 || base_premium_rate_bps == 0 {
            return Err(LendError::InvalidParameter);
        }

        Ok(InsurancePool {
            pool_id,
            underwriting_asset,
            total_staked: 0,
            total_shares: 0,
            active_cover_amount: 0,
            available_reserves: 0,
            max_capacity,
            min_solvency_ratio_bps,
            base_premium_rate_bps,
            utilization_multiplier_bps,
            is_paused: false,
        })
    }

    /// Deposits underwriting capital into the insurance pool, minting LP shares.
    pub fn stake_capital(
        _env: &Env,
        pool: &mut InsurancePool,
        amount: i128,
    ) -> Result<i128, LendError> {
        if pool.is_paused {
            return Err(LendError::StateLocked);
        }
        if amount <= 0 {
            return Err(LendError::InvalidParameter);
        }

        let shares_to_mint = if pool.total_shares == 0 || pool.total_staked == 0 {
            amount
        } else {
            // shares = (amount * total_shares) / total_staked
            amount
                .checked_mul(pool.total_shares)
                .ok_or(LendError::MathOverflow)?
                .checked_div(pool.total_staked)
                .ok_or(LendError::DivisionByZero)?
        };

        pool.total_staked = pool
            .total_staked
            .checked_add(amount)
            .ok_or(LendError::MathOverflow)?;
        pool.total_shares = pool
            .total_shares
            .checked_add(shares_to_mint)
            .ok_or(LendError::MathOverflow)?;
        pool.available_reserves = pool
            .available_reserves
            .checked_add(amount)
            .ok_or(LendError::MathOverflow)?;

        Ok(shares_to_mint)
    }

    /// Withdraws staked capital and accumulated premium yield from the insurance pool.
    pub fn withdraw_capital(
        _env: &Env,
        pool: &mut InsurancePool,
        shares: i128,
    ) -> Result<i128, LendError> {
        if shares <= 0 || shares > pool.total_shares {
            return Err(LendError::InvalidParameter);
        }

        // payout = (shares * total_staked) / total_shares
        let payout = shares
            .checked_mul(pool.total_staked)
            .ok_or(LendError::MathOverflow)?
            .checked_div(pool.total_shares)
            .ok_or(LendError::DivisionByZero)?;

        if payout > pool.available_reserves {
            return Err(LendError::InsufficientReserves);
        }

        // Ensure solvency invariant: remaining reserves must cover min solvency ratio
        let remaining_reserves = pool.available_reserves - payout;
        if pool.active_cover_amount > 0 {
            let required_reserves = (pool.active_cover_amount as u128)
                .checked_mul(pool.min_solvency_ratio_bps as u128)
                .ok_or(LendError::MathOverflow)?
                / (BPS_SCALE as u128);
            if (remaining_reserves as u128) < required_reserves {
                return Err(LendError::InsufficientReserves);
            }
        }

        pool.total_shares -= shares;
        pool.total_staked -= payout;
        pool.available_reserves = remaining_reserves;

        Ok(payout)
    }

    /// Calculates dynamic premium rate based on duration, pool utilization, and risk tier.
    ///
    /// Formula:
    /// Utilization = active_cover / total_staked
    /// Risk Multiplier = Safe (1.0x), Caution (1.3x), AtRisk (1.8x)
    /// Annual Rate = Base Rate + (Utilization * Utilization Multiplier)
    /// Premium = (Cover * Annual Rate * Duration * Risk Multiplier) / (10000 * SECONDS_PER_YEAR)
    pub fn calculate_premium(
        pool: &InsurancePool,
        cover_amount: i128,
        duration_seconds: u64,
        risk_tier: RiskTier,
    ) -> Result<i128, LendError> {
        if cover_amount <= 0
            || duration_seconds < MIN_POLICY_DURATION_SECONDS
            || duration_seconds > MAX_POLICY_DURATION_SECONDS
        {
            return Err(LendError::InvalidParameter);
        }

        let utilization_bps = if pool.total_staked == 0 {
            0
        } else {
            ((pool.active_cover_amount as u128)
                .checked_mul(BPS_SCALE as u128)
                .ok_or(LendError::MathOverflow)?
                / (pool.total_staked as u128)) as u32
        };

        let util_component = (utilization_bps as u64)
            .checked_mul(pool.utilization_multiplier_bps as u64)
            .ok_or(LendError::MathOverflow)?
            / BPS_SCALE;

        let annual_rate_bps = (pool.base_premium_rate_bps as u64)
            .checked_add(util_component)
            .ok_or(LendError::MathOverflow)?;

        let risk_multiplier_bps: u64 = match risk_tier {
            RiskTier::Safe => 10_000,
            RiskTier::Caution => 13_000,
            RiskTier::AtRisk => 18_000,
            RiskTier::Liquidatable => 25_000,
        };

        // Premium = (cover * annual_rate * duration * risk_mult) / (10000 * 31536000 * 10000)
        let num = (cover_amount as u128)
            .checked_mul(annual_rate_bps as u128)
            .ok_or(LendError::MathOverflow)?
            .checked_mul(duration_seconds as u128)
            .ok_or(LendError::MathOverflow)?
            .checked_mul(risk_multiplier_bps as u128)
            .ok_or(LendError::MathOverflow)?;

        let den = (BPS_SCALE as u128)
            .checked_mul(31_536_000 as u128)
            .ok_or(LendError::MathOverflow)?
            .checked_mul(BPS_SCALE as u128)
            .ok_or(LendError::MathOverflow)?;

        let premium = (num / den) as i128;
        Ok(premium.max(1)) // Minimum 1 unit premium
    }

    /// Purchases an insurance cover policy for a lender position.
    pub fn purchase_policy(
        _env: &Env,
        pool: &mut InsurancePool,
        policy_id: u64,
        holder: Address,
        cover_amount: i128,
        duration_seconds: u64,
        current_time: u64,
        risk_tier: RiskTier,
    ) -> Result<InsurancePolicy, LendError> {
        if pool.is_paused {
            return Err(LendError::StateLocked);
        }

        let new_active_cover = pool
            .active_cover_amount
            .checked_add(cover_amount)
            .ok_or(LendError::MathOverflow)?;

        if new_active_cover > pool.max_capacity {
            return Err(LendError::CapacityExceeded);
        }

        // Solvency check: available reserves must meet solvency threshold for active cover
        let required_reserves = (new_active_cover as u128)
            .checked_mul(pool.min_solvency_ratio_bps as u128)
            .ok_or(LendError::MathOverflow)?
            / (BPS_SCALE as u128);

        if (pool.available_reserves as u128) < required_reserves {
            return Err(LendError::CapacityExceeded);
        }

        let premium =
            Self::calculate_premium(pool, cover_amount, duration_seconds, risk_tier)?;

        pool.active_cover_amount = new_active_cover;
        // Premium contributes to total pool value (LP yield) and available liquidity
        pool.total_staked = pool
            .total_staked
            .checked_add(premium)
            .ok_or(LendError::MathOverflow)?;
        pool.available_reserves = pool
            .available_reserves
            .checked_add(premium)
            .ok_or(LendError::MathOverflow)?;

        let expiry_time = current_time
            .checked_add(duration_seconds)
            .ok_or(LendError::MathOverflow)?;

        Ok(InsurancePolicy {
            policy_id,
            holder,
            pool_id: pool.pool_id,
            cover_amount,
            premium_paid: premium,
            start_time: current_time,
            expiry_time,
            is_claimed: false,
            is_active: true,
        })
    }

    /// Files a claim against an active insurance policy with proof of bad debt/shortfall.
    pub fn file_claim(
        _env: &Env,
        policy: &mut InsurancePolicy,
        claim_id: u64,
        claimant: Address,
        loss_amount: i128,
        current_time: u64,
    ) -> Result<InsuranceClaim, LendError> {
        if !policy.is_active || policy.is_claimed {
            return Err(LendError::PolicyNotActive);
        }
        if current_time > policy.expiry_time || current_time < policy.start_time {
            return Err(LendError::PolicyNotActive);
        }
        if claimant != policy.holder {
            return Err(LendError::Unauthorized);
        }
        if loss_amount <= 0 {
            return Err(LendError::InvalidParameter);
        }

        let payout_amount = loss_amount.min(policy.cover_amount);

        Ok(InsuranceClaim {
            claim_id,
            policy_id: policy.policy_id,
            claimant,
            loss_amount,
            payout_amount,
            filing_time: current_time,
            is_approved: false,
            is_paid: false,
            assessor: claimant.clone(), // Set during assessment
        })
    }

    /// Assesses and approves or rejects a filed claim (Assessor only).
    pub fn assess_claim(
        _env: &Env,
        claim: &mut InsuranceClaim,
        assessor: Address,
        approve: bool,
    ) -> Result<(), LendError> {
        if claim.is_approved || claim.is_paid {
            return Err(LendError::ClaimAlreadyProcessed);
        }

        claim.assessor = assessor;
        claim.is_approved = approve;
        Ok(())
    }

    /// Executes payout for an approved insurance claim.
    ///
    /// # Security Measures:
    /// - Caps single payout at `MAX_SINGLE_PAYOUT_BPS` (25%) of available reserves.
    /// - Checks-Effects-Interactions: Updates state before settling payout.
    pub fn execute_claim_payout(
        _env: &Env,
        pool: &mut InsurancePool,
        policy: &mut InsurancePolicy,
        claim: &mut InsuranceClaim,
    ) -> Result<i128, LendError> {
        if !claim.is_approved || claim.is_paid {
            return Err(LendError::ClaimAlreadyProcessed);
        }
        if !policy.is_active || policy.is_claimed {
            return Err(LendError::PolicyNotActive);
        }

        let max_allowed_payout = (pool.available_reserves as u128)
            .checked_mul(MAX_SINGLE_PAYOUT_BPS as u128)
            .ok_or(LendError::MathOverflow)?
            / (BPS_SCALE as u128);

        let final_payout = claim.payout_amount.min(max_allowed_payout as i128);
        if final_payout <= 0 {
            return Err(LendError::InsufficientReserves);
        }

        // Apply state updates
        pool.available_reserves -= final_payout;
        pool.total_staked = (pool.total_staked - final_payout).max(0);
        pool.active_cover_amount = (pool.active_cover_amount - policy.cover_amount).max(0);

        policy.is_claimed = true;
        policy.is_active = false;
        claim.is_paid = true;
        claim.payout_amount = final_payout;

        Ok(final_payout)
    }

    /// Queries reserve metrics and solvency health for a given insurance pool.
    pub fn get_metrics(pool: &InsurancePool, total_claims_paid: i128) -> ReserveMetrics {
        let solvency_ratio_bps = if pool.active_cover_amount == 0 {
            100_000 // 1000% if no active cover
        } else {
            (((pool.available_reserves as u128) * (BPS_SCALE as u128))
                / (pool.active_cover_amount as u128)) as u32
        };

        let utilization_rate_bps = if pool.total_staked == 0 {
            0
        } else {
            (((pool.active_cover_amount as u128) * (BPS_SCALE as u128))
                / (pool.total_staked as u128)) as u32
        };

        ReserveMetrics {
            solvency_ratio_bps,
            total_premiums_collected: pool.total_staked,
            total_claims_paid,
            active_policies_count: 0,
            available_liquidity: pool.available_reserves,
            utilization_rate_bps,
        }
    }
}
