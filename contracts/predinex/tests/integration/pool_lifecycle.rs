//! Full pool lifecycle integration tests (issue #448).
//!
//! Covers: create → deposit (LP) → trade (bet) → settle → withdraw (claim / LP).
//! Each helper function is documented at its declaration site.

extern crate std;

use predinex::{Pool, PredinexContract, PredinexContractClient, MIN_CREATOR_DEPOSIT};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Full test context: contract client, token contract, and named actors.
struct Ctx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
    treasury: Address,
}

/// Boot a fresh environment, register the contract and a token, initialise.
fn setup() -> Ctx<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);
    let token_asset = env.register_stellar_asset_contract_v2(token_admin_addr.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_asset.address(), &treasury, &treasury);

    let token: token::Client<'static> = token::Client::new(&env, &token_asset.address());
    let token_admin: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(&env, &token_asset.address());

    Ctx {
        env,
        client,
        token,
        token_admin,
        treasury,
    }
}

/// Create a pool with a 1-hour duration and return its ID.
fn make_pool(ctx: &Ctx, creator: &Address) -> u32 {
    ctx.client.create_pool(
        creator,
        &String::from_str(&ctx.env, "Will BTC hit $100k?"),
        &String::from_str(&ctx.env, "Binary prediction market"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    )
}

/// Advance the ledger past the pool's 1-hour expiry.
fn expire(ctx: &Ctx) {
    ctx.env.ledger().with_mut(|l| l.timestamp += 3_601);
}

/// Mint `amount` tokens to `addr`.
fn mint(ctx: &Ctx, addr: &Address, amount: i128) {
    ctx.token_admin.mint(addr, &amount);
}

// ---------------------------------------------------------------------------
// Happy path: full binary pool lifecycle
// ---------------------------------------------------------------------------

/// L1: Create a pool → verify initial state.
#[test]
fn l1_create_pool_initial_state() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);

    let pool_id = make_pool(&ctx, &creator);
    assert_eq!(pool_id, 1, "first pool id must be 1");

    let pool: Pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.creator, creator);
    assert_eq!(pool.total_a, 0);
    assert_eq!(pool.total_b, 0);
    assert!(!pool.settled);
    assert!(pool.winning_outcome.is_none());
}

/// L2: LP provides liquidity before bets, bets arrive, LP withdraws with rewards.
/// Ignored: requires provide_liquidity / withdraw_liquidity which are not yet implemented.
#[test]
#[ignore]
fn l2_lp_deposit_bet_settle_lp_withdraw() {
    panic!("LP feature (provide_liquidity / withdraw_liquidity / get_liquidity_info) not yet implemented in contract");
}

/// L3: Bettor on losing side has no winnings to claim.
#[test]
#[should_panic(expected = "Error(Contract, #25)")]
fn l3_losing_bettor_cannot_claim() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let winner = Address::generate(&ctx.env);
    let loser = Address::generate(&ctx.env);

    mint(&ctx, &winner, 200);
    mint(&ctx, &loser, 200);

    let pool_id = make_pool(&ctx, &creator);
    ctx.client
        .place_bet(&winner, &pool_id, &0, &200, &None::<Address>);
    ctx.client
        .place_bet(&loser, &pool_id, &1, &200, &None::<Address>);

    expire(&ctx);
    ctx.client.settle_pool(&ctx.treasury, &pool_id, &0); // A wins

    ctx.client.claim_winnings(&loser, &pool_id);
}

/// L4: Full payout correctness — two winners share the net pool proportionally.
#[test]
fn l4_two_winners_proportional_payout() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let w1 = Address::generate(&ctx.env);
    let w2 = Address::generate(&ctx.env);
    let loser = Address::generate(&ctx.env);

    mint(&ctx, &w1, 300);
    mint(&ctx, &w2, 100);
    mint(&ctx, &loser, 200);

    let pool_id = make_pool(&ctx, &creator);
    ctx.client
        .place_bet(&w1, &pool_id, &0, &300, &None::<Address>); // 300 on A
    ctx.client
        .place_bet(&w2, &pool_id, &0, &100, &None::<Address>); // 100 on A
    ctx.client
        .place_bet(&loser, &pool_id, &1, &200, &None::<Address>); // 200 on B

    expire(&ctx);
    ctx.client.settle_pool(&ctx.treasury, &pool_id, &0); // A wins

    // Total pool = 600. Fee 2% = 12. Net = 588. Winners total = 400.
    // w1 share = 300 * 588 / 400 = 441
    // w2 share = 100 * 588 / 400 = 147
    let w1_win = ctx.client.claim_winnings(&w1, &pool_id);
    let w2_win = ctx.client.claim_winnings(&w2, &pool_id);

    assert_eq!(w1_win, 441, "w1 payout must be 441");
    assert_eq!(w2_win, 147, "w2 payout must be 147");

    // Total paid = 588 = net pool (no LP splitting since no LPs)
    assert_eq!(w1_win + w2_win, 588);
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

/// E1: Premature withdrawal attempt (bet after pool expired is rejected).
#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn e1_bet_after_expiry_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);
    mint(&ctx, &user, 100);

    let pool_id = make_pool(&ctx, &creator);
    expire(&ctx);

    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);
}

