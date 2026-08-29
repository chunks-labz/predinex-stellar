//! Analytics and Position Health Simulation Engine for Lending Pools on Stellar/Soroban.
//!
//! Provides real-time calculation of position health, loan-to-value (LTV), liquidation thresholds,
//! price shock simulations, interest accrual modeling, and stress testing.

#![no_std]

use crate::types::{
    BorrowAsset, CollateralAsset, LendError, PositionHealth, RiskTier, SimulationParams,
    SimulationResult,
};
use soroban_sdk::{Address, Env, Vec};

/// Scaling constant for basis points (100% = 10,000 bps).
pub const BPS_SCALING: u64 = 10_000;
/// Price precision scaler (1e7).
pub const PRICE_PRECISION: i128 = 10_000_000;
/// Seconds in a year for APY interest compounding calculations (365 days).
pub const SECONDS_PER_YEAR: u64 = 31_536_000;
/// Minimum safe health factor (1.0 in bps).
pub const MIN_HEALTH_FACTOR_BPS: u64 = 10_000;
/// Maximum allowed assets in a single position to prevent DoS via gas exhaustion.
pub const MAX_ASSETS_PER_POSITION: u32 = 16;
/// Maximum price shock percentage (+/- 10,000 bps = 100%).
pub const MAX_PRICE_SHOCK_BPS: i32 = 10_000;

pub struct PositionAnalytics;

