//! Integration tests — multi-asset betting and settlement (issue #577 / #481).
//!
//! Covers:
//! * Multi-asset pool creation with exchange rate lookup validation
//! * Betting with base token and alt token, normalisation via exchange rate
//! * Full lifecycle: create → bet (2+ tokens) → settle → claim (both tokens)
//! * Multiple users across tokens: correct proportional payouts per token
//! * collect_multi_asset_fees sends pending fees to the treasury
//! * Unsupported token and missing-exchange-rate error paths
//!
//! These tests exercise the full contract ABI end-to-end via
//! `PredinexContractClient` and do NOT reach into internal helpers.

extern crate std;

use predinex::{ContractError, PredinexContract, PredinexContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

struct MaCtx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    base_token: Address,
    alt_token: Address,
    treasury: Address,
    base_admin: token::StellarAssetClient<'a>,
    alt_admin: token::StellarAssetClient<'a>,
    base_client: token::Client<'a>,
    alt_client: token::Client<'a>,
}

fn setup_ma() -> MaCtx<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let base_asset = env.register_stellar_asset_contract_v2(treasury.clone());
    let alt_asset = env.register_stellar_asset_contract_v2(treasury.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&base_asset.address(), &treasury, &treasury);

    let base_admin: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(&env, &base_asset.address());
    let alt_admin: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(&env, &alt_asset.address());
    let base_client: token::Client<'static> = token::Client::new(&env, &base_asset.address());
    let alt_client: token::Client<'static> = token::Client::new(&env, &alt_asset.address());

    MaCtx {
        env,
        client,
        base_token: base_asset.address(),
        alt_token: alt_asset.address(),
        treasury,
        base_admin,
        alt_admin,
        base_client,
        alt_client,
    }
}

/// Set exchange rates for both tokens (1:1 parity by default).
fn set_rates_parity(ctx: &MaCtx) {
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &ctx.base_token, &10_000i128);
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &ctx.alt_token, &10_000i128);
}

/// Set exchange rate for alt token at half the base (1 alt = 0.5 base).
fn set_rates_half(ctx: &MaCtx) {
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &ctx.base_token, &10_000i128);
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &ctx.alt_token, &5_000i128);
}

