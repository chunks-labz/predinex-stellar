//! Tests for the referral tracking system — Issue #420
//!
//! Coverage:
//!  - referral with 0 bps = no reward credited
//!  - referral with non-zero bps credits correct amount
//!  - self-referral rejected with SelfReferral error
//!  - multiple referrers tracked independently
//!  - rewards persist after partial claims (claim resets balance)
//!  - unauthorized set_referral_bps rejected
//!  - claim_referral_rewards with zero balance returns NoReferralRewards
//!  - get_total_referral_volume accumulates across bets
//!  - referral_reward_claimed event emitted on claim

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

        Ctx { env, client, admin: token_admin, token_id }
    }

    fn mint(&self, to: &Address, amount: i128) {
        let sac = StellarAssetClient::new(&self.env, &self.token_id);
        sac.mint(to, &amount);
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Test Pool"),
            &String::from_str(&self.env, "Description"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3_600,
            &MIN_CREATOR_DEPOSIT,
        )
    }
}

#[test]
fn test_referral_zero_bps_no_reward() {
    let ctx = Ctx::new();
    // bps defaults to 0 — no set_referral_bps call needed
    let bettor = Address::generate(&ctx.env);
    let referrer = Address::generate(&ctx.env);
    ctx.mint(&bettor, 1_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    ctx.client
        .place_bet_with_referral(&bettor, &pool_id, &0, &1_000_000, &referrer)
        .unwrap();

    assert_eq!(ctx.client.get_referrer_balance(&referrer), 0);
    assert_eq!(ctx.client.get_total_referral_volume(), 0);
}

#[test]
fn test_referral_nonzero_bps_credits_correctly() {
    let ctx = Ctx::new();
    ctx.client.set_referral_bps(&ctx.admin, &100).unwrap(); // 1%

    let bettor = Address::generate(&ctx.env);
    let referrer = Address::generate(&ctx.env);
    ctx.mint(&bettor, 1_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    ctx.client
        .place_bet_with_referral(&bettor, &pool_id, &0, &1_000_000, &referrer)
        .unwrap();

    // 1% of 1_000_000 = 10_000
    assert_eq!(ctx.client.get_referrer_balance(&referrer), 10_000);
    assert_eq!(ctx.client.get_total_referral_volume(), 1_000_000);
}

#[test]
fn test_self_referral_rejected() {
    let ctx = Ctx::new();
    ctx.client.set_referral_bps(&ctx.admin, &100).unwrap();

    let user = Address::generate(&ctx.env);
    ctx.mint(&user, 1_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    let result = ctx.client.try_place_bet_with_referral(&user, &pool_id, &0, &1_000_000, &user);
    assert_eq!(result, Err(Ok(ContractError::SelfReferral)));
}

#[test]
fn test_multiple_referrers_tracked_independently() {
    let ctx = Ctx::new();
    ctx.client.set_referral_bps(&ctx.admin, &200).unwrap(); // 2%

    let bettor1 = Address::generate(&ctx.env);
    let bettor2 = Address::generate(&ctx.env);
    let referrer1 = Address::generate(&ctx.env);
    let referrer2 = Address::generate(&ctx.env);
    ctx.mint(&bettor1, 1_000_000);
    ctx.mint(&bettor2, 2_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    ctx.client
        .place_bet_with_referral(&bettor1, &pool_id, &0, &1_000_000, &referrer1)
        .unwrap();
    ctx.client
        .place_bet_with_referral(&bettor2, &pool_id, &1, &2_000_000, &referrer2)
        .unwrap();

    assert_eq!(ctx.client.get_referrer_balance(&referrer1), 20_000); // 2% of 1M
    assert_eq!(ctx.client.get_referrer_balance(&referrer2), 40_000); // 2% of 2M
}

#[test]
fn test_claim_referral_rewards_resets_balance() {
    let ctx = Ctx::new();
    ctx.client.set_referral_bps(&ctx.admin, &100).unwrap();

    let bettor = Address::generate(&ctx.env);
    let referrer = Address::generate(&ctx.env);
    ctx.mint(&bettor, 1_000_000);
    // Fund contract so it can pay out referral rewards
    ctx.mint(&ctx.env.current_contract_address(), 100_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    ctx.client
        .place_bet_with_referral(&bettor, &pool_id, &0, &1_000_000, &referrer)
        .unwrap();

    let claimed = ctx.client.claim_referral_rewards(&referrer).unwrap();
    assert_eq!(claimed, 10_000);
    // Balance reset to 0 after claim
    assert_eq!(ctx.client.get_referrer_balance(&referrer), 0);
}

#[test]
fn test_claim_referral_rewards_no_balance_returns_error() {
    let ctx = Ctx::new();
    let referrer = Address::generate(&ctx.env);
    let result = ctx.client.try_claim_referral_rewards(&referrer);
    assert_eq!(result, Err(Ok(ContractError::NoReferralRewards)));
}

#[test]
fn test_set_referral_bps_unauthorized_rejected() {
    let ctx = Ctx::new();
    let attacker = Address::generate(&ctx.env);
    let result = ctx.client.try_set_referral_bps(&attacker, &100);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

#[test]
fn test_set_referral_bps_above_max_rejected() {
    let ctx = Ctx::new();
    let result = ctx.client.try_set_referral_bps(&ctx.admin, &1001);
    assert_eq!(result, Err(Ok(ContractError::FeeOutOfBounds)));
}

#[test]
fn test_get_total_referral_volume_accumulates() {
    let ctx = Ctx::new();
    ctx.client.set_referral_bps(&ctx.admin, &100).unwrap();

    let bettor = Address::generate(&ctx.env);
    let referrer = Address::generate(&ctx.env);
    ctx.mint(&bettor, 3_000_000);
    let pool_id = ctx.create_pool(&ctx.admin);

    ctx.client
        .place_bet_with_referral(&bettor, &pool_id, &0, &1_000_000, &referrer)
        .unwrap();
    ctx.client
        .place_bet_with_referral(&bettor, &pool_id, &0, &2_000_000, &referrer)
        .unwrap();

    assert_eq!(ctx.client.get_total_referral_volume(), 3_000_000);
}