impl PositionAnalytics {
    /// Computes the comprehensive health profile of a user lending position.
    ///
    /// # Security Invariants:
    /// - Collateral rounding: Round down to prevent overestimating backing.
    /// - Debt rounding: Round up to prevent underestimating liability.
    /// - Non-zero price enforcement: Any asset with non-positive price triggers .
    pub fn calculate_position_health(
        _env: &Env,
        collaterals: &Vec<CollateralAsset>,
        borrows: &Vec<BorrowAsset>,
    ) -> Result<PositionHealth, LendError> {
        if collaterals.len() > MAX_ASSETS_PER_POSITION || borrows.len() > MAX_ASSETS_PER_POSITION {
            return Err(LendError::MaxAssetsExceeded);
        }

        let mut total_collateral_usd: i128 = 0;
        let mut liquidation_threshold_usd: i128 = 0;
        let mut max_borrow_usd: i128 = 0;

        for i in 0..collaterals.len() {
            let col = collaterals.get(i).unwrap();
            if col.amount < 0 || col.price_usd <= 0 {
                return Err(LendError::InvalidPriceFeed);
            }
            if col.liquidation_threshold_bps > BPS_SCALING as u32
                || col.collateral_factor_bps > BPS_SCALING as u32
            {
                return Err(LendError::InvalidParameter);
            }

            // Asset USD Value = (amount * price_usd) / PRICE_PRECISION
            let asset_value_usd = col
                .amount
                .checked_mul(col.price_usd)
                .ok_or(LendError::MathOverflow)?
                .checked_div(PRICE_PRECISION)
                .ok_or(LendError::DivisionByZero)?;

            total_collateral_usd = total_collateral_usd
                .checked_add(asset_value_usd)
                .ok_or(LendError::MathOverflow)?;

            // Liquidation Threshold backing = (asset_value * liquidation_threshold_bps) / 10000
            let liq_backing = asset_value_usd
                .checked_mul(col.liquidation_threshold_bps as i128)
                .ok_or(LendError::MathOverflow)?
                .checked_div(BPS_SCALING as i128)
                .ok_or(LendError::DivisionByZero)?;

            liquidation_threshold_usd = liquidation_threshold_usd
                .checked_add(liq_backing)
                .ok_or(LendError::MathOverflow)?;

            // Max Borrow capacity = (asset_value * collateral_factor_bps) / 10000
            let borrow_cap = asset_value_usd
                .checked_mul(col.collateral_factor_bps as i128)
                .ok_or(LendError::MathOverflow)?
                .checked_div(BPS_SCALING as i128)
                .ok_or(LendError::DivisionByZero)?;

            max_borrow_usd = max_borrow_usd
                .checked_add(borrow_cap)
                .ok_or(LendError::MathOverflow)?;
        }

        let mut total_borrowed_usd: i128 = 0;
        for i in 0..borrows.len() {
            let borrow = borrows.get(i).unwrap();
            if borrow.borrowed_amount < 0 || borrow.price_usd <= 0 {
                return Err(LendError::InvalidPriceFeed);
            }

            let total_debt_amount = borrow
                .borrowed_amount
                .checked_add(borrow.accrued_interest)
                .ok_or(LendError::MathOverflow)?;

            // Debt USD Value = ceil((total_debt * price_usd) / PRICE_PRECISION)
            let debt_prod = total_debt_amount
                .checked_mul(borrow.price_usd)
                .ok_or(LendError::MathOverflow)?;
            let debt_usd = if debt_prod % PRICE_PRECISION == 0 {
                debt_prod / PRICE_PRECISION
            } else {
                (debt_prod / PRICE_PRECISION) + 1
            };

            total_borrowed_usd = total_borrowed_usd
                .checked_add(debt_usd)
                .ok_or(LendError::MathOverflow)?;
        }

        // Calculate Health Factor (bps)
        // HF = (liquidation_threshold_usd * 10000) / total_borrowed_usd
        let health_factor_bps = if total_borrowed_usd == 0 {
            // Infinite health if no debt
            u64::MAX
        } else {
            let hf_num = (liquidation_threshold_usd as u128)
                .checked_mul(BPS_SCALING as u128)
                .ok_or(LendError::MathOverflow)?;
            (hf_num / (total_borrowed_usd as u128)) as u64
        };

        // Determine Risk Tier
        let risk_tier = if health_factor_bps >= 15_000 {
            RiskTier::Safe
        } else if health_factor_bps >= 12_000 {
            RiskTier::Caution
        } else if health_factor_bps >= 10_000 {
            RiskTier::AtRisk
        } else {
            RiskTier::Liquidatable
        };

        let is_liquidatable = health_factor_bps < MIN_HEALTH_FACTOR_BPS;

        // Current LTV = (total_borrowed_usd * 10000) / total_collateral_usd
        let current_ltv_bps = if total_collateral_usd == 0 {
            0
        } else {
            let ltv = (total_borrowed_usd as u128)
                .checked_mul(BPS_SCALING as u128)
                .ok_or(LendError::MathOverflow)?
                .checked_div(total_collateral_usd as u128)
                .unwrap_or(0);
            ltv.min(BPS_SCALING as u128) as u32
        };

        // Max weighted LTV
        let max_ltv_bps = if total_collateral_usd == 0 {
            0
        } else {
            ((max_borrow_usd as u128)
                .checked_mul(BPS_SCALING as u128)
                .ok_or(LendError::MathOverflow)?
                .checked_div(total_collateral_usd as u128)
                .unwrap_or(0)) as u32
        };

        // Calculate max borrowable additional USD before hitting max borrow capacity
        let max_borrowable_usd = if max_borrow_usd > total_borrowed_usd {
            max_borrow_usd - total_borrowed_usd
        } else {
            0
        };

        // Calculate max withdrawable collateral value before dropping below liquidation threshold
        let max_withdrawable_usd = if total_borrowed_usd == 0 {
            total_collateral_usd
        } else if liquidation_threshold_usd > total_borrowed_usd {
            liquidation_threshold_usd - total_borrowed_usd
        } else {
            0
        };

        // Liquidation price calculation for single collateral position
        let liquidation_price_usd = if collaterals.len() == 1 && borrows.len() >= 1 {
            let col = collaterals.get(0).unwrap();
            if col.amount > 0 && col.liquidation_threshold_bps > 0 {
                // Liq Price = (total_borrowed_usd * PRICE_PRECISION * 10000) / (col.amount * col.liquidation_threshold_bps)
                let num = (total_borrowed_usd as u128)
                    .checked_mul(PRICE_PRECISION as u128)
                    .ok_or(LendError::MathOverflow)?
                    .checked_mul(BPS_SCALING as u128)
                    .ok_or(LendError::MathOverflow)?;
                let den = (col.amount as u128)
                    .checked_mul(col.liquidation_threshold_bps as u128)
                    .ok_or(LendError::MathOverflow)?;
                (num / den) as i128
            } else {
                0
            }
        } else {
            0
        };

        Ok(PositionHealth {
            total_collateral_usd,
            total_borrowed_usd,
            liquidation_threshold_usd,
            max_borrow_usd,
            health_factor_bps,
            current_ltv_bps,
            max_ltv_bps,
            risk_tier,
            is_liquidatable,
            liquidation_price_usd,
            max_withdrawable_usd,
            max_borrowable_usd,
        })
    }

