#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

struct TestCtx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    user: Address,
    user_b: Address,
}

fn setup() -> TestCtx<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let user_b = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_id.address(), &admin);
    let token_admin = token::StellarAssetClient::new(&env, &token_id.address());
    token_admin.mint(&user, &10_000);
    token_admin.mint(&user_b, &10_000);
    let client: PredinexContractClient<'static> = unsafe { core::mem::transmute(client) };
    TestCtx {
        env,
        client,
        admin,
        user,
        user_b,
    }
}

fn create_pool(ctx: &TestCtx<'_>) -> u32 {
    ctx.client.create_pool(
        &ctx.admin,
        &String::from_str(&ctx.env, "Market"),
        &String::from_str(&ctx.env, "Description"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3600,
    )
}

fn settle_pool(ctx: &TestCtx<'_>, pool_id: u32) {
    ctx.client
        .place_bet(&ctx.user, &pool_id, &0, &500, &None::<Address>);
    ctx.client
        .place_bet(&ctx.user_b, &pool_id, &1, &500, &None::<Address>);
    ctx.env.ledger().with_mut(|li| li.timestamp = 3601);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);
}

#[test]
fn scheduled_pool_activates_at_open_time() {
    let ctx = setup();
    ctx.env.ledger().with_mut(|li| li.timestamp = 100);
    let pool_id = ctx.client.schedule_pool(
        &ctx.admin,
        &String::from_str(&ctx.env, "Future"),
        &String::from_str(&ctx.env, "Description"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3600,
        &200,
    );
    assert_eq!(ctx.client.get_scheduled_pools(&1, &10).len(), 1);
    assert_eq!(
        ctx.client.try_activate_scheduled_pool(&pool_id),
        Err(Ok(ContractError::PoolNotExpired))
    );
    ctx.env.ledger().with_mut(|li| li.timestamp = 200);
    ctx.client.activate_scheduled_pool(&pool_id);
    assert_eq!(
        ctx.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Open
    );
}

#[test]
fn scheduled_pool_cancel_and_horizon_validation() {
    let ctx = setup();
    ctx.env.ledger().with_mut(|li| li.timestamp = 1_000);
    let too_far = 1_000 + MAX_SCHEDULE_POOL_HORIZON_SECS + 1;
    let result = ctx.client.try_schedule_pool(
        &ctx.admin,
        &String::from_str(&ctx.env, "Future"),
        &String::from_str(&ctx.env, "Description"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3600,
        &too_far,
    );
    assert_eq!(result, Err(Ok(ContractError::DurationTooLong)));

    let pool_id = ctx.client.schedule_pool(
        &ctx.admin,
        &String::from_str(&ctx.env, "Future"),
        &String::from_str(&ctx.env, "Description"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3600,
        &(1_000 + MAX_SCHEDULE_POOL_HORIZON_SECS),
    );
    ctx.client.cancel_scheduled_pool(&ctx.admin, &pool_id);
    assert_eq!(
        ctx.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Cancelled
    );
    assert_eq!(ctx.client.get_scheduled_pools(&1, &10).len(), 0);
}

#[test]
fn scheduled_claim_executes_when_due_and_can_be_cancelled() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    settle_pool(&ctx, pool_id);
    let claim_id = ctx.client.schedule_claim(&ctx.user, &pool_id, &4_000);
    match ctx.client.try_execute_scheduled_claims() {
        Err(Ok(ContractError::PoolNotExpired)) => {}
        other => panic!("expected PoolNotExpired, got {:?}", other.err()),
    }
    ctx.client.cancel_scheduled_claim(&ctx.user, &claim_id);
    assert_eq!(ctx.client.get_scheduled_claims(&1, &10).len(), 0);

    let claim_id_2 = ctx.client.schedule_claim(&ctx.user, &pool_id, &4_100);
    assert!(claim_id_2 > claim_id);
    ctx.env.ledger().with_mut(|li| li.timestamp = 4_100);
    let executed = ctx.client.execute_scheduled_claims();
    assert_eq!(executed.len(), 1);
    assert!(executed.get(0).unwrap().amount > 0);
}

/// Ignored: exceeds Soroban test environment footprint limit when processing
/// more than ~10 scheduled claims per invocation.
#[test]
#[ignore]
fn scheduled_claim_execution_is_capped_at_ten() {
    let ctx = setup();
    let mut pool_ids = std::vec::Vec::new();
    for i in 0..11u32 {
        let pool_id = ctx.client.create_pool(
            &ctx.admin,
            &String::from_str(&ctx.env, "Market"),
            &String::from_str(&ctx.env, "Description"),
            &String::from_str(&ctx.env, "Yes"),
            &String::from_str(&ctx.env, "No"),
            &3600,
        );
        let amount = 100 + i as i128;
        ctx.client
            .place_bet(&ctx.user, &pool_id, &0, &amount, &None::<Address>);
        ctx.client
            .place_bet(&ctx.user_b, &pool_id, &1, &100, &None::<Address>);
        pool_ids.push(pool_id);
    }
    ctx.env.ledger().with_mut(|li| li.timestamp = 3601);
    for pool_id in pool_ids {
        ctx.client.settle_pool(&ctx.admin, &pool_id, &0);
        ctx.client.schedule_claim(&ctx.user, &pool_id, &4_000);
    }
    ctx.env.ledger().with_mut(|li| li.timestamp = 4_000);
    let executed = ctx.client.execute_scheduled_claims();
    assert_eq!(executed.len(), 10);
}

#[test]
fn treasury_withdrawal_rate_limit_blocks_and_resets() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    settle_pool(&ctx, pool_id);
    ctx.client.claim_winnings(&ctx.user, &pool_id);
    let treasury = ctx.client.get_treasury_balance();
    assert!(treasury >= 20);
    ctx.client.set_treasury_withdraw_limit(&ctx.admin, &10, &60);
    ctx.client.withdraw_treasury(&ctx.admin, &10);
    assert_eq!(
        ctx.client.try_withdraw_treasury(&ctx.admin, &1),
        Err(Ok(ContractError::RateLimitExceeded))
    );
    ctx.env.ledger().with_mut(|li| li.timestamp += 60);
    ctx.client.withdraw_treasury(&ctx.admin, &1);
}

#[test]
fn boundary_validation_uses_consistent_errors() {
    let ctx = setup();
    assert_eq!(
        ctx.client
            .try_set_treasury_withdraw_limit(&ctx.admin, &-1, &60),
        Err(Ok(ContractError::InvalidRateLimitConfig))
    );
    assert_eq!(
        ctx.client.try_schedule_claim(&ctx.user, &999, &0),
        Err(Ok(ContractError::DurationTooShort))
    );
    assert_eq!(
        ctx.client.try_withdraw_treasury(&ctx.admin, &0),
        Err(Ok(ContractError::InvalidWithdrawalAmount))
    );
}
