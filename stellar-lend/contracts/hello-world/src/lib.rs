//! Stellar-Lend: Institutional Lending Pool Deployer, Analytics Simulation,
//! Insurance Marketplace, and User Reputation Protocol on Stellar/Soroban.

#![no_std]

pub mod analytics;
pub mod reserve;
pub mod types;
pub mod withdraw;

use analytics::PositionAnalytics;
use reserve::InsuranceMarketplace;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol, Vec,
};
use types::{
    BorrowAsset, CollateralAsset, InsuranceClaim, InsurancePolicy, InsurancePool, LendError,
    LendingPoolConfig, PositionHealth, ReputationTier, ReserveMetrics, RiskTier, SimulationParams,
    SimulationResult, UserReputation,
};

const POOL_DEPLOYED: Symbol = symbol_short!("pool_dep");
const REP_UPDATED: Symbol = symbol_short!("rep_upd");

#[contracttype]
pub enum DataKey {
    Admin,
    PoolCount,
    PoolConfig(u64),
    UserReputation(Address),
    InsurancePool(u64),
    InsurancePolicy(u64),
    InsuranceClaim(u64),
    PolicyCount,
    ClaimCount,
}

#[contract]
pub struct StellarLendContract;

#[contractimpl]
impl StellarLendContract {
    /// Initializes the Stellar-Lend protocol with administrator credentials.
    pub fn initialize(env: Env, admin: Address) -> Result<(), LendError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(LendError::Unauthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::PoolCount, &0u64);
        env.storage().instance().set(&DataKey::PolicyCount, &0u64);
        env.storage().instance().set(&DataKey::ClaimCount, &0u64);
        Ok(())
    }

    // =========================================================================
    // LENDING POOL DEPLOYER & FACTORY
    // =========================================================================

    /// Deploys and configures a new isolated lending pool.
    pub fn deploy_lending_pool(
        env: Env,
        admin: Address,
        underlying_asset: Address,
        collateral_factor_bps: u32,
        liquidation_threshold_bps: u32,
        liquidation_bonus_bps: u32,
        base_rate_bps: u32,
        optimal_utilization_bps: u32,
        slope1_bps: u32,
        slope2_bps: u32,
    ) -> Result<u64, LendError> {
        admin.require_auth();
        if collateral_factor_bps >= liquidation_threshold_bps
            || liquidation_threshold_bps > 10_000
            || liquidation_bonus_bps > 2_000
            || optimal_utilization_bps > 10_000
        {
            return Err(LendError::InvalidParameter);
        }

        let mut pool_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PoolCount)
            .unwrap_or(0);
        pool_count += 1;

        let config = LendingPoolConfig {
            pool_id: pool_count,
            admin: admin.clone(),
            underlying_asset,
            collateral_factor_bps,
            liquidation_threshold_bps,
            liquidation_bonus_bps,
            base_rate_bps,
            optimal_utilization_bps,
            slope1_bps,
            slope2_bps,
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::PoolConfig(pool_count), &config);
        env.storage()
            .instance()
            .set(&DataKey::PoolCount, &pool_count);

        env.events().publish((POOL_DEPLOYED, pool_count), admin);

        Ok(pool_count)
    }

    /// Fetches configuration for a deployed lending pool.
    pub fn get_pool_config(env: Env, pool_id: u64) -> Result<LendingPoolConfig, LendError> {
        env.storage()
            .persistent()
            .get(&DataKey::PoolConfig(pool_id))
            .ok_or(LendError::PoolNotFound)
    }

    // =========================================================================
    // USER REPUTATION SYSTEM
    // =========================================================================

    /// Computes reputation score, tier, and unlocks tier-specific borrowing advantages.
    ///
    /// Score Mechanics:
    /// - Base starting score: 300 (Bronze).
    /// - On-time repayments: +15 points per event.
    /// - Volume factor: +10 points per $10k repaid.
    /// - Liquidations: -100 points penalty.
    /// - Defaults: -250 points penalty.
    /// - Score bounded within [0, 1000].
    pub fn update_user_reputation(
        env: Env,
        caller: Address,
        user: Address,
        on_time_repayment: bool,
        repayment_volume: i128,
        is_liquidation: bool,
        is_default: bool,
        current_time: u64,
    ) -> Result<UserReputation, LendError> {
        caller.require_auth();

        let mut rep = env
            .storage()
            .persistent()
            .get(&DataKey::UserReputation(user.clone()))
            .unwrap_or(UserReputation {
                user: user.clone(),
                score: 300,
                tier: ReputationTier::Bronze,
                total_borrowed_volume: 0,
                total_repaid_volume: 0,
                on_time_repayments_count: 0,
                late_repayments_count: 0,
                liquidation_count: 0,
                default_count: 0,
                last_activity_time: current_time,
                ltv_boost_bps: 0,
                rate_discount_bps: 0,
            });

        // Inactivity decay: If inactive > 90 days (7,776,000 s), decay score toward 300
        if current_time > rep.last_activity_time
            && (current_time - rep.last_activity_time) >= 7_776_000
            && rep.score > 300
        {
            let quarters_inactive = ((current_time - rep.last_activity_time) / 7_776_000) as u32;
            let decay = quarters_inactive * 25;
            rep.score = rep.score.saturating_sub(decay).max(300);
        }

        if is_default {
            rep.default_count += 1;
            rep.score = rep.score.saturating_sub(250);
        } else if is_liquidation {
            rep.liquidation_count += 1;
            rep.score = rep.score.saturating_sub(100);
        } else if on_time_repayment {
            rep.on_time_repayments_count += 1;
            rep.total_repaid_volume += repayment_volume;
            let volume_points = ((repayment_volume / 100_000_000_000) as u32).min(50);
            rep.score = (rep.score + 15 + volume_points).min(1000);
        } else {
            rep.late_repayments_count += 1;
            rep.score = rep.score.saturating_sub(30);
        }

        rep.last_activity_time = current_time;

        // Assign Tier and Perks
        if rep.score >= 900 {
            rep.tier = ReputationTier::Platinum;
            rep.ltv_boost_bps = 600; // +6% Max LTV
            rep.rate_discount_bps = 100; // -1.0% Borrow APY
        } else if rep.score >= 700 {
            rep.tier = ReputationTier::Gold;
            rep.ltv_boost_bps = 400; // +4% Max LTV
            rep.rate_discount_bps = 50; // -0.5% Borrow APY
        } else if rep.score >= 400 {
            rep.tier = ReputationTier::Silver;
            rep.ltv_boost_bps = 200; // +2% Max LTV
            rep.rate_discount_bps = 25; // -0.25% Borrow APY
        } else {
            rep.tier = ReputationTier::Bronze;
            rep.ltv_boost_bps = 0;
            rep.rate_discount_bps = 0;
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserReputation(user.clone()), &rep);

        env.events()
            .publish((REP_UPDATED, user), (rep.score, rep.tier as u32));

        Ok(rep)
    }

    /// Queries user reputation profile.
    pub fn get_user_reputation(env: Env, user: Address) -> UserReputation {
        env.storage()
            .persistent()
            .get(&DataKey::UserReputation(user.clone()))
            .unwrap_or(UserReputation {
                user,
                score: 300,
                tier: ReputationTier::Bronze,
                total_borrowed_volume: 0,
                total_repaid_volume: 0,
                on_time_repayments_count: 0,
                late_repayments_count: 0,
                liquidation_count: 0,
                default_count: 0,
                last_activity_time: 0,
                ltv_boost_bps: 0,
                rate_discount_bps: 0,
            })
    }

    // =========================================================================
    // POSITION HEALTH SIMULATION ENGINE
    // =========================================================================

    /// Evaluates current position health factor and risk tier.
    pub fn calculate_health(
        env: Env,
        collaterals: Vec<CollateralAsset>,
        borrows: Vec<BorrowAsset>,
    ) -> Result<PositionHealth, LendError> {
        PositionAnalytics::calculate_position_health(&env, &collaterals, &borrows)
    }

    /// Simulates position health under hypothetical market shocks and asset deltas.
    pub fn simulate_position(
        env: Env,
        collaterals: Vec<CollateralAsset>,
        borrows: Vec<BorrowAsset>,
        params: SimulationParams,
    ) -> Result<SimulationResult, LendError> {
        PositionAnalytics::simulate_position_health(&env, &collaterals, &borrows, &params)
    }

    // =========================================================================
    // INSURANCE MARKETPLACE & RESERVE ENGINE
    // =========================================================================

    /// Creates an insurance reserve pool.
    pub fn create_insurance_pool(
        env: Env,
        admin: Address,
        pool_id: u64,
        underwriting_asset: Address,
        max_capacity: i128,
        min_solvency_ratio_bps: u32,
        base_premium_rate_bps: u32,
        utilization_multiplier_bps: u32,
    ) -> Result<InsurancePool, LendError> {
        admin.require_auth();
        let pool = InsuranceMarketplace::create_pool(
            &env,
            pool_id,
            underwriting_asset,
            max_capacity,
            min_solvency_ratio_bps,
            base_premium_rate_bps,
            utilization_multiplier_bps,
        )?;

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePool(pool_id), &pool);
        Ok(pool)
    }

    /// Purchases insurance cover for a position.
    pub fn purchase_insurance(
        env: Env,
        holder: Address,
        pool_id: u64,
        cover_amount: i128,
        duration_seconds: u64,
        current_time: u64,
        risk_tier: RiskTier,
    ) -> Result<InsurancePolicy, LendError> {
        holder.require_auth();
        let mut pool: InsurancePool = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePool(pool_id))
            .ok_or(LendError::PoolNotFound)?;

        let mut policy_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::PolicyCount)
            .unwrap_or(0);
        policy_count += 1;

        let policy = InsuranceMarketplace::purchase_policy(
            &env,
            &mut pool,
            policy_count,
            holder,
            cover_amount,
            duration_seconds,
            current_time,
            risk_tier,
        )?;

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePool(pool_id), &pool);
        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(policy_count), &policy);
        env.storage()
            .instance()
            .set(&DataKey::PolicyCount, &policy_count);

        Ok(policy)
    }

    /// Files an insurance claim for bad debt.
    pub fn file_claim(
        env: Env,
        claimant: Address,
        policy_id: u64,
        loss_amount: i128,
        current_time: u64,
    ) -> Result<InsuranceClaim, LendError> {
        claimant.require_auth();
        let mut policy: InsurancePolicy = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePolicy(policy_id))
            .ok_or(LendError::PolicyNotFound)?;

        let mut claim_count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ClaimCount)
            .unwrap_or(0);
        claim_count += 1;

        let claim = InsuranceMarketplace::file_claim(
            &env,
            &mut policy,
            claim_count,
            claimant,
            loss_amount,
            current_time,
        )?;

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(policy_id), &policy);
        env.storage()
            .persistent()
            .set(&DataKey::InsuranceClaim(claim_count), &claim);
        env.storage()
            .instance()
            .set(&DataKey::ClaimCount, &claim_count);

        Ok(claim)
    }

    /// Assesses and executes payout for an approved insurance claim.
    pub fn assess_and_payout_claim(
        env: Env,
        assessor: Address,
        claim_id: u64,
        approve: bool,
    ) -> Result<i128, LendError> {
        assessor.require_auth();
        let mut claim: InsuranceClaim = env
            .storage()
            .persistent()
            .get(&DataKey::InsuranceClaim(claim_id))
            .ok_or(LendError::ClaimNotFound)?;

        let mut policy: InsurancePolicy = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePolicy(claim.policy_id))
            .ok_or(LendError::PolicyNotFound)?;

        let mut pool: InsurancePool = env
            .storage()
            .persistent()
            .get(&DataKey::InsurancePool(policy.pool_id))
            .ok_or(LendError::PoolNotFound)?;

        InsuranceMarketplace::assess_claim(&env, &mut claim, assessor, approve)?;

        if !approve {
            env.storage()
                .persistent()
                .set(&DataKey::InsuranceClaim(claim_id), &claim);
            return Ok(0);
        }

        let payout =
            InsuranceMarketplace::execute_claim_payout(&env, &mut pool, &mut policy, &mut claim)?;

        env.storage()
            .persistent()
            .set(&DataKey::InsurancePool(policy.pool_id), &pool);
        env.storage()
            .persistent()
            .set(&DataKey::InsurancePolicy(policy.policy_id), &policy);
        env.storage()
            .persistent()
            .set(&DataKey::InsuranceClaim(claim_id), &claim);

        Ok(payout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_deployer_and_reputation_system() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarLendContract, ());
        let client = StellarLendContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let asset = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);

        // Deploy pool
        let pool_id = client.deploy_lending_pool(
            &admin,
            &asset,
            &7500, // 75% collateral factor
            &8000, // 80% liquidation threshold
            &500,  // 5% liquidation bonus
            &200,  // 2% base borrow rate
            &8000, // 80% optimal utilization
            &400,  // slope 1
            &2000, // slope 2
        );
        assert_eq!(pool_id, 1);

        let config = client.get_pool_config(&pool_id);
        assert_eq!(config.collateral_factor_bps, 7500);

        // Test reputation progression
        let now = 1_700_000_000;
        let rep1 = client.get_user_reputation(&user);
        assert_eq!(rep1.score, 300);
        assert_eq!(rep1.tier, ReputationTier::Bronze);

        // Record successful repayment of $200k
        let rep2 = client.update_user_reputation(
            &admin,
            &user,
            &true,
            &(200_000 * 10_000_000),
            &false,
            &false,
            &now,
        );
        assert!(rep2.score > 300);
    }
}