    /// Simulates position health under hypothetical market shocks, collateral/debt actions,
    /// and accrued interest over time.
    pub fn simulate_position_health(
        env: &Env,
        collaterals: &Vec<CollateralAsset>,
        borrows: &Vec<BorrowAsset>,
        params: &SimulationParams,
    ) -> Result<SimulationResult, LendError> {
        let initial_health = Self::calculate_position_health(env, collaterals, borrows)?;

        // Apply price shocks, collateral changes, and debt changes
        let mut sim_collaterals: Vec<CollateralAsset> = Vec::new(env);
        for i in 0..collaterals.len() {
            let mut col = collaterals.get(i).unwrap();

            // Check price shock for this asset
            for j in 0..params.price_shocks_bps.len() {
                let (shock_asset, shock_bps) = params.price_shocks_bps.get(j).unwrap();
                if shock_asset == col.asset {
                    // price = price * (10000 + shock_bps) / 10000
                    let multiplier = (BPS_SCALING as i64)
                        .checked_add(shock_bps as i64)
                        .ok_or(LendError::MathOverflow)?;
                    if multiplier <= 0 {
                        col.price_usd = 1; // Floor price at 1 micro-cent
                    } else {
                        col.price_usd = ((col.price_usd as i64)
                            .checked_mul(multiplier)
                            .ok_or(LendError::MathOverflow)?
                            / (BPS_SCALING as i64)) as i128;
                    }
                }
            }

            // Check collateral delta
            for j in 0..params.collateral_delta.len() {
                let (delta_asset, delta_amount) = params.collateral_delta.get(j).unwrap();
                if delta_asset == col.asset {
                    let new_amount = col
                        .amount
                        .checked_add(delta_amount)
                        .ok_or(LendError::MathOverflow)?;
                    col.amount = new_amount.max(0);
                }
            }

            sim_collaterals.push_back(col);
        }

        let mut sim_borrows: Vec<BorrowAsset> = Vec::new(env);
        for i in 0..borrows.len() {
            let mut borrow = borrows.get(i).unwrap();

            // Check price shock for borrowed asset
            for j in 0..params.price_shocks_bps.len() {
                let (shock_asset, shock_bps) = params.price_shocks_bps.get(j).unwrap();
                if shock_asset == borrow.asset {
                    let multiplier = (BPS_SCALING as i64)
                        .checked_add(shock_bps as i64)
                        .ok_or(LendError::MathOverflow)?;
                    if multiplier > 0 {
                        borrow.price_usd = ((borrow.price_usd as i64)
                            .checked_mul(multiplier)
                            .ok_or(LendError::MathOverflow)?
                            / (BPS_SCALING as i64)) as i128;
                    }
                }
            }

            // Check debt delta
            for j in 0..params.debt_delta.len() {
                let (delta_asset, delta_amount) = params.debt_delta.get(j).unwrap();
                if delta_asset == borrow.asset {
                    let new_amount = borrow
                        .borrowed_amount
                        .checked_add(delta_amount)
                        .ok_or(LendError::MathOverflow)?;
                    borrow.borrowed_amount = new_amount.max(0);
                }
            }

            // Accrue interest over time delta
            if params.time_delta_seconds > 0 && borrow.borrow_rate_bps > 0 {
                // interest = (principal * rate_bps * time_delta) / (10000 * SECONDS_PER_YEAR)
                let interest_num = (borrow.borrowed_amount as u128)
                    .checked_mul(borrow.borrow_rate_bps as u128)
                    .ok_or(LendError::MathOverflow)?
                    .checked_mul(params.time_delta_seconds as u128)
                    .ok_or(LendError::MathOverflow)?;
                let interest_den = (BPS_SCALING as u128)
                    .checked_mul(SECONDS_PER_YEAR as u128)
                    .ok_or(LendError::MathOverflow)?;
                let accrued = (interest_num / interest_den) as i128;
                borrow.accrued_interest = borrow
                    .accrued_interest
                    .checked_add(accrued)
                    .ok_or(LendError::MathOverflow)?;
            }

            sim_borrows.push_back(borrow);
        }

        let sim_health = Self::calculate_position_health(env, &sim_collaterals, &sim_borrows)?;

        // Run automated stress test scenarios:
        // 1. Mild Stress: Collateral -10%, Debt +5%
        let mild_hf = Self::run_stress_scenario(env, &sim_collaterals, &sim_borrows, -1000, 500)?;
        // 2. Moderate Stress: Collateral -25%, Debt +10%
        let moderate_hf =
            Self::run_stress_scenario(env, &sim_collaterals, &sim_borrows, -2500, 1000)?;
        // 3. Severe Stress: Collateral -50%, Debt +20%
        let severe_hf =
            Self::run_stress_scenario(env, &sim_collaterals, &sim_borrows, -5000, 2000)?;

        let shortfall_usd = if sim_health.is_liquidatable {
            sim_health.total_borrowed_usd - sim_health.liquidation_threshold_usd
        } else {
            0
        };

        Ok(SimulationResult {
            initial_health_factor_bps: initial_health.health_factor_bps,
            simulated_health_factor_bps: sim_health.health_factor_bps,
            simulated_collateral_usd: sim_health.total_collateral_usd,
            simulated_debt_usd: sim_health.total_borrowed_usd,
            simulated_liquidation_threshold_usd: sim_health.liquidation_threshold_usd,
            simulated_risk_tier: sim_health.risk_tier,
            is_liquidatable: sim_health.is_liquidatable,
            shortfall_usd,
            max_withdrawable_usd: sim_health.max_withdrawable_usd,
            max_borrowable_usd: sim_health.max_borrowable_usd,
            stress_scenario_mild_hf_bps: mild_hf,
            stress_scenario_moderate_hf_bps: moderate_hf,
            stress_scenario_severe_hf_bps: severe_hf,
        })
    }

