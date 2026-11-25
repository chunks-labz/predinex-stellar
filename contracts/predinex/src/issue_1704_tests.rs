//! Issue #1704 — Partial collateral withdrawal boundaries.
//!
//! The LP position's "collateral" is modelled as the shares staked via
//! `stake_lp`: staked shares are locked for the configured duration and
//! `withdraw_liquidity` is only allowed to burn **unstaked** shares. The
//! boundary between a valid and a rejected partial withdrawal therefore sits
//! at `shares - stake.shares` (the unstaked balance).
//!
//! These tests exercise the three boundary cases called out by #1704:
//!   - just below the limit (valid)
//!   - exactly at the limit (valid)
//!   - just above the limit (rejected with `LpStakeLocked`)
//!
//! A rejected withdrawal must not mutate the LP position or the pool totals.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    admin: Address,
    token_id: Address,
}

impl Ctx {
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

        Ctx {
            env,
            client,
            admin: token_admin,
            token_id,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token_id).mint(to, &amount);
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.mint(creator, MIN_CREATOR_DEPOSIT * 10);
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Collateral boundary pool"),
            &String::from_str(&self.env, "#1704 test pool"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3_600,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }
}

/// Deposit 10,000,000 shares and stake 8,000,000 of them. The "minimum
/// collateral" locked by the stake is 8,000,000 shares, so withdrawals of up
/// to 2,000,000 are allowed. We assert that:
///   - 1,999,999 (just below)   → succeeds
///   - 2,000,000 (exactly at)   → succeeds
///   - 2,000,001 (just above)   → rejected with `LpStakeLocked`
fn setup_lp_with_stake(ctx: &Ctx) -> (Address, u32) {
    let lp = Address::generate(&ctx.env);
    ctx.mint(&lp, 10_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client.deposit_liquidity(&lp, &pool_id, &10_000_000);
    ctx.client.stake_lp(&lp, &pool_id, &8_000_000, &3_600);
    (lp, pool_id)
}

#[test]
fn partial_withdraw_just_below_limit_succeeds() {
    let ctx = Ctx::new();
    let (lp, pool_id) = setup_lp_with_stake(&ctx);

    ctx.client.withdraw_liquidity(&lp, &pool_id, &1_999_999);

    let pos = ctx.client.get_lp_position(&pool_id, &lp);
    assert_eq!(pos.shares, 10_000_000 - 1_999_999);
    assert_eq!(
        ctx.client.get_total_lp_shares(&pool_id),
        10_000_000 - 1_999_999
    );
    assert_eq!(
        ctx.client.get_total_lp_liquidity(&pool_id),
        10_000_000 - 1_999_999
    );
}

#[test]
fn partial_withdraw_exactly_at_limit_succeeds() {
    let ctx = Ctx::new();
    let (lp, pool_id) = setup_lp_with_stake(&ctx);

    ctx.client.withdraw_liquidity(&lp, &pool_id, &2_000_000);

    let pos = ctx.client.get_lp_position(&pool_id, &lp);
    // All unstaked shares drained, staked shares remain untouched.
    assert_eq!(pos.shares, 8_000_000);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), 8_000_000);
    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 8_000_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #76)")]
fn partial_withdraw_just_above_limit_is_rejected() {
    let ctx = Ctx::new();
    let (lp, pool_id) = setup_lp_with_stake(&ctx);

    // One stroop above the unstaked balance must trip LpStakeLocked (#76).
    ctx.client.withdraw_liquidity(&lp, &pool_id, &2_000_001);
}

#[test]
fn rejected_withdraw_does_not_mutate_state() {
    let ctx = Ctx::new();
    let (lp, pool_id) = setup_lp_with_stake(&ctx);

    let before_pos = ctx.client.get_lp_position(&pool_id, &lp);
    let before_shares = ctx.client.get_total_lp_shares(&pool_id);
    let before_liq = ctx.client.get_total_lp_liquidity(&pool_id);

    // try_withdraw_liquidity is the fallible variant: it returns the error
    // rather than panicking, so we can inspect post-state after the failure.
    let result = ctx
        .client
        .try_withdraw_liquidity(&lp, &pool_id, &2_000_001);
    assert!(result.is_err());

    let after_pos = ctx.client.get_lp_position(&pool_id, &lp);
    assert_eq!(after_pos.shares, before_pos.shares);
    assert_eq!(ctx.client.get_total_lp_shares(&pool_id), before_shares);
    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), before_liq);
}

/// A bettor with a 300-stroop position and a 100-stroop minimum bet can
/// withdraw at most 200 stroops without breaching the minimum collateral.
fn setup_bet_with_min(ctx: &Ctx) -> (Address, u32) {
    let user = Address::generate(&ctx.env);
    ctx.mint(&user, 1_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);
    ctx.client
        .set_pool_bet_limits(&ctx.admin, &pool_id, &100, &0);
    ctx.client
        .place_bet(&user, &pool_id, &0, &300, &None::<Address>);
    (user, pool_id)
}

#[test]
fn bet_collateral_withdraw_just_below_limit_succeeds() {
    let ctx = Ctx::new();
    let (user, pool_id) = setup_bet_with_min(&ctx);

    ctx.client.cancel_bet(&user, &pool_id, &0, &199);

    let bet = ctx.client.get_user_bet(&pool_id, &user).unwrap();
    assert_eq!(bet.amount_a, 101);
    assert_eq!(bet.total_bet, 101);
    assert_eq!(ctx.client.get_pool(&pool_id).unwrap().total_a, 101);
}

#[test]
fn bet_collateral_withdraw_exactly_at_limit_succeeds() {
    let ctx = Ctx::new();
    let (user, pool_id) = setup_bet_with_min(&ctx);

    ctx.client.cancel_bet(&user, &pool_id, &0, &200);

    let bet = ctx.client.get_user_bet(&pool_id, &user).unwrap();
    assert_eq!(bet.amount_a, 100);
    assert_eq!(bet.total_bet, 100);
    assert_eq!(ctx.client.get_pool(&pool_id).unwrap().total_a, 100);
}

#[test]
fn bet_collateral_withdraw_above_limit_is_rejected_without_mutation() {
    let ctx = Ctx::new();
    let (user, pool_id) = setup_bet_with_min(&ctx);

    let before_bet = ctx.client.get_user_bet(&pool_id, &user).unwrap();
    let before_pool = ctx.client.get_pool(&pool_id).unwrap();

    let result = ctx.client.try_cancel_bet(&user, &pool_id, &0, &201);
    assert!(result.is_err());

    let after_bet = ctx.client.get_user_bet(&pool_id, &user).unwrap();
    assert_eq!(after_bet.amount_a, before_bet.amount_a);
    assert_eq!(after_bet.total_bet, before_bet.total_bet);
    let after_pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(after_pool.total_a, before_pool.total_a);
    assert_eq!(after_pool.total_b, before_pool.total_b);
    assert_eq!(ctx.client.get_pool(&pool_id).unwrap().status, before_pool.status);
}
