//! Lending Protocol Budget Planner Module
//!
//! This module provides comprehensive budget planning and analytics tools for
//! lenders in prediction markets. It helps lenders:
//! - Calculate optimal capital allocation
//! - Project returns and risks
//! - Track portfolio performance
//! - Plan liquidity needs
//! - Optimize fee structures
//!
//! # Features
//!
//! - Risk-adjusted return calculations
//! - Portfolio diversification analysis
//! - Liquidity planning tools
//! - Fee optimization
//! - Historical performance tracking
//! - Scenario modeling
//!
//! # Security Measures
//!
//! - Read-only operations (no state mutations)
//! - Input validation on all parameters
//! - Overflow protection in calculations
//! - Access control where applicable
//!
//! Issue #1110: Build lending protocol budget planner for lenders

// #1234 — This module used to be gated behind `#![cfg(test)]`, which meant the
// planner was stripped from every real build: `soroban build` never compiled it,
// no `BudgetPlan` appeared in the contract spec, and no caller could reach it.
// Only the `test` section at the bottom of this file is test-only now.
use super::*;
use soroban_sdk::{contracttype, Address, Env};

// ============================================================================
// Core Budget Planning Types
// ============================================================================

/// Portfolio allocation strategy for lenders
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum AllocationStrategy {
    /// Equal distribution across all pools
    EqualWeight = 0,
    /// Weight by pool size (larger pools get more)
    SizeWeighted = 1,
    /// Weight by expected return
    ReturnWeighted = 2,
    /// Weight by risk-adjusted return (Sharpe ratio)
    RiskAdjusted = 3,
    /// Custom weights provided by lender
    Custom = 4,
}

/// Risk tolerance levels for portfolio planning
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum RiskTolerance {
    Conservative = 0,
    Moderate = 1,
    Aggressive = 2,
}

/// Timeframe for budget planning
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum PlanningHorizon {
    /// 1-7 days
    ShortTerm = 0,
    /// 1-4 weeks
    MediumTerm = 1,
    /// 1-3 months
    LongTerm = 2,
}

/// Individual pool budget allocation
#[derive(Clone, Debug)]
#[contracttype]
pub struct PoolAllocation {
    pub pool_id: u32,
    pub allocated_amount: i128,
    pub weight_pct: i128, // Basis points (10000 = 100%)
    pub expected_return: i128,
    pub risk_score: i128,
}

/// Complete budget plan for a lender
#[derive(Clone, Debug)]
#[contracttype]
pub struct BudgetPlan {
    pub lender: Address,
    pub total_budget: i128,
    pub allocated_amount: i128,
    pub reserve_amount: i128,
    pub allocations: Vec<PoolAllocation>,
    pub strategy: AllocationStrategy,
    pub expected_total_return: i128,
    pub portfolio_risk_score: i128,
    pub diversification_score: i128,
}

/// Portfolio performance metrics
#[derive(Clone, Debug)]
#[contracttype]
pub struct PortfolioMetrics {
    pub total_invested: i128,
    pub current_value: i128,
    pub total_return: i128,
    pub return_pct: i128, // Basis points
    pub fee_revenue: i128,
    pub active_pools: u32,
    pub settled_pools: u32,
    pub sharpe_ratio: i128, // Scaled by 100
}

/// Liquidity projection for planning
#[derive(Clone, Debug)]
#[contracttype]
pub struct LiquidityProjection {
    pub current_liquid: i128,
    pub locked_until_timestamp: u64,
    pub expected_returns_7d: i128,
    pub expected_returns_30d: i128,
    pub minimum_reserve_needed: i128,
    pub excess_capacity: i128,
}

/// Fee optimization recommendation
#[derive(Clone, Debug)]
#[contracttype]
pub struct FeeOptimization {
    pub current_fee_bps: u32,
    pub recommended_fee_bps: u32,
    pub expected_volume_impact_pct: i128,
    pub expected_revenue_impact: i128,
    pub competitiveness_score: i128, // 0-100
}

/// Risk assessment for a pool or portfolio
#[derive(Clone, Debug)]
#[contracttype]
pub struct RiskAssessment {
    pub volatility_score: i128,      // 0-100
    pub liquidity_risk: i128,        // 0-100
    pub concentration_risk: i128,    // 0-100
    pub time_risk: i128,             // 0-100 (time to expiry)
    pub overall_risk_score: i128,    // 0-100 (weighted average)
}

// ============================================================================
// Budget Planning Engine
// ============================================================================

/// Main budget planner interface
pub struct BudgetPlanner;

impl BudgetPlanner {
    /// Create an optimal budget plan based on lender preferences
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `lender` - Lender address
    /// * `total_budget` - Total capital available
    /// * `strategy` - Allocation strategy
    /// * `risk_tolerance` - Risk appetite
    /// * `reserve_pct` - Percentage to keep in reserve (basis points)
    ///
    /// # Returns
    /// Complete budget plan with pool allocations
    pub fn create_plan(
        env: &Env,
        lender: &Address,
        total_budget: i128,
        strategy: AllocationStrategy,
        risk_tolerance: RiskTolerance,
        reserve_pct: u32,
    ) -> Result<BudgetPlan, ContractError> {
        // Input validation
        if total_budget <= 0 {
            return Err(ContractError::InvalidBetAmount);
        }
        if reserve_pct > 10_000 {
            return Err(ContractError::InvalidBetAmount);
        }

        // Calculate reserve amount
        let reserve_amount = Self::calculate_reserve(total_budget, reserve_pct)?;
        let allocatable = total_budget
            .checked_sub(reserve_amount)
            .ok_or(ContractError::PoolTotalOverflow)?;

        // Get eligible pools based on risk tolerance
        let eligible_pools = Self::get_eligible_pools(env, risk_tolerance)?;

        // Calculate allocations based on strategy
        let allocations = Self::calculate_allocations(
            env,
            &eligible_pools,
            allocatable,
            &strategy,
        )?;

        // Calculate expected returns and risk
        let expected_total_return = Self::calculate_expected_return(&allocations)?;
        let portfolio_risk_score = Self::calculate_portfolio_risk(&allocations)?;
        let diversification_score = Self::calculate_diversification(&allocations)?;

        Ok(BudgetPlan {
            lender: lender.clone(),
            total_budget,
            allocated_amount: allocatable,
            reserve_amount,
            allocations,
            strategy,
            expected_total_return,
            portfolio_risk_score,
            diversification_score,
        })
    }