    /// Evaluates a synthetic stress scenario on a position.
    fn run_stress_scenario(
        env: &Env,
        collaterals: &Vec<CollateralAsset>,
        borrows: &Vec<BorrowAsset>,
        collateral_shock_bps: i32,
        debt_shock_bps: i32,
    ) -> Result<u64, LendError> {
        let mut stressed_collaterals: Vec<CollateralAsset> = Vec::new(env);
        for i in 0..collaterals.len() {
            let mut col = collaterals.get(i).unwrap();
            let mult = (BPS_SCALING as i64) + (collateral_shock_bps as i64);
            if mult > 0 {
                col.price_usd = ((col.price_usd as i64) * mult / (BPS_SCALING as i64)) as i128;
            } else {
                col.price_usd = 1;
            }
            stressed_collaterals.push_back(col);
        }

        let mut stressed_borrows: Vec<BorrowAsset> = Vec::new(env);
        for i in 0..borrows.len() {
            let mut b = borrows.get(i).unwrap();
            let mult = (BPS_SCALING as i64) + (debt_shock_bps as i64);
            if mult > 0 {
                b.price_usd = ((b.price_usd as i64) * mult / (BPS_SCALING as i64)) as i128;
            }
            stressed_borrows.push_back(b);
        }

        let health = Self::calculate_position_health(env, &stressed_collaterals, &stressed_borrows)?;
        Ok(health.health_factor_bps)
    }
}