/// Create a two-outcome multi-asset pool with both base and alt tokens.
fn make_ma_pool(ctx: &MaCtx, creator: &Address) -> u32 {
    let mut allowed = Vec::new(&ctx.env);
    allowed.push_back(ctx.base_token.clone());
    allowed.push_back(ctx.alt_token.clone());

    ctx.client.create_multi_asset_pool(
        creator,
        &String::from_str(&ctx.env, "Multi-Asset Market"),
        &String::from_str(&ctx.env, "Integration test multi-asset pool"),
        &{
            let mut v = Vec::new(&ctx.env);
            v.push_back(String::from_str(&ctx.env, "Yes"));
            v.push_back(String::from_str(&ctx.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None,
    )
}

/// Advance ledger past the pool expiry.
fn expire(ctx: &MaCtx) {
    ctx.env.ledger().with_mut(|l| l.timestamp = 3_700);
}

// ---------------------------------------------------------------------------
// MA-1: Exchange rate validation at pool creation
// ---------------------------------------------------------------------------

/// Pool creation succeeds when both tokens have registered exchange rates.
/// The allowed-tokens list is stored and readable via `get_pool_allowed_tokens`.
#[test]
fn ma1_pool_creation_validates_exchange_rates() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);

    set_rates_half(&ctx);

    let pool_id = make_ma_pool(&ctx, &creator);

    let allowed = ctx
        .client
        .get_pool_allowed_tokens(&pool_id)
        .expect("allowed tokens must be stored");

    assert_eq!(allowed.len(), 2, "pool must have 2 allowed tokens");
    assert!(
        allowed.contains(&ctx.base_token),
        "base token must be in allowed list"
    );
    assert!(
        allowed.contains(&ctx.alt_token),
        "alt token must be in allowed list"
    );

    // Exchange rates are readable.
    assert_eq!(
        ctx.client.get_token_exchange_rate(&ctx.base_token),
        Some(10_000),
        "base token rate must be 10_000"
    );
    assert_eq!(
        ctx.client.get_token_exchange_rate(&ctx.alt_token),
        Some(5_000),
        "alt token rate must be 5_000"
    );
}

/// Pool creation fails when one of the requested tokens has no registered rate.
#[test]
fn ma1b_pool_creation_fails_without_exchange_rate() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);

    // Register rate for base only — alt token has no rate.
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &ctx.base_token, &10_000i128);

    let mut allowed = Vec::new(&ctx.env);
    allowed.push_back(ctx.base_token.clone());
    allowed.push_back(ctx.alt_token.clone());

    let result = ctx.client.try_create_multi_asset_pool(
        &creator,
        &String::from_str(&ctx.env, "Bad Pool"),
        &String::from_str(&ctx.env, "should fail"),
        &{
            let mut v = Vec::new(&ctx.env);
            v.push_back(String::from_str(&ctx.env, "Yes"));
            v.push_back(String::from_str(&ctx.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None::<String>,
    );

    assert_eq!(
        result,
        Err(Ok(ContractError::ExchangeRateNotSet)),
        "pool creation must fail when exchange rate is missing"
    );
}

// ---------------------------------------------------------------------------
// MA-2: Normalised bet amounts reflect exchange rates
// ---------------------------------------------------------------------------

/// A bet of 200 alt tokens (at rate 5_000/10_000 = 0.5) must normalise to
/// 100 base units in the pool totals.
#[test]
fn ma2_bet_normalisation_via_exchange_rate() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);

    set_rates_half(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    ctx.alt_admin.mint(&user, &200i128);
    ctx.client.place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &200i128,
        &ctx.alt_token,
        &None::<Address>,
    );

    // Actual alt tokens must be held in escrow.
    assert_eq!(
        ctx.alt_client.balance(&ctx.client.address),
        200,
        "contract must hold 200 alt tokens in escrow"
    );

    // Pool total_a must reflect normalised amount: 200 × 5000 / 10000 = 100.
    let pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(
        pool.total_a, 100,
        "normalised total_a must be 100 (200 alt × 0.5)"
    );
    assert_eq!(pool.total_b, 0);
}

// ---------------------------------------------------------------------------
// MA-3: Full lifecycle — two users, two tokens, settle and claim
// ---------------------------------------------------------------------------

/// user_a bets 100 base on outcome 0.  user_b bets 200 alt (at 1:1 rate) on
/// outcome 1.  Outcome 0 wins.  user_a receives proportional share of each
/// token's net pool after the 2% protocol fee.
#[test]
fn ma3_full_lifecycle_two_users_two_tokens() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);

    // 1:1 parity simplifies expected payout math.
    set_rates_parity(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    ctx.base_admin.mint(&user_a, &100i128);
    ctx.alt_admin.mint(&user_b, &200i128);

    ctx.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &100i128,
        &ctx.base_token,
        &None::<Address>,
    );
    ctx.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &200i128,
        &ctx.alt_token,
        &None::<Address>,
    );

    // Normalised totals: total_a = 100, total_b = 200.
    let pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100, "normalised total_a must be 100");
    assert_eq!(pool.total_b, 200, "normalised total_b must be 200");

    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0u32);

    // user_a is sole winner (100% of winning side).
    // fee per token = 2% of deposit:
    //   base: fee = 100 × 2% = 2  → net_base = 98
    //   alt:  fee = 200 × 2% = 4  → net_alt  = 196
    ctx.client.claim_multi_asset_winnings(&user_a, &pool_id);

    assert_eq!(
        ctx.base_client.balance(&user_a),
        98,
        "user_a must receive net base tokens (100 - 2% = 98)"
    );
    assert_eq!(
        ctx.alt_client.balance(&user_a),
        196,
        "user_a must receive net alt tokens (200 - 2% = 196)"
    );

    // user_b is on the losing side and must receive nothing.
    assert!(
        ctx.client
            .try_claim_multi_asset_winnings(&user_b, &pool_id)
            .is_err(),
        "loser must not be able to claim"
    );
}