    /// Get current portfolio performance for a lender
    pub fn get_portfolio_metrics(
        env: &Env,
        lender: &Address,
    ) -> Result<PortfolioMetrics, ContractError> {
        let mut total_invested = 0i128;
        let mut current_value = 0i128;
        let fee_revenue = 0i128;
        let mut active_pools = 0u32;
        let mut settled_pools = 0u32;

        let pool_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);

        for pool_id in 1..=pool_count {
            let bet_key = DataKey::UserBet(pool_id, lender.clone());
            if let Some(bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&bet_key)
            {
                total_invested += bet.total_bet;

                if let Some(pool) = env
                    .storage()
                    .persistent()
                    .get::<_, Pool>(&DataKey::Pool(pool_id))
                {
                    match &pool.status {
                        PoolStatus::Open => {
                            active_pools += 1;
                            current_value += bet.total_bet;
                        }
                        PoolStatus::Settled(winning_outcome) => {
                            settled_pools += 1;
                            let user_outcome_bets = PredinexContract::read_user_outcome_bets(
                                env,
                                pool_id,
                                lender.clone(),
                                &bet,
                            );
                            let winning_bet = user_outcome_bets.get(*winning_outcome).unwrap_or(0);
                            if winning_bet > 0 {
                                let outcome_totals = PredinexContract::read_outcome_totals(
                                    env,
                                    pool_id,
                                    &pool,
                                );
                                let total_pool = PredinexContract::sum_totals(&outcome_totals)?;
                                let outcome_total = outcome_totals.get(*winning_outcome).unwrap_or(0);
                                if outcome_total > 0 {
                                    current_value += winning_bet
                                        .checked_mul(total_pool)
                                        .and_then(|v| v.checked_div(outcome_total))
                                        .ok_or(ContractError::PoolTotalOverflow)?;
                                }
                            }
                        }
                        _ => {
                            active_pools += 1;
                            current_value += bet.total_bet;
                        }
                    }
                }
            }
        }

        let total_return = current_value
            .checked_sub(total_invested)
            .ok_or(ContractError::PoolTotalOverflow)?;

        let return_pct = if total_invested > 0 {
            total_return
                .checked_mul(10_000)
                .and_then(|v| v.checked_div(total_invested))
                .ok_or(ContractError::PoolTotalOverflow)?
        } else {
            0
        };

        // Calculate Sharpe ratio (simplified)
        let sharpe_ratio = if total_invested > 0 {
            (return_pct * 100) / 1_000 // Simplified risk adjustment
        } else {
            0
        };

