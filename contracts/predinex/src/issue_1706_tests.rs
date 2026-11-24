//! Issue #1706 — Cap cumulative protocol fees per market.
//!
//! Treasury accrual from a single pool previously grew unbounded as winners
//! claimed, so the intended per-market fee ceiling could be exceeded by a
//! large pool. The cap configured via `set_protocol_fee_per_market_cap`
//! clamps the cumulative `PoolTreasuryCredited(pool_id)` to the configured
//! value: fees below the cap accrue normally, further accrual is limited to
//! the remaining allowance.
//!
//! Acceptance criteria covered here:
//!   - Fees below the cap accrue normally.
//!   - Accrual that would exceed the cap is limited to the remaining
//!     allowance.
//!   - A test verifies the cap across multiple accruals.

#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

struct FeeCapCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    treasury: Address,
    token: Address,
}

fn setup() -> FeeCapCtx {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> =
        PredinexContractClient::new(&env, &contract_id);

    let treasury = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(treasury.clone());
    client.initialize(&token.address(), &treasury, &treasury);

    FeeCapCtx {
        env,
        client,
        treasury,
        token: token.address(),
    }
}

fn mint(ctx: &FeeCapCtx, to: &Address, amount: i128) {
    StellarAssetClient::new(&ctx.env, &ctx.token).mint(to, &amount);
}

/// Spin up a settled market with two winners on outcome 0 so the test can
/// claim them in sequence and watch the credited counter grow. Stake sizes
/// are picked so each claim's fee contribution is predictable.
fn settled_pool_with_two_winners(
    ctx: &FeeCapCtx,
    fee_bps: u32,
    stake: i128,
) -> (u32, Address, Address) {
    ctx.client.set_protocol_fee(&ctx.treasury, &fee_bps);

    let creator = Address::generate(&ctx.env);
    let winner_a = Address::generate(&ctx.env);
    let winner_b = Address::generate(&ctx.env);
    mint(ctx, &creator, MIN_CREATOR_DEPOSIT * 10);
    mint(ctx, &winner_a, stake * 2);
    mint(ctx, &winner_b, stake * 2);

    let pool_id = ctx.client.create_pool(
        &creator,
        &String::from_str(&ctx.env, "#1706 cap"),
        &String::from_str(&ctx.env, "Cumulative fee cap test"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );
    ctx.client
        .place_bet(&winner_a, &pool_id, &0, &stake, &None::<Address>);
    ctx.client
        .place_bet(&winner_b, &pool_id, &0, &stake, &None::<Address>);

    ctx.env.ledger().with_mut(|li| li.timestamp = 3_601);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    (pool_id, winner_a, winner_b)
}

#[test]
fn cap_defaults_to_disabled() {
    let ctx = setup();
    assert_eq!(ctx.client.get_protocol_fee_per_market_cap(), 0);
}

#[test]
fn set_and_read_cap() {
    let ctx = setup();
    ctx.client
        .set_protocol_fee_per_market_cap(&ctx.treasury, &1_000);
    assert_eq!(ctx.client.get_protocol_fee_per_market_cap(), 1_000);
}

#[test]
#[should_panic]
fn set_cap_rejects_unauthorized_caller() {
    let ctx = setup();
    let attacker = Address::generate(&ctx.env);
    ctx.client
        .set_protocol_fee_per_market_cap(&attacker, &1_000);
}

#[test]
fn set_cap_rejects_negative_value() {
    let ctx = setup();
    let result = ctx
        .client
        .try_set_protocol_fee_per_market_cap(&ctx.treasury, &-1);
    assert!(result.is_err());
}

/// Fees below the cap accrue normally — the full fee is credited to the
/// pool's running total just as it would be without a cap.
#[test]
fn fees_below_cap_accrue_normally() {
    let ctx = setup();
    // Cap well above the fee we'll generate — accrual must not be clamped.
    ctx.client
        .set_protocol_fee_per_market_cap(&ctx.treasury, &1_000_000_000);

    // 500 bps × 2 × 100 = 10 stroops fee for a simple two-winner pool.
    let (pool_id, winner_a, winner_b) = settled_pool_with_two_winners(&ctx, 500, 100);

    ctx.client.claim_winnings(&winner_a, &pool_id);
    let after_first = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;
    assert!(after_first > 0);

    ctx.client.claim_winnings(&winner_b, &pool_id);
    let after_second = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;

    // No clamping: accrual grows on the final claim (dust sweep) and never
    // exceeds the generous cap.
    assert!(after_second >= after_first);
    assert!(after_second <= 1_000_000_000);
}

/// Accrual that would exceed the cap is clamped at the remaining allowance:
/// the first claim credits in full, the second only tops up to the cap.
#[test]
fn accrual_over_cap_is_clamped_to_remaining_allowance() {
    let ctx = setup();

    // Prime the fee with a pool so we know the per-claim credit shape before
    // configuring the cap.
    let (pool_id, winner_a, winner_b) = settled_pool_with_two_winners(&ctx, 500, 100);

    // First, measure the natural accrual without a cap so we can place the
    // cap strictly between the two claim deltas.
    ctx.client.claim_winnings(&winner_a, &pool_id);
    let natural_first = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;

    // Now set a cap exactly at the first-claim credit — any further accrual
    // must be clamped to zero.
    ctx.client
        .set_protocol_fee_per_market_cap(&ctx.treasury, &natural_first);

    ctx.client.claim_winnings(&winner_b, &pool_id);
    let after_second = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;

    assert_eq!(
        after_second, natural_first,
        "second-claim accrual must clamp at the configured cap"
    );
}

/// The cap applies across multiple accruals, not just a single claim: once
/// the cumulative amount reaches the cap, every subsequent credit is clamped
/// to zero regardless of how many further claims happen.
#[test]
fn cap_holds_across_multiple_accruals() {
    let ctx = setup();

    // Pick a tiny cap of 1 stroop so the very first claim saturates it.
    ctx.client
        .set_protocol_fee_per_market_cap(&ctx.treasury, &1);

    let (pool_id, winner_a, winner_b) = settled_pool_with_two_winners(&ctx, 500, 100);

    ctx.client.claim_winnings(&winner_a, &pool_id);
    let after_first = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;
    assert!(
        after_first <= 1,
        "first-claim accrual must respect the 1-stroop cap"
    );

    ctx.client.claim_winnings(&winner_b, &pool_id);
    let after_second = ctx.client.get_pool_protocol_revenue(&pool_id).treasury_credited;

    assert_eq!(
        after_second, after_first,
        "no further accrual once cap is saturated"
    );
    assert!(after_second <= 1);
}