// ---------------------------------------------------------------------------
// MA-4: Three users across two tokens, proportional payouts per token
// ---------------------------------------------------------------------------

/// user_a and user_b both back outcome 0 using different tokens.
/// user_c backs outcome 1.  Payouts must be proportional to normalised winning
/// stake and cover both token types in the pool.
#[test]
fn ma4_three_users_two_tokens_proportional_payout() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env); // outcome 0, base token
    let user_b = Address::generate(&ctx.env); // outcome 0, alt token (0.5 rate)
    let user_c = Address::generate(&ctx.env); // outcome 1, base token

    // alt token is worth 0.5 base.
    set_rates_half(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    // user_a bets 300 base — normalised 300.
    ctx.base_admin.mint(&user_a, &300i128);
    ctx.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &300i128,
        &ctx.base_token,
        &None::<Address>,
    );

    // user_b bets 400 alt — normalised 400 × 0.5 = 200.
    ctx.alt_admin.mint(&user_b, &400i128);
    ctx.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &0u32,
        &400i128,
        &ctx.alt_token,
        &None::<Address>,
    );

    // user_c bets 250 base on outcome 1.
    ctx.base_admin.mint(&user_c, &250i128);
    ctx.client.place_multi_asset_bet(
        &user_c,
        &pool_id,
        &1u32,
        &250i128,
        &ctx.base_token,
        &None::<Address>,
    );

    // Verify normalised totals:
    //   total_a = 300 + 200 = 500
    //   total_b = 250
    let pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 500, "normalised total_a must be 500");
    assert_eq!(pool.total_b, 250, "normalised total_b must be 250");

    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0u32);

    // Total token deposits (in own units):
    //   base_deposit = 300 (user_a) + 250 (user_c) = 550
    //   alt_deposit  = 400 (user_b)
    //
    // Fees (2%):
    //   fee_base = 550 × 2% = 11  → net_base = 539
    //   fee_alt  = 400 × 2% = 8   → net_alt  = 392
    //
    // Winners' normalised stakes:
    //   user_a norm = 300,  user_b norm = 200,  total_norm_winning = 500
    //
    // Payouts per token:
    //   user_a_base = net_base × 300 / 500 = 539 × 300 / 500 = 323
    //   user_a_alt  = net_alt  × 300 / 500 = 392 × 300 / 500 = 235
    //   user_b_base = net_base × 200 / 500 = 539 × 200 / 500 = 215
    //   user_b_alt  = net_alt  × 200 / 500 = 392 × 200 / 500 = 156

    // user_a claims.
    ctx.client.claim_multi_asset_winnings(&user_a, &pool_id);
    let user_a_base = ctx.base_client.balance(&user_a);
    let user_a_alt = ctx.alt_client.balance(&user_a);
    assert_eq!(user_a_base, 323, "user_a base payout");
    assert_eq!(user_a_alt, 235, "user_a alt payout");

    // user_b claims.
    ctx.client.claim_multi_asset_winnings(&user_b, &pool_id);
    let user_b_base = ctx.base_client.balance(&user_b);
    let user_b_alt = ctx.alt_client.balance(&user_b);
    assert_eq!(user_b_base, 215, "user_b base payout");
    assert_eq!(user_b_alt, 156, "user_b alt payout");

    // Conservation: payouts + fees == total deposits per token.
    let total_base_paid = user_a_base + user_b_base; // 323 + 215 = 538 (539 - 1 dust)
    let total_alt_paid = user_a_alt + user_b_alt; // 235 + 156 = 391 (392 - 1 dust)
                                                  // Dust (≤ n_winners − 1) must be in pending fees.
    let net_base = 550i128 - (550 * 200 / 10_000); // 539
    let net_alt = 400i128 - (400 * 200 / 10_000); // 392
    assert!(
        total_base_paid >= net_base - 1 && total_base_paid <= net_base,
        "total base paid must equal net_base (±1 dust), got {}",
        total_base_paid
    );
    assert!(
        total_alt_paid >= net_alt - 1 && total_alt_paid <= net_alt,
        "total alt paid must equal net_alt (±1 dust), got {}",
        total_alt_paid
    );

    // Loser cannot claim.
    assert!(
        ctx.client
            .try_claim_multi_asset_winnings(&user_c, &pool_id)
            .is_err(),
        "loser must not be able to claim"
    );
}