        Ok(PortfolioMetrics {
            total_invested,
            current_value,
            total_return,
            return_pct,
            fee_revenue,
            active_pools,
            settled_pools,
            sharpe_ratio,
        })
    }

    /// Project liquidity needs over time
    pub fn project_liquidity(
        env: &Env,
        lender: &Address,
        _horizon: PlanningHorizon,
    ) -> Result<LiquidityProjection, ContractError> {
        let current_liquid = Self::get_liquid_balance(env, lender)?;
        let locked_until = Self::get_earliest_unlock_time(env, lender)?;

        // Project returns based on current positions
        let expected_7d = Self::project_returns(env, lender, 7)?;
        let expected_30d = Self::project_returns(env, lender, 30)?;

        // Calculate minimum reserve needed
        let minimum_reserve = Self::calculate_minimum_reserve(env, lender)?;

        let excess_capacity = current_liquid
            .checked_sub(minimum_reserve)
            .ok_or(ContractError::PoolTotalOverflow)?
            .max(0);

        Ok(LiquidityProjection {
            current_liquid,
            locked_until_timestamp: locked_until,
            expected_returns_7d: expected_7d,
            expected_returns_30d: expected_30d,
            minimum_reserve_needed: minimum_reserve,
            excess_capacity,
        })
    }

    /// Optimize fee structure for better returns
    pub fn optimize_fees(
        _env: &Env,
        current_fee_bps: u32,
        avg_pool_size: i128,
        competitor_fees: Vec<u32>,
    ) -> Result<FeeOptimization, ContractError> {
        // Calculate market average
        let market_avg = if competitor_fees.len() > 0 {
            let sum: u32 = competitor_fees.iter().sum();
            sum / competitor_fees.len()
        } else {
            current_fee_bps
        };

        // Recommend fee based on competitiveness
        let recommended_fee = Self::calculate_optimal_fee(
            current_fee_bps,
            market_avg,
            avg_pool_size,
        )?;

        // Project impact
        let volume_impact = Self::estimate_volume_impact(
            current_fee_bps,
            recommended_fee,
        )?;

        let revenue_impact = Self::estimate_revenue_impact(
            avg_pool_size,
            current_fee_bps,
            recommended_fee,
            volume_impact,
        )?;

        let competitiveness = Self::calculate_competitiveness(
            recommended_fee,
            market_avg,
        )?;

        Ok(FeeOptimization {
            current_fee_bps,
            recommended_fee_bps: recommended_fee,
            expected_volume_impact_pct: volume_impact,
            expected_revenue_impact: revenue_impact,
            competitiveness_score: competitiveness,
        })
    }

    /// Assess risk for a specific pool or portfolio
    pub fn assess_risk(
        env: &Env,
        pool_ids: &Vec<u32>,
    ) -> Result<RiskAssessment, ContractError> {
        let mut total_volatility = 0i128;
        let mut total_liquidity_risk = 0i128;
        let mut total_time_risk = 0i128;

        for pool_id in pool_ids.iter() {
            let volatility = Self::calculate_volatility(env, pool_id)?;
            let liquidity = Self::calculate_liquidity_risk(env, pool_id)?;
            let time_risk = Self::calculate_time_risk(env, pool_id)?;

            total_volatility += volatility;
            total_liquidity_risk += liquidity;
            total_time_risk += time_risk;
        }

        let count = pool_ids.len() as i128;
        let volatility_score = if count > 0 { total_volatility / count } else { 0 };
        let liquidity_risk = if count > 0 { total_liquidity_risk / count } else { 0 };
        let time_risk = if count > 0 { total_time_risk / count } else { 0 };

        // Calculate concentration risk
        let concentration_risk = Self::calculate_concentration_risk(pool_ids)?;

        // Weighted average for overall score
        let overall_risk_score = (volatility_score * 30
            + liquidity_risk * 25
            + concentration_risk * 25
            + time_risk * 20)
            / 100;

        Ok(RiskAssessment {
            volatility_score,
            liquidity_risk,
            concentration_risk,
            time_risk,
            overall_risk_score,
        })
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    fn calculate_reserve(total: i128, pct_bps: u32) -> Result<i128, ContractError> {
        total
            .checked_mul(pct_bps as i128)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ContractError::PoolTotalOverflow)
    }

    fn get_eligible_pools(
        env: &Env,
        risk_tolerance: RiskTolerance,
    ) -> Result<Vec<u32>, ContractError> {
        let mut pools = Vec::new(env);

        let pool_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);

        for pool_id in 1..=pool_count {
            if let Some(pool) = env
                .storage()
                .persistent()
                .get::<_, Pool>(&DataKey::Pool(pool_id))
            {
                // Only consider open pools
                if pool.status != PoolStatus::Open {
                    continue;
                }

                let outcome_totals = PredinexContract::read_outcome_totals(env, pool_id, &pool);
                let total_pool = PredinexContract::sum_totals(&outcome_totals)?;

                let eligible = match risk_tolerance {
                    RiskTolerance::Conservative => {
                        // Only well-established pools with sufficient liquidity
                        pool.participant_count >= 5 && total_pool >= 10_000_000
                    }
                    RiskTolerance::Moderate => {
                        // Pools with some activity
                        pool.participant_count >= 2 && total_pool >= 1_000_000
                    }
                    RiskTolerance::Aggressive => {
                        // All open pools qualify
                        true
                    }
                };

                if eligible {
                    pools.push_back(pool_id);
                }
            }
        }

        Ok(pools)
    }

    fn calculate_allocations(
        env: &Env,
        pool_ids: &Vec<u32>,
        total_amount: i128,
        strategy: &AllocationStrategy,
    ) -> Result<Vec<PoolAllocation>, ContractError> {
        let mut allocations = Vec::new(env);

        if pool_ids.is_empty() {
            return Ok(allocations);
        }

        match strategy {
            AllocationStrategy::SizeWeighted => {
                // Weight by pool size — larger pools get proportionally more
                let mut total_size = 0i128;
                let mut pool_sizes = Vec::<(u32, i128)>::new(env);
                for pool_id in pool_ids.iter() {
                    if let Some(pool) = env
                        .storage()
                        .persistent()
                        .get::<_, Pool>(&DataKey::Pool(pool_id))
                    {
                        let outcome_totals = PredinexContract::read_outcome_totals(env, pool_id, &pool);
                        let size = PredinexContract::sum_totals(&outcome_totals)?;
                        total_size += size;
                        pool_sizes.push_back((pool_id, size));
                    }
                }

                if total_size == 0 {
                    // Fall back to equal weight if all pools are empty
                    return Self::calculate_allocations(
                        env,
                        pool_ids,
                        total_amount,
                        &AllocationStrategy::EqualWeight,
                    );
                }

                for (pool_id, size) in pool_sizes.iter() {
                    let weight_pct = size
                        .checked_mul(10_000)
                        .and_then(|v| v.checked_div(total_size))
                        .ok_or(ContractError::PoolTotalOverflow)?;
                    let allocated = total_amount
                        .checked_mul(weight_pct)
                        .and_then(|v| v.checked_div(10_000))
                        .ok_or(ContractError::PoolTotalOverflow)?;
                    let risk = Self::volatility_or_default(env, pool_id)?;

                    allocations.push_back(PoolAllocation {
                        pool_id,
                        allocated_amount: allocated,
                        weight_pct,
                        expected_return: allocated
                            .checked_mul(500)
                            .and_then(|v| v.checked_div(10_000))
                            .ok_or(ContractError::PoolTotalOverflow)?,
                        risk_score: risk,
                    });
                }
            }
            AllocationStrategy::RiskAdjusted => {
                // Allocate inversely proportional to risk (lower risk → more allocation)
                let mut total_inv_risk = 0i128;
                let mut pool_risks = Vec::<(u32, i128)>::new(env);
                for pool_id in pool_ids.iter() {
                    let risk = Self::volatility_or_default(env, pool_id)?;
                    let inv_risk = (101 - risk).max(1); // invert: low risk → high weight
                    total_inv_risk += inv_risk;
                    pool_risks.push_back((pool_id, inv_risk));
                }

                if total_inv_risk == 0 {
                    total_inv_risk = 1;
                }

                for (pool_id, inv_risk) in pool_risks.iter() {
                    let weight_pct = inv_risk
                        .checked_mul(10_000)
                        .and_then(|v| v.checked_div(total_inv_risk))
                        .ok_or(ContractError::PoolTotalOverflow)?;
                    let allocated = total_amount
                        .checked_mul(weight_pct)
                        .and_then(|v| v.checked_div(10_000))
                        .ok_or(ContractError::PoolTotalOverflow)?;
                    let risk = 101 - inv_risk;

                    allocations.push_back(PoolAllocation {
                        pool_id,
                        allocated_amount: allocated,
                        weight_pct,
                        expected_return: allocated
                            .checked_mul(500)
                            .and_then(|v| v.checked_div(10_000))
                            .ok_or(ContractError::PoolTotalOverflow)?,
                        risk_score: risk,
                    });
                }
            }
            // EqualWeight, ReturnWeighted, and Custom all use equal weight
            _ => {
                let per_pool = total_amount / pool_ids.len() as i128;
                let base_weight = 10_000 / pool_ids.len() as i128;
                let mut assigned_weight = 0i128;

                for (index, pool_id) in pool_ids.iter().enumerate() {
                    let weight_pct = if index + 1 == pool_ids.len() as usize {
                        10_000 - assigned_weight
                    } else {
                        base_weight
                    };
                    assigned_weight += weight_pct;
                    let risk = Self::volatility_or_default(env, pool_id)?;
                    allocations.push_back(PoolAllocation {
                        pool_id,
                        allocated_amount: per_pool,
                        weight_pct,
                        expected_return: per_pool
                            .checked_mul(500)
                            .and_then(|v| v.checked_div(10_000))
                            .ok_or(ContractError::PoolTotalOverflow)?,
                        risk_score: risk,
                    });
                }
            }
        }

        Ok(allocations)
    }

    fn calculate_expected_return(
        allocations: &Vec<PoolAllocation>,
    ) -> Result<i128, ContractError> {
        let mut total = 0i128;
        for alloc in allocations.iter() {
            total = total
                .checked_add(alloc.expected_return)
                .ok_or(ContractError::PoolTotalOverflow)?;
        }
        Ok(total)
    }

    fn calculate_portfolio_risk(
        allocations: &Vec<PoolAllocation>,
    ) -> Result<i128, ContractError> {
        if allocations.is_empty() {
            return Ok(0);
        }

        let mut weighted_risk = 0i128;
        for alloc in allocations.iter() {
            let contribution = alloc
                .risk_score
                .checked_mul(alloc.weight_pct)
                .and_then(|v| v.checked_div(10_000))
                .ok_or(ContractError::PoolTotalOverflow)?;

            weighted_risk = weighted_risk
                .checked_add(contribution)
                .ok_or(ContractError::PoolTotalOverflow)?;
        }

        Ok(weighted_risk)
    }

    fn calculate_diversification(
        allocations: &Vec<PoolAllocation>,
    ) -> Result<i128, ContractError> {
        if allocations.is_empty() {
            return Ok(0);
        }

        // Higher score for more pools and more even distribution
        let pool_count_score = (allocations.len() as i128 * 10).min(50);

        // Calculate variance in weights for distribution score
        let avg_weight = 10_000 / allocations.len() as i128;
        let mut variance = 0i128;

        for alloc in allocations.iter() {
            let diff = (alloc.weight_pct - avg_weight).abs();
            variance += diff;
        }

        let distribution_score = (50 - (variance / allocations.len() as i128 / 100)).max(0);

        Ok(pool_count_score + distribution_score)
    }

    fn get_liquid_balance(env: &Env, lender: &Address) -> Result<i128, ContractError> {
        // Sum up bets in open pools that haven't expired yet (still liquid)
        let mut liquid = 0i128;
        let pool_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);
        let now = env.ledger().timestamp();

        for pool_id in 1..=pool_count {
            let bet_key = DataKey::UserBet(pool_id, lender.clone());
            if let Some(bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&bet_key)
            {
                if let Some(pool) = env
                    .storage()
                    .persistent()
                    .get::<_, Pool>(&DataKey::Pool(pool_id))
                {
                    // Position is liquid if pool is still open and not yet at deposit deadline
                    if pool.status == PoolStatus::Open && now < pool.deposit_deadline {
                        liquid += bet.total_bet;
                    }
                }
            }
        }

        Ok(liquid)
    }

    fn get_earliest_unlock_time(env: &Env, lender: &Address) -> Result<u64, ContractError> {
        let pool_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);
        let mut earliest: u64 = u64::MAX;

        for pool_id in 1..=pool_count {
            let bet_key = DataKey::UserBet(pool_id, lender.clone());
            if env.storage().persistent().has(&bet_key) {
                if let Some(pool) = env
                    .storage()
                    .persistent()
                    .get::<_, Pool>(&DataKey::Pool(pool_id))
                {
                    if pool.status == PoolStatus::Open && pool.expiry < earliest {
                        earliest = pool.expiry;
                    }
                }
            }
        }

        Ok(if earliest == u64::MAX { 0 } else { earliest })
    }

    fn project_returns(
        env: &Env,
        lender: &Address,
        days: u64,
    ) -> Result<i128, ContractError> {
        // Project returns based on current positions in open pools
        let mut projected = 0i128;
        let pool_count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PoolCounter)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        let horizon_secs = days * 86_400;

        for pool_id in 1..=pool_count {
            let bet_key = DataKey::UserBet(pool_id, lender.clone());
            if let Some(bet) = env
                .storage()
                .persistent()
                .get::<_, UserBet>(&bet_key)
            {
                if let Some(pool) = env
                    .storage()
                    .persistent()
                    .get::<_, Pool>(&DataKey::Pool(pool_id))
                {
                    if pool.status == PoolStatus::Open {
                        let outcome_totals = PredinexContract::read_outcome_totals(env, pool_id, &pool);
                        let total_pool = PredinexContract::sum_totals(&outcome_totals)?;
                        if total_pool > 0 && pool.expiry > now {
                            // Estimate return: assume fair odds, expected value is
                            // proportional to how close to expiry the pool is
                            let time_remaining = pool.expiry - now;
                            if time_remaining <= horizon_secs {
                                // Pool will settle within projection window
                                // Expected value at fair odds is the bet amount
                                // (breakeven), but pools typically have fee revenue
                                let fee_return = bet
                                    .total_bet
                                    .checked_mul(200) // 2% expected fee return
                                    .and_then(|v| v.checked_div(10_000))
                                    .ok_or(ContractError::PoolTotalOverflow)?;
                                projected += fee_return;
                            }
                        }
                    }
                }
            }
        }

        Ok(projected)
    }

    fn calculate_minimum_reserve(env: &Env, lender: &Address) -> Result<i128, ContractError> {
        // Minimum 10% of total portfolio value
        let metrics = Self::get_portfolio_metrics(env, lender)?;
        Ok(metrics
            .current_value
            .checked_mul(1_000)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ContractError::PoolTotalOverflow)?)
    }

    fn calculate_optimal_fee(
        _current: u32,
        market_avg: u32,
        _pool_size: i128,
    ) -> Result<u32, ContractError> {
        // Recommend slightly below market average for competitiveness
        let optimal = (market_avg * 95) / 100;
        Ok(optimal.max(50).min(1000)) // Cap between 0.5% and 10%
    }

    fn estimate_volume_impact(current: u32, new: u32) -> Result<i128, ContractError> {
        // Simplified elasticity model
        if current == 0 {
            return Err(ContractError::FeeOutOfBounds);
        }
        let fee_change_pct = ((new as i128 - current as i128) * 100) / current as i128;
        let volume_impact = fee_change_pct * -2; // -2% volume per 1% fee increase
        Ok(volume_impact)
    }

    fn estimate_revenue_impact(
        pool_size: i128,
        current_fee: u32,
        new_fee: u32,
        volume_impact_pct: i128,
    ) -> Result<i128, ContractError> {
        let current_revenue = pool_size
            .checked_mul(current_fee as i128)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ContractError::PoolTotalOverflow)?;

        let new_volume = pool_size
            .checked_mul(100 + volume_impact_pct)
            .and_then(|v| v.checked_div(100))
            .ok_or(ContractError::PoolTotalOverflow)?;

        let new_revenue = new_volume
            .checked_mul(new_fee as i128)
            .and_then(|v| v.checked_div(10_000))
            .ok_or(ContractError::PoolTotalOverflow)?;

        Ok(new_revenue - current_revenue)
    }

    fn calculate_competitiveness(fee: u32, market_avg: u32) -> Result<i128, ContractError> {
        // Score 0-100, higher is better
        // Without market data, use a neutral score.
        if market_avg == 0 {
            return Ok(50);
        }
        if fee <= market_avg {
            let discount_pct = ((market_avg - fee) as i128 * 100) / market_avg as i128;
            Ok(50 + discount_pct.min(50))
        } else {
            let premium_pct = ((fee - market_avg) as i128 * 100) / market_avg as i128;
            Ok((50 - premium_pct).max(0))
        }
    }

    /// Volatility for allocation scoring. A pool that cannot be read scores the
    /// neutral 50; an arithmetic overflow is a real error and is propagated
    /// rather than disguised as that neutral score.
    fn volatility_or_default(env: &Env, pool_id: u32) -> Result<i128, ContractError> {
        match Self::calculate_volatility(env, pool_id) {
            Ok(v) => Ok(v),
            Err(ContractError::PoolNotFound) => Ok(50),
            Err(e) => Err(e),
        }
    }

    fn calculate_volatility(env: &Env, pool_id: u32) -> Result<i128, ContractError> {
        if let Some(pool) = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            let outcome_totals = PredinexContract::read_outcome_totals(env, pool_id, &pool);
            let total = PredinexContract::sum_totals(&outcome_totals)?;
            if total == 0 {
                return Ok(50); // Unknown volatility for empty pool
            }
            // Measure imbalance: maximum outcome stake vs total
            let mut majority = 0i128;
            for t in outcome_totals.iter() {
                if t > majority {
                    majority = t;
                }
            }
            let ratio = majority
                .checked_mul(100)
                .and_then(|v| v.checked_div(total))
                .ok_or(ContractError::PoolTotalOverflow)?;
            // ratio is 50-100; convert to 0-100 volatility score
            let volatility = ((ratio.saturating_sub(50)) * 2).min(100);
            Ok(volatility)
        } else {
            Err(ContractError::PoolNotFound)
        }
    }

    fn calculate_liquidity_risk(env: &Env, pool_id: u32) -> Result<i128, ContractError> {
        if let Some(pool) = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            let outcome_totals = PredinexContract::read_outcome_totals(env, pool_id, &pool);
            let total = PredinexContract::sum_totals(&outcome_totals)?;
            // Higher pool size and more participants = lower risk
            let size_factor = (total / 1_000_000).min(50);
            let participant_factor =
                (pool.participant_count as i128 * 5).min(50);
            let risk = (100 - size_factor - participant_factor).max(0);
            Ok(risk)
        } else {
            Err(ContractError::PoolNotFound)
        }
    }

    fn calculate_time_risk(env: &Env, pool_id: u32) -> Result<i128, ContractError> {
        if let Some(pool) = env
            .storage()
            .persistent()
            .get::<_, Pool>(&DataKey::Pool(pool_id))
        {
            let now = env.ledger().timestamp();
            if pool.expiry <= now {
                return Ok(100); // Expired = max risk
            }
            let time_remaining = pool.expiry - now;
            // Shorter remaining time = higher risk
            let risk = if time_remaining < 86_400 {
                90 // < 1 day
            } else if time_remaining < 604_800 {
                50 // < 1 week
            } else if time_remaining < 2_592_000 {
                30 // < 1 month
            } else {
                10 // > 1 month
            };
            Ok(risk)
        } else {
            Err(ContractError::PoolNotFound)
        }
    }

    fn calculate_concentration_risk(pool_ids: &Vec<u32>) -> Result<i128, ContractError> {
        // Lower score for more concentrated portfolios
        let count = pool_ids.len() as i128;
        if count == 0 {
            return Ok(100);
        }

        // Risk decreases with diversification
        let score = (100 * count / (count + 10)).min(100);
        Ok(100 - score)
    }
}

