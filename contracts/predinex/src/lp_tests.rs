//! Tests for the LP incentive and yield farming system — Issue #714
//!
//! Coverage:
//!  - deposit liquidity and receive shares
//!  - withdraw liquidity by burning shares
//!  - claim LP rewards after distribution
//!  - stake LP shares with time lock
//!  - unstake after lock period
//!  - staked shares cannot be withdrawn before unlock
//!  - LP admin config (fee allocation, stake boost)
//!  - LP lifecycle: deposit → distribute rewards → claim → withdraw

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

struct LpCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    admin: Address,
    token_id: Address,
}

impl LpCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_asset = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_asset.address();
        client.initialize(&token_id, &token_admin, &token_admin);

        LpCtx {
            env,
            client,
            admin: token_admin,
            token_id,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        let sac = StellarAssetClient::new(&self.env, &self.token_id);
        sac.mint(to, &amount);
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "LP Test Pool"),
            &String::from_str(&self.env, "A pool for LP tests"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3_600,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }
}

#[test]
fn test_deposit_liquidity_mints_shares() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    let deposit = 10_000_000i128; // 1 XLM
    ctx.mint(&lp, deposit);

    let pool_id = ctx.create_pool(&ctx.admin);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &deposit);

    assert_eq!(shares, deposit);
    let pos = ctx.client.get_lp_position(&pool_id, &lp);
    assert_eq!(pos.shares, deposit);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), deposit);
    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), deposit);
}

#[test]
fn test_second_deposit_proportional_shares() {
    let ctx = LpCtx::new();
    let lp1 = Address::generate(&ctx.env);
    let lp2 = Address::generate(&ctx.env);
    ctx.mint(&lp1, 10_000_000);
    ctx.mint(&lp2, 20_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp1, &pool_id, &10_000_000);
    let shares2 = ctx.client.deposit_liquidity(&lp2, &pool_id, &20_000_000);

    assert_eq!(shares2, 20_000_000);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 30_000_000);
}

#[test]
fn test_withdraw_liquidity() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);
    let withdrawn = ctx.client.withdraw_liquidity(&lp, &pool_id, &shares);

    assert_eq!(withdrawn, 10_000_000);
    let pos = ctx.client.get_lp_position(&pool_id, &lp);
    assert_eq!(pos.shares, 0);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 0);
}

#[test]
fn test_partial_withdraw() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);
    let withdrawn = ctx.client.withdraw_liquidity(&lp, &pool_id, &5_000_000);

    assert_eq!(withdrawn, 5_000_000);
    let pos = ctx.client.get_lp_position(&pool_id, &lp);
    assert_eq!(pos.shares, 5_000_000);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 5_000_000);
}

#[test]
fn test_lp_reward_distribution_and_claim() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    let deposit = 10_000_000i128;
    let reward_amount = 1_000_000i128;
    ctx.mint(&lp, deposit);
    ctx.mint(&ctx.admin, reward_amount);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &deposit);

    ctx.client
        .distribute_lp_rewards(&ctx.admin, &pool_id, &reward_amount);

    let pending = ctx.client.get_pending_lp_rewards(&pool_id, &lp);
    assert_eq!(pending, reward_amount);

    let claimed = ctx.client.claim_lp_rewards(&lp, &pool_id);
    assert_eq!(claimed, reward_amount);

    let pending_after = ctx.client.get_pending_lp_rewards(&pool_id, &lp);
    assert_eq!(pending_after, 0);
}

#[test]
fn test_stake_and_unstake_lp() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);

    // Stake half the shares for 1 hour
    ctx.client.stake_lp(&lp, &pool_id, &5_000_000, &3_600);

    let stake = ctx.client.get_lp_stake(&pool_id, &lp).unwrap();
    assert_eq!(stake.shares, 5_000_000);

    // Advance time past lock
    ctx.env.ledger().with_mut(|l| l.timestamp = 5_000);
    let released = ctx.client.unstake_lp(&lp, &pool_id);
    assert_eq!(released, 5_000_000);

    assert!(ctx.client.get_lp_stake(&pool_id, &lp).is_none());
}

#[test]
#[should_panic(expected = "Error(Contract, #76)")]
fn test_unstake_before_lock_fails() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);
    ctx.client.stake_lp(&lp, &pool_id, &5_000_000, &3_600);

    // Try to unstake immediately — should fail
    ctx.client.unstake_lp(&lp, &pool_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #76)")]
fn test_withdraw_staked_shares_fails() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);
    ctx.client.stake_lp(&lp, &pool_id, &8_000_000, &3_600);

    // Try to withdraw more than unstaked shares (only 2M unstaked)
    ctx.client.withdraw_liquidity(&lp, &pool_id, &5_000_000);
}

#[test]
fn test_set_lp_fee_allocation() {
    let ctx = LpCtx::new();
    ctx.client.set_lp_fee_allocation(&ctx.admin, &500); // 5%
    let config = ctx.client.get_lp_reward_config();
    assert_eq!(config.fee_allocation_bps, 500);
}