// ---------------------------------------------------------------------------
// MA-5: collect_multi_asset_fees sends pending fees to treasury
// ---------------------------------------------------------------------------

/// After the first `claim_multi_asset_winnings` populates the pending fees,
/// `collect_multi_asset_fees` transfers them to the treasury recipient.
#[test]
fn ma5_collect_fees_sends_both_token_fees_to_treasury() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);

    set_rates_parity(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    ctx.base_admin.mint(&user_a, &500i128);
    ctx.alt_admin.mint(&user_b, &500i128);

    ctx.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &500i128,
        &ctx.base_token,
        &None::<Address>,
    );
    ctx.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &500i128,
        &ctx.alt_token,
        &None::<Address>,
    );

    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0u32);

    // First claim populates PoolTokenFeePending.
    ctx.client.claim_multi_asset_winnings(&user_a, &pool_id);

    let treasury_base_before = ctx.base_client.balance(&ctx.treasury);
    let treasury_alt_before = ctx.alt_client.balance(&ctx.treasury);

    ctx.client.collect_multi_asset_fees(&ctx.treasury, &pool_id);

    // 2% of 500 = 10 per token.
    assert_eq!(
        ctx.base_client.balance(&ctx.treasury) - treasury_base_before,
        10,
        "treasury must receive 10 base tokens as fee"
    );
    assert_eq!(
        ctx.alt_client.balance(&ctx.treasury) - treasury_alt_before,
        10,
        "treasury must receive 10 alt tokens as fee"
    );
}

// ---------------------------------------------------------------------------
// MA-6: Unsupported token rejected with correct error
// ---------------------------------------------------------------------------

/// Attempting to bet with a token not in the pool's allowed list must return
/// `UnsupportedToken`, not a silent success or a generic panic.
#[test]
fn ma6_bet_with_unsupported_token_returns_error() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);

    set_rates_half(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    // Register a third token with a rate but keep it out of the pool.
    let third_asset = ctx
        .env
        .register_stellar_asset_contract_v2(ctx.treasury.clone());
    let third_token = third_asset.address();
    ctx.client
        .set_token_exchange_rate(&ctx.treasury, &third_token, &10_000i128);
    token::StellarAssetClient::new(&ctx.env, &third_token).mint(&user, &100i128);

    let result = ctx.client.try_place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &100i128,
        &third_token,
        &None::<Address>,
    );
    assert_eq!(
        result,
        Err(Ok(ContractError::UnsupportedToken)),
        "bet with unsupported token must return UnsupportedToken"
    );
}

// ---------------------------------------------------------------------------
// MA-7: claim_winnings is rejected for multi-asset pools
// ---------------------------------------------------------------------------

/// A winner in a multi-asset pool who accidentally calls `claim_winnings`
/// (the single-asset variant) must receive `MultiAssetClaimRequired`.
#[test]
fn ma7_single_asset_claim_rejected_for_multi_asset_pool() {
    let ctx = setup_ma();
    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);

    set_rates_parity(&ctx);
    let pool_id = make_ma_pool(&ctx, &creator);

    ctx.base_admin.mint(&user_a, &100i128);
    ctx.base_admin.mint(&user_b, &50i128);

    ctx.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &100i128,
        &ctx.base_token,
        &None::<Address>,
    );
    ctx.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &50i128,
        &ctx.base_token,
        &None::<Address>,
    );

    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0u32);

    let result = ctx.client.try_claim_winnings(&user_a, &pool_id);
    assert_eq!(
        result,
        Err(Ok(ContractError::MultiAssetClaimRequired)),
        "single-asset claim on a multi-asset pool must return MultiAssetClaimRequired"
    );
}