// ============================================================================
// Tests
// ============================================================================
//
// #1234 — Only this section is test-only. The planner itself is compiled into
// the contract; its tests are not shipped.

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};


/// Helper to create a pool directly in storage for testing.
/// Must be called inside `env.as_contract(contract_id, || { ... })`.
fn setup_test_pool(
    env: &Env,
    pool_id: u32,
    total_a: i128,
    total_b: i128,
    participant_count: u32,
    expiry: u64,
) {
    let pool = Pool {
        creator: Address::generate(env),
        title: String::from_str(env, "Test Pool"),
        description: String::from_str(env, "Test"),
        outcome_a_name: String::from_str(env, "Yes"),
        outcome_b_name: String::from_str(env, "No"),
        total_a,
        total_b,
        participant_count,
        settled: false,
        winning_outcome: None,
        created_at: 1_000_000,
        expiry,
        deposit_deadline: expiry,
        status: PoolStatus::Open,
        cumulative_volume: total_a.saturating_add(total_b),
        template_id: None,
    };
    env.storage()
        .persistent()
        .set(&DataKey::Pool(pool_id), &pool);

    // Update pool counter
    let current: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::PoolCounter)
        .unwrap_or(0);
    if pool_id > current {
        env.storage()
            .persistent()
            .set(&DataKey::PoolCounter, &pool_id);
    }
}