/// E2: Claiming on an unsettled pool panics.
#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn e2_claim_before_settlement_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);
    mint(&ctx, &user, 100);

    let pool_id = make_pool(&ctx, &creator);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Pool not settled yet
    ctx.client.claim_winnings(&user, &pool_id);
}

/// E3: Settling before expiry is rejected.
#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn e3_settle_before_expiry_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);

    let pool_id = make_pool(&ctx, &creator);
    // Timestamp is still 0, pool expires at 3600
    ctx.client.settle_pool(&ctx.treasury, &pool_id, &0);
}

/// E4: Minimum position — single token bet, single token LP deposit.
/// Ignored: requires provide_liquidity which is not yet implemented in the contract.
#[test]
#[ignore]
fn e4_minimum_position_single_token() {
    panic!("LP feature (provide_liquidity) not yet implemented in contract");
}

/// E5: Maximum position on both sides, settle, all winners claim successfully.
#[test]
fn e5_maximum_positions_both_sides() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let side_a = Address::generate(&ctx.env);
    let side_b = Address::generate(&ctx.env);

    let big_amount = 1_000_000_000i128;
    mint(&ctx, &side_a, big_amount);
    mint(&ctx, &side_b, big_amount);

    let pool_id = make_pool(&ctx, &creator);
    ctx.client
        .place_bet(&side_a, &pool_id, &0, &big_amount, &None::<Address>);
    ctx.client
        .place_bet(&side_b, &pool_id, &1, &big_amount, &None::<Address>);

    expire(&ctx);
    ctx.client.settle_pool(&ctx.treasury, &pool_id, &1); // B wins

    // side_b is the sole winner: gets net pool = 2_000_000_000 - 2% = 1_960_000_000
    let winnings = ctx.client.claim_winnings(&side_b, &pool_id);
    assert_eq!(winnings, 1_960_000_000i128);
}

/// E6: Multiple LP providers in the same pool are tracked independently.
/// Ignored: requires provide_liquidity / withdraw_liquidity which are not yet implemented.
#[test]
#[ignore]
fn e6_multiple_lp_providers_tracked_independently() {
    panic!("LP feature (provide_liquidity / withdraw_liquidity / get_liquidity_info) not yet implemented in contract");
}

/// E7: Dispute within window blocks claiming until resolved; upheld lets winners claim.
/// Ignored: requires resolve_dispute which is not yet implemented in the contract.
#[test]
#[ignore]
fn e7_dispute_blocks_then_upheld_allows_claim() {
    panic!("resolve_dispute not yet implemented in contract");
}

/// E8: Voided pool after dispute lets all bettors reclaim their full bet amounts.
/// Ignored: requires resolve_dispute which is not yet implemented in the contract.
#[test]
#[ignore]
fn e8_voided_pool_issues_refunds() {
    panic!("resolve_dispute not yet implemented in contract");
}

/// E9: Dispute after window expires is rejected.
#[test]
#[should_panic(expected = "Error(Contract, #28)")]
fn e9_dispute_after_window_rejected() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);

    mint(&ctx, &user, 100);

    let pool_id = make_pool(&ctx, &creator);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    expire(&ctx);
    ctx.client.settle_pool(&ctx.treasury, &pool_id, &0);

    // Advance ledger past dispute window (7 days + 1 second)
    ctx.env.ledger().with_mut(|l| {
        l.timestamp += 7 * 24 * 3600 + 1;
    });

    ctx.client.dispute_pool(&user, &pool_id);
}

/// E10: Unauthorized dispute resolution is rejected.
/// Ignored: requires resolve_dispute which is not yet implemented in the contract.
#[test]
#[ignore]
fn e10_unauthorized_dispute_resolution_rejected() {
    panic!("resolve_dispute not yet implemented in contract");
}

// ---------------------------------------------------------------------------
// Multi-pool interactions
// ---------------------------------------------------------------------------

/// M1: Multiple pools coexist; LP and dispute state is isolated per pool.
/// Ignored: requires provide_liquidity, get_liquidity_info, and get_pool_dispute which are not yet implemented.
#[test]
#[ignore]
fn m1_multiple_pools_state_isolated() {
    panic!("LP feature and get_pool_dispute not yet implemented in contract");
}

/// M2: get_pools_batch returns correct slice across multiple pools.
#[test]
fn m2_get_pools_batch_lifecycle() {
    let ctx = setup();
    let creator = Address::generate(&ctx.env);

    // Create 5 pools
    for _ in 0..5 {
        make_pool(&ctx, &creator);
    }

    let batch = ctx.client.get_pools_batch(&1u32, &3u32);
    assert_eq!(batch.len(), 3);

    // Each entry in batch is Some(Pool)
    for i in 0..3u32 {
        assert!(
            batch.get(i).unwrap().is_some(),
            "pool at index {i} must exist"
        );
    }
}

/// M9: rescue_tokens rejects non-admin callers.
#[test]
fn m9_rescue_tokens_rejects_non_admin() {
    use predinex::ContractError;
    let ctx = setup();
    let non_admin = Address::generate(&ctx.env);
    let to = Address::generate(&ctx.env);

    let result = ctx
        .client
        .try_rescue_tokens(&non_admin, &ctx.token.address, &to, &100i128);
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}