#[test]
fn test_set_lp_stake_boost() {
    let ctx = LpCtx::new();
    ctx.client.set_lp_stake_boost(&ctx.admin, &15_000); // 1.5x
    let config = ctx.client.get_lp_reward_config();
    assert_eq!(config.stake_boost_bps, 15_000);
}

#[test]
fn test_lp_lifecycle_full() {
    let ctx = LpCtx::new();
    let lp1 = Address::generate(&ctx.env);
    let lp2 = Address::generate(&ctx.env);
    ctx.mint(&lp1, 20_000_000);
    ctx.mint(&lp2, 10_000_000);
    ctx.mint(&ctx.admin, 3_000_000);

    let pool_id = ctx.create_pool(&ctx.admin);

    // Both LPs deposit
    ctx.client.deposit_liquidity(&lp1, &pool_id, &20_000_000);
    ctx.client.deposit_liquidity(&lp2, &pool_id, &10_000_000);

    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 30_000_000);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 30_000_000);

    // Admin distributes rewards
    ctx.client
        .distribute_lp_rewards(&ctx.admin, &pool_id, &3_000_000);

    // LP1 should get 2/3 of rewards, LP2 gets 1/3
    let pending1 = ctx.client.get_pending_lp_rewards(&pool_id, &lp1);
    let pending2 = ctx.client.get_pending_lp_rewards(&pool_id, &lp2);
    assert_eq!(pending1, 2_000_000);
    assert_eq!(pending2, 1_000_000);

    // Both claim
    let claimed1 = ctx.client.claim_lp_rewards(&lp1, &pool_id);
    let claimed2 = ctx.client.claim_lp_rewards(&lp2, &pool_id);
    assert_eq!(claimed1, 2_000_000);
    assert_eq!(claimed2, 1_000_000);

    // LP1 withdraws all
    let w1 = ctx.client.withdraw_liquidity(&lp1, &pool_id, &20_000_000);
    assert_eq!(w1, 20_000_000);

    // LP2 withdraws all
    let w2 = ctx.client.withdraw_liquidity(&lp2, &pool_id, &10_000_000);
    assert_eq!(w2, 10_000_000);

    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 0);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 0);
}

#[test]
fn test_lp_reward_dust_accumulator_recovers_rounding() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 3);
    ctx.mint(&ctx.admin, 3);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &3);

    for _ in 0..3 {
        ctx.client.distribute_lp_rewards(&ctx.admin, &pool_id, &1);
    }

    let pending = ctx.client.get_pending_lp_rewards(&pool_id, &lp);
    assert_eq!(pending, 3);
}

/// Issue #1022 — when the LP reward pool is capped below a user's accrued
/// rewards, `claim_lp_rewards` must only record debt for the amount actually
/// paid out. The unpaid remainder has to stay claimable once the pool is
/// topped up again.
#[test]
fn test_capped_reward_pool_keeps_residual_claimable() {
    let ctx = LpCtx::new();
    let lp = Address::generate(&ctx.env);
    let deposit = 10_000_000i128;
    let reward_amount = 1_000_000i128;
    ctx.mint(&lp, deposit);
    ctx.mint(&ctx.admin, reward_amount);

    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &deposit);
    ctx.client
        .distribute_lp_rewards(&ctx.admin, &pool_id, &reward_amount);

    assert_eq!(
        ctx.client.get_pending_lp_rewards(&pool_id, &lp),
        reward_amount
    );

    // Simulate the reward pool being drained below the LP's accrued rewards
    // (e.g. a boosted staker claimed ahead of them, or the pool was funded
    // in tranches). Only 400k of the 1_000k entitlement can be paid now.
    let capped = 400_000i128;
    ctx.env.as_contract(&ctx.client.address, || {
        ctx.env
            .storage()
            .persistent()
            .set(&DataKey::LpRewardPool(pool_id), &capped);
    });

    let claimed = ctx.client.claim_lp_rewards(&lp, &pool_id);
    assert_eq!(claimed, capped);

    // The un-paid remainder must still be claimable, not silently lost.
    let residual = reward_amount - capped;
    assert_eq!(
        ctx.client.get_pending_lp_rewards(&pool_id, &lp),
        residual,
        "residual LP rewards were lost when the reward pool was capped"
    );

    // Top the reward pool back up; the residual should now pay out in full.
    ctx.env.as_contract(&ctx.client.address, || {
        ctx.env
            .storage()
            .persistent()
            .set(&DataKey::LpRewardPool(pool_id), &residual);
    });

    let claimed_again = ctx.client.claim_lp_rewards(&lp, &pool_id);
    assert_eq!(claimed_again, residual);
    assert_eq!(ctx.client.get_pending_lp_rewards(&pool_id, &lp), 0);
}