fn setup_user_bet(env: &Env, pool_id: u32, user: &Address, amount_a: i128, amount_b: i128) {
    let bet = UserBet {
        amount_a,
        amount_b,
        total_bet: amount_a + amount_b,
    };
    env.storage()
        .persistent()
        .set(&DataKey::UserBet(pool_id, user.clone()), &bet);
}

/// Register a dummy contract and return its address for use with `as_contract`.
fn test_contract(env: &Env) -> Address {
    env.register(PredinexContract, ())
}

#[test]
fn test_risk_tolerance_changes_allocation() {
    let env = Env::default();
    let lender = Address::generate(&env);
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Pool 1: well-established, high liquidity (eligible for all tolerances)
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 10, now + 2_592_000);
        // Pool 2: moderate activity (eligible for moderate + aggressive only)
        setup_test_pool(&env, 2, 5_000_000, 5_000_000, 3, now + 604_800);
        // Pool 3: small/new pool (eligible for aggressive only)
        setup_test_pool(&env, 3, 100_000, 100_000, 1, now + 86_400);

        let conservative = BudgetPlanner::create_plan(
            &env,
            &lender,
            1_000_000,
            AllocationStrategy::EqualWeight,
            RiskTolerance::Conservative,
            1_000,
        )
        .unwrap();

        let moderate = BudgetPlanner::create_plan(
            &env,
            &lender,
            1_000_000,
            AllocationStrategy::EqualWeight,
            RiskTolerance::Moderate,
            1_000,
        )
        .unwrap();

        let aggressive = BudgetPlanner::create_plan(
            &env,
            &lender,
            1_000_000,
            AllocationStrategy::EqualWeight,
            RiskTolerance::Aggressive,
            1_000,
        )
        .unwrap();

        // Conservative should have fewer pools than moderate, which has fewer than aggressive
        assert_eq!(conservative.allocations.len(), 1);
        assert_eq!(moderate.allocations.len(), 2);
        assert_eq!(aggressive.allocations.len(), 3);

        // Different pool counts → different per-pool allocations
        assert_ne!(
            conservative.allocations.first().unwrap().allocated_amount,
            aggressive.allocations.first().unwrap().allocated_amount,
        );
    });
}

