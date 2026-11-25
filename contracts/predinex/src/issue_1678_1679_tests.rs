#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

struct TestCtx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    user: Address,
    user_b: Address,
    referrer: Address,
    token: Address,
}

fn setup() -> TestCtx<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let user_b = Address::generate(&env);
    let referrer = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &admin, &admin);
    client.set_protocol_fee(&admin, &0);

    let token_admin = token::StellarAssetClient::new(&env, &token_id.address());
    token_admin.mint(&admin, &(MIN_CREATOR_DEPOSIT * 10));
    token_admin.mint(&user, &10_000);
    token_admin.mint(&user_b, &10_000);
    token_admin.mint(&referrer, &10_000);

    TestCtx {
        env,
        client,
        admin,
        user,
        user_b,
        referrer,
        token: token_id.address(),
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
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

#[test]
fn trades_reject_non_positive_amounts_and_accept_positive_amounts() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    let token_client = token::Client::new(&ctx.env, &ctx.token);
    let user_balance = token_client.balance(&ctx.user);

    for amount in [0i128, -1i128] {
        assert_eq!(
            ctx.client
                .try_place_bet(&ctx.user, &pool_id, &0u32, &amount, &None::<Address>),
            Err(Ok(ContractError::InvalidBetAmount))
        );
        assert_eq!(
            ctx.client.try_place_bet_with_referral(
                &ctx.user,
                &pool_id,
                &0u32,
                &amount,
                &ctx.referrer
            ),
            Err(Ok(ContractError::InvalidBetAmount))
        );
        assert_eq!(
            ctx.client.try_place_multi_asset_bet(
                &ctx.user,
                &pool_id,
                &0u32,
                &amount,
                &ctx.token,
                &None::<Address>
            ),
            Err(Ok(ContractError::InvalidBetAmount))
        );
    }

    assert_eq!(ctx.client.get_user_pool_exposure(&ctx.user, &pool_id), 0);
    assert_eq!(token_client.balance(&ctx.user), user_balance);

    ctx.client
        .place_bet(&ctx.user, &pool_id, &0u32, &1_000i128, &None::<Address>);
    assert_eq!(
        ctx.client.get_user_pool_exposure(&ctx.user, &pool_id),
        1_000
    );
}

#[test]
fn deposits_reject_non_positive_amounts_and_accept_positive_amounts() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    let token_client = token::Client::new(&ctx.env, &ctx.token);
    let user_balance = token_client.balance(&ctx.user);

    assert_eq!(
        ctx.client
            .try_deposit_liquidity(&ctx.user, &pool_id, &0i128),
        Err(Ok(ContractError::InvalidLpAmount))
    );
    assert_eq!(
        ctx.client
            .try_deposit_liquidity(&ctx.user, &pool_id, &-1i128),
        Err(Ok(ContractError::InvalidLpAmount))
    );

    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 0);
    assert_eq!(ctx.client.get_lp_position(&pool_id, &ctx.user).shares, 0);
    assert_eq!(token_client.balance(&ctx.user), user_balance);

    let shares = ctx
        .client
        .deposit_liquidity(&ctx.user, &pool_id, &1_000i128);
    assert_eq!(shares, 1_000);
    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 1_000);
    assert_eq!(
        ctx.client.get_lp_position(&pool_id, &ctx.user).shares,
        1_000
    );
    assert_eq!(token_client.balance(&ctx.user), user_balance - 1_000);
}

#[test]
fn position_cap_configuration_is_admin_controlled() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);

    assert_eq!(ctx.client.get_pool_position_cap(&pool_id), 0);
    assert_eq!(
        ctx.client
            .try_set_pool_position_cap(&ctx.user, &pool_id, &1_000i128),
        Err(Ok(ContractError::Unauthorized))
    );
    assert_eq!(
        ctx.client
            .try_set_pool_position_cap(&ctx.admin, &pool_id, &-1i128),
        Err(Ok(ContractError::InvalidBetAmount))
    );

    ctx.client
        .set_pool_position_cap(&ctx.admin, &pool_id, &1_000i128);
    assert_eq!(ctx.client.get_pool_position_cap(&pool_id), 1_000);
}

#[test]
fn position_cap_allows_exact_limit_and_rejects_over_limit() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    let token_client = token::Client::new(&ctx.env, &ctx.token);
    ctx.client
        .set_pool_position_cap(&ctx.admin, &pool_id, &1_000i128);

    ctx.client
        .place_bet(&ctx.user, &pool_id, &0u32, &1_000i128, &None::<Address>);
    assert_eq!(
        ctx.client.get_user_pool_exposure(&ctx.user, &pool_id),
        1_000
    );

    let over_limit_balance = token_client.balance(&ctx.user_b);
    assert_eq!(
        ctx.client
            .try_place_bet(&ctx.user_b, &pool_id, &0u32, &1_001i128, &None::<Address>),
        Err(Ok(ContractError::ExposureLimitExceeded))
    );
    assert_eq!(ctx.client.get_user_pool_exposure(&ctx.user_b, &pool_id), 0);
    assert_eq!(token_client.balance(&ctx.user_b), over_limit_balance);
}

#[test]
fn position_cap_applies_to_cumulative_exposure() {
    let ctx = setup();
    let pool_id = create_pool(&ctx);
    ctx.client
        .set_pool_position_cap(&ctx.admin, &pool_id, &1_000i128);

    ctx.client
        .place_bet(&ctx.user, &pool_id, &0u32, &600i128, &None::<Address>);
    assert_eq!(
        ctx.client
            .try_place_bet(&ctx.user, &pool_id, &0u32, &401i128, &None::<Address>),
        Err(Ok(ContractError::ExposureLimitExceeded))
    );

    ctx.client
        .place_bet(&ctx.user, &pool_id, &0u32, &400i128, &None::<Address>);
    assert_eq!(
        ctx.client.get_user_pool_exposure(&ctx.user, &pool_id),
        1_000
    );
    assert_eq!(
        ctx.client
            .try_place_bet(&ctx.user, &pool_id, &0u32, &1i128, &None::<Address>),
        Err(Ok(ContractError::ExposureLimitExceeded))
    );
}