#[test]
fn test_volatility_reads_pool_state() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Balanced pool: 50/50 → low volatility
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 10, now + 2_592_000);
        // Imbalanced pool: 90/10 → high volatility
        setup_test_pool(&env, 2, 90_000_000, 10_000_000, 10, now + 2_592_000);

        let balanced_vol = BudgetPlanner::calculate_volatility(&env, 1).unwrap();
        let imbalanced_vol = BudgetPlanner::calculate_volatility(&env, 2).unwrap();

        assert_eq!(balanced_vol, 0); // 50% majority → 0 volatility
        assert_eq!(imbalanced_vol, 80); // 90% majority → 80 volatility
        assert!(imbalanced_vol > balanced_vol);
    });
}

#[test]
fn test_liquidity_risk_reads_pool_state() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Large pool: low liquidity risk
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 20, now + 2_592_000);
        // Small pool: high liquidity risk
        setup_test_pool(&env, 2, 500, 500, 2, now + 2_592_000);

        let large_risk = BudgetPlanner::calculate_liquidity_risk(&env, 1).unwrap();
        let small_risk = BudgetPlanner::calculate_liquidity_risk(&env, 2).unwrap();

        assert!(large_risk < small_risk);
    });
}

#[test]
fn test_time_risk_reads_pool_state() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Pool expiring in > 1 month
        setup_test_pool(&env, 1, 10_000_000, 10_000_000, 5, now + 5_000_000);
        // Pool expiring in < 1 day
        setup_test_pool(&env, 2, 10_000_000, 10_000_000, 5, now + 3_600);

        let far_risk = BudgetPlanner::calculate_time_risk(&env, 1).unwrap();
        let near_risk = BudgetPlanner::calculate_time_risk(&env, 2).unwrap();

        assert_eq!(far_risk, 10);
        assert_eq!(near_risk, 90);
        assert!(near_risk > far_risk);
    });
}

#[test]
fn test_portfolio_metrics_iterates_positions() {
    let env = Env::default();
    let lender = Address::generate(&env);
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Create pools and place bets
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 10, now + 2_592_000);
        setup_test_pool(&env, 2, 20_000_000, 30_000_000, 5, now + 604_800);

        setup_user_bet(&env, 1, &lender, 1_000_000, 0);
        setup_user_bet(&env, 2, &lender, 0, 500_000);

        let metrics = BudgetPlanner::get_portfolio_metrics(&env, &lender).unwrap();

        assert_eq!(metrics.total_invested, 1_500_000);
        assert_eq!(metrics.current_value, 1_500_000); // Both pools are open
        assert_eq!(metrics.active_pools, 2);
        assert_eq!(metrics.settled_pools, 0);
    });
}

#[test]
fn test_assess_risk_uses_real_pool_data() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Create a balanced, large pool expiring far away (low risk)
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 20, now + 5_000_000);
        // Create an imbalanced, small pool expiring soon (high risk)
        setup_test_pool(&env, 2, 900, 100, 2, now + 3_600);

        let mut low_risk_ids = Vec::new(&env);
        low_risk_ids.push_back(1u32);

        let mut high_risk_ids = Vec::new(&env);
        high_risk_ids.push_back(2u32);

        let low_assessment = BudgetPlanner::assess_risk(&env, &low_risk_ids).unwrap();
        let high_assessment = BudgetPlanner::assess_risk(&env, &high_risk_ids).unwrap();

        assert!(
            low_assessment.overall_risk_score < high_assessment.overall_risk_score,
            "Low-risk pool scored {} but high-risk pool scored {}",
            low_assessment.overall_risk_score,
            high_assessment.overall_risk_score,
        );
    });
}

#[test]
fn test_liquid_balance_and_unlock_time_reads_positions() {
    let env = Env::default();
    let lender = Address::generate(&env);
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Pool 1: open and expires at now + 500_000
        setup_test_pool(&env, 1, 50_000_000, 50_000_000, 10, now + 500_000);
        // Pool 2: open and expires at now + 1_000_000
        setup_test_pool(&env, 2, 20_000_000, 20_000_000, 5, now + 1_000_000);

        setup_user_bet(&env, 1, &lender, 250_000, 250_000); // 500_000 total
        setup_user_bet(&env, 2, &lender, 100_000, 200_000); // 300_000 total

        let projection = BudgetPlanner::project_liquidity(&env, &lender, PlanningHorizon::MediumTerm).unwrap();

        // Non-zero liquid balance derived from user's bets in open pools
        assert_eq!(projection.current_liquid, 800_000);
        assert!(projection.current_liquid > 0);

        // Earliest unlock time is pool 1's expiry
        assert_eq!(projection.locked_until_timestamp, now + 500_000);
        assert!(projection.locked_until_timestamp > 0);
    });
}


#[test]
fn test_zero_fee_projection_returns_typed_error() {
    let env = Env::default();
    assert_eq!(BudgetPlanner::estimate_volume_impact(0, 50).err(), Some(ContractError::FeeOutOfBounds));
    let competitors = Vec::new(&env);
    assert_eq!(BudgetPlanner::optimize_fees(&env, 0, 1_000_000, competitors).err(), Some(ContractError::FeeOutOfBounds));
    assert_eq!(BudgetPlanner::estimate_volume_impact(100, 101).unwrap(), -2);
    assert_eq!(BudgetPlanner::estimate_volume_impact(100, 150).unwrap(), -100);
}

#[test]
fn test_zero_market_average_has_neutral_competitiveness() {
    assert_eq!(BudgetPlanner::calculate_competitiveness(0, 0).unwrap(), 50);
    assert_eq!(BudgetPlanner::calculate_competitiveness(100, 0).unwrap(), 50);
    assert!(BudgetPlanner::calculate_competitiveness(50, 200).unwrap() > 50);
}

#[test]
fn test_equal_weight_allocations_handle_empty_and_sum_to_full_weight() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        let empty = pool_ids_of(&env, &[]);
        assert!(BudgetPlanner::calculate_allocations(&env, &empty, 10_000, &AllocationStrategy::EqualWeight).unwrap().is_empty());
        for id in 1..=3 {
            setup_test_pool(&env, id, 1_000_000, 1_000_000, 2, 5_000_000);
        }
        for (ids, expected_len) in [(&[1][..], 1u32), (&[1, 2, 3][..], 3u32)] {
            let allocations = BudgetPlanner::calculate_allocations(&env, &pool_ids_of(&env, ids), 10_000, &AllocationStrategy::EqualWeight).unwrap();
            assert_eq!(allocations.len(), expected_len);
            let weights: i128 = allocations.iter().map(|a| a.weight_pct).sum();
            assert_eq!(weights, 10_000);
        }
    });
}

#[test]
fn test_eligible_pool_total_overflow_is_a_typed_error() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, i128::MAX, 1, 5, 5_000_000);
        assert_eq!(BudgetPlanner::get_eligible_pools(&env, RiskTolerance::Aggressive).err(), Some(ContractError::PoolTotalOverflow));
    });
}

#[test]
fn test_eligible_pool_total_boundary_and_zero_are_valid() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, i128::MAX - 1, 1, 5, 5_000_000);
        assert_eq!(
            BudgetPlanner::get_eligible_pools(&env, RiskTolerance::Aggressive).unwrap(),
            pool_ids_of(&env, &[1])
        );

        setup_test_pool(&env, 2, 0, 0, 0, 5_000_000);
        assert_eq!(
            BudgetPlanner::get_eligible_pools(&env, RiskTolerance::Aggressive).unwrap(),
            pool_ids_of(&env, &[1, 2])
        );
    });
}

// ============================================================================
// Overflow is an error, never a zero (issue #1217)
// ============================================================================

/// Largest `allocated` for which `allocated * 500` still fits in `i128`.
const MAX_ALLOCATION_BEFORE_OVERFLOW: i128 = i128::MAX / 500;

fn pool_ids_of(env: &Env, ids: &[u32]) -> Vec<u32> {
    let mut v = Vec::new(env);
    for id in ids {
        v.push_back(*id);
    }
    v
}

#[test]
fn test_expected_return_overflow_is_an_error_not_zero() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, 1_000_000, 1_000_000, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[1]);

        let result = BudgetPlanner::calculate_allocations(
            &env,
            &ids,
            MAX_ALLOCATION_BEFORE_OVERFLOW + 1,
            &AllocationStrategy::EqualWeight,
        );
        assert_eq!(result.err(), Some(ContractError::PoolTotalOverflow));
    });
}

#[test]
fn test_expected_return_is_five_percent_for_normal_allocations() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, 1_000_000, 1_000_000, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[1]);

        let allocations = BudgetPlanner::calculate_allocations(
            &env,
            &ids,
            1_000_000,
            &AllocationStrategy::EqualWeight,
        )
        .unwrap();
        assert_eq!(allocations.get(0).unwrap().expected_return, 50_000);
    });
}

#[test]
fn test_expected_return_boundary_and_zero_allocation() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, 1_000_000, 1_000_000, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[1]);

        // Exactly the largest value that fits: still computed, not an error.
        let at_limit = BudgetPlanner::calculate_allocations(
            &env,
            &ids,
            MAX_ALLOCATION_BEFORE_OVERFLOW,
            &AllocationStrategy::EqualWeight,
        )
        .unwrap();
        assert_eq!(
            at_limit.get(0).unwrap().expected_return,
            (MAX_ALLOCATION_BEFORE_OVERFLOW * 500) / 10_000
        );

        // A genuine zero allocation is a genuine zero return, without error.
        let zero = BudgetPlanner::calculate_allocations(&env, &ids, 0, &AllocationStrategy::EqualWeight)
            .unwrap();
        assert_eq!(zero.get(0).unwrap().expected_return, 0);
    });
}

#[test]
fn test_every_allocation_strategy_propagates_overflow() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        // Balanced pool so weights are finite; only the amount overflows.
        setup_test_pool(&env, 1, 1_000_000, 1_000_000, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[1]);

        for strategy in [
            AllocationStrategy::EqualWeight,
            AllocationStrategy::SizeWeighted,
            AllocationStrategy::ReturnWeighted,
            AllocationStrategy::RiskAdjusted,
        ] {
            let result = BudgetPlanner::calculate_allocations(
                &env,
                &ids,
                MAX_ALLOCATION_BEFORE_OVERFLOW + 1,
                &strategy,
            );
            assert_eq!(result.err(), Some(ContractError::PoolTotalOverflow));
        }
    });
}

#[test]
fn test_size_weighted_overflow_in_pool_size_or_weight_is_an_error() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        // total_a + total_b overflows i128.
        setup_test_pool(&env, 1, i128::MAX, 1, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[1]);
        let sum_overflow = BudgetPlanner::calculate_allocations(
            &env,
            &ids,
            1_000_000,
            &AllocationStrategy::SizeWeighted,
        );
        assert_eq!(sum_overflow.err(), Some(ContractError::PoolTotalOverflow));

        // size * 10_000 overflows i128 (the old code turned this weight into 0).
        setup_test_pool(&env, 2, i128::MAX / 2, 0, 5, 5_000_000);
        let ids = pool_ids_of(&env, &[2]);
        let weight_overflow = BudgetPlanner::calculate_allocations(
            &env,
            &ids,
            1_000_000,
            &AllocationStrategy::SizeWeighted,
        );
        assert_eq!(weight_overflow.err(), Some(ContractError::PoolTotalOverflow));
    });
}

#[test]
fn test_pool_metrics_overflow_is_an_error() {
    let env = Env::default();
    let contract_id = test_contract(&env);
    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, i128::MAX, 1, 5, 5_000_000);

        assert_eq!(
            BudgetPlanner::calculate_volatility(&env, 1).err(),
            Some(ContractError::PoolTotalOverflow)
        );
        assert_eq!(
            BudgetPlanner::calculate_liquidity_risk(&env, 1).err(),
            Some(ContractError::PoolTotalOverflow)
        );
        // An overflow is not disguised as the neutral volatility score...
        assert_eq!(
            BudgetPlanner::volatility_or_default(&env, 1).err(),
            Some(ContractError::PoolTotalOverflow)
        );
        // ...while a pool that simply does not exist still scores the neutral 50.
        assert_eq!(BudgetPlanner::volatility_or_default(&env, 99).unwrap(), 50);
    });
}

#[test]
fn test_projection_and_reserve_overflow_are_errors() {
    let env = Env::default();
    let lender = Address::generate(&env);
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        // Open pool whose total overflows, with a position in it and an expiry
        // inside the 7 day window.
        setup_test_pool(&env, 1, i128::MAX, 1, 5, now + 3_600);
        setup_user_bet(&env, 1, &lender, 1_000, 0);
        assert_eq!(
            BudgetPlanner::project_returns(&env, &lender, 7).err(),
            Some(ContractError::PoolTotalOverflow)
        );
    });

    let lender2 = Address::generate(&env);
    env.as_contract(&contract_id, || {
        // A position so large that 10% of it overflows.
        setup_test_pool(&env, 2, 1_000, 1_000, 5, now + 3_600);
        setup_user_bet(&env, 2, &lender2, i128::MAX / 1_000 + 1, 0);
        assert_eq!(
            BudgetPlanner::calculate_minimum_reserve(&env, &lender2).err(),
            Some(ContractError::PoolTotalOverflow)
        );
    });
}

#[test]
fn test_normal_projection_and_reserve_are_unchanged() {
    let env = Env::default();
    let lender = Address::generate(&env);
    let contract_id = test_contract(&env);
    let now = 2_000_000u64;
    env.ledger().set_timestamp(now);

    env.as_contract(&contract_id, || {
        setup_test_pool(&env, 1, 5_000_000, 5_000_000, 5, now + 3_600);
        setup_user_bet(&env, 1, &lender, 1_000_000, 0);

        // 2% fee return on a 1,000,000 position that settles inside the window.
        assert_eq!(BudgetPlanner::project_returns(&env, &lender, 7).unwrap(), 20_000);
        // 10% of the 1,000,000 portfolio value.
        assert_eq!(BudgetPlanner::calculate_minimum_reserve(&env, &lender).unwrap(), 100_000);
    });
}

#[test]
fn test_no_checked_arithmetic_is_swallowed_in_the_planner() {
    // Structural guard for the acceptance criterion "every checked_* chain ends
    // in a propagated error": a checked_* call followed by unwrap_or(<number>)
    // within a few lines is exactly the pattern that turned overflow into a value.
    let source = include_str!("budget_planner.rs");
    let production = source.split("// Tests\n").next().unwrap();

    // Lines since the most recent `checked_*` call, and whether a storage read
    // has appeared since (a storage `.get(..).unwrap_or(0)` default is fine).
    let mut since_checked: Option<usize> = None;
    let mut storage_read_since = false;
    for (i, line) in production.lines().enumerate() {
        if line.contains("checked_") {
            since_checked = Some(0);
            storage_read_since = false;
        } else if let Some(n) = since_checked {
            since_checked = if n >= 4 { None } else { Some(n + 1) };
        }
        if line.contains(".get(") || line.contains(".get::<") || line.contains("storage()") {
            storage_read_since = true;
        }
        if line.contains(".unwrap_or(") && since_checked.is_some() && !storage_read_since {
            panic!(
                "checked arithmetic swallowed by unwrap_or near budget_planner.rs line {}: {}",
                i + 1,
                line.trim()
            );
        }
    }
}
}
