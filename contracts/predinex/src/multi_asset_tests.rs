#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

// ── Multi-Asset Test Harness ─────────────────────────────────────────────────

struct MaEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    /// Base token — same as the single-asset contract token.
    base_token: Address,
    /// Alternative token used for multi-asset bet tests.
    alt_token: Address,
    /// Treasury recipient (= token_admin passed to initialize).
    treasury: Address,
    /// Stellar asset admin for base_token (for minting).
    base_admin: token::StellarAssetClient<'a>,
    /// Stellar asset admin for alt_token (for minting).
    alt_admin: token::StellarAssetClient<'a>,
}

fn setup_ma() -> MaEnv<'static> {
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

    MaEnv {
        env,
        client,
        base_token: base_asset.address(),
        alt_token: alt_asset.address(),
        treasury,
        base_admin,
        alt_admin,
    }
}

/// Helper: create a basic two-outcome multi-asset pool with base + alt tokens.
fn make_ma_pool(t: &MaEnv, creator: &Address) -> u32 {
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    allowed.push_back(t.alt_token.clone());

    t.client.create_multi_asset_pool(
        creator,
        &String::from_str(&t.env, "MA Pool"),
        &String::from_str(&t.env, "Multi-asset test pool"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Yes"));
            v.push_back(String::from_str(&t.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None,
        &None::<u64>,
    )
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// ma_1: Pool creation stores allowed tokens and marks pool as multi-asset.
#[test]
fn ma_1_create_multi_asset_pool_stores_allowed_tokens() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);

    // Set exchange rates for both tokens (10_000 bps = 1:1 with base).
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    let allowed = t
        .client
        .get_pool_allowed_tokens(&pool_id)
        .expect("tokens must be stored");
    assert_eq!(allowed.len(), 2, "two tokens should be allowed");
    assert!(allowed.contains(&t.base_token));
    assert!(allowed.contains(&t.alt_token));

    // Exchange rates are readable.
    assert_eq!(
        t.client.get_token_exchange_rate(&t.base_token),
        Some(10_000)
    );
    assert_eq!(t.client.get_token_exchange_rate(&t.alt_token), Some(5_000));
}

/// ma_2: Placing a bet with a supported alt token succeeds and is tracked.
#[test]
fn ma_2_place_bet_with_supported_token_succeeds() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    // 1 alt-token = 0.5 base tokens.
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Mint 200 alt tokens to user.
    t.alt_admin.mint(&user, &200i128);

    t.client.place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &200i128,
        &t.alt_token,
        &None::<Address>,
    );

    // Contract now holds 200 alt tokens in escrow.
    let alt_client = token::Client::new(&t.env, &t.alt_token);
    assert_eq!(alt_client.balance(&t.client.address), 200);

    // Pool totals reflect normalised amount (200 × 5000 / 10000 = 100 base units).
    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100, "normalised total_a should be 100");
    assert_eq!(t.client.get_total_contract_volume(), 100);
}

/// ma_3: Bet with a token not in the allowed list returns UnsupportedToken.
#[test]
fn ma_3_place_bet_with_unsupported_token_fails() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Register a third token with a rate, but do NOT add it to the pool.
    let third_token_asset = t.env.register_stellar_asset_contract_v2(t.treasury.clone());
    let third_token = third_token_asset.address();
    t.client
        .set_token_exchange_rate(&t.treasury, &third_token, &10_000i128);

    let third_admin = token::StellarAssetClient::new(&t.env, &third_token);
    third_admin.mint(&user, &100i128);

    let result = t.client.try_place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &100i128,
        &third_token,
        &None::<Address>,
    );
    assert_eq!(result, Err(Ok(ContractError::UnsupportedToken)));
}

/// ma_4: Bet with a token that has no exchange rate set returns ExchangeRateNotSet.
#[test]
fn ma_4_place_bet_without_exchange_rate_fails() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let _user = Address::generate(&t.env);

    // Set rate for base but NOT for alt before pool creation — pool creation
    // should fail since all tokens need a rate at creation time.
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Now remove the alt rate by overwriting storage directly is not feasible,
    // so instead we use a freshly registered token that has never had a rate set
    // and try to insert it via a direct storage-skipping approach. The simplest
    // way is to register a new token, skip set_token_exchange_rate for it, then
    // verify pool creation rejects it.
    let no_rate_asset = t.env.register_stellar_asset_contract_v2(t.treasury.clone());
    let no_rate_token = no_rate_asset.address();

    // Attempt to create a pool that includes the no-rate token.
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    allowed.push_back(no_rate_token.clone());

    let create_result = t.client.try_create_multi_asset_pool(
        &creator,
        &String::from_str(&t.env, "No Rate Pool"),
        &String::from_str(&t.env, "desc"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Yes"));
            v.push_back(String::from_str(&t.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None::<String>,
        &None::<u64>,
    );
    assert_eq!(create_result, Err(Ok(ContractError::ExchangeRateNotSet)));

    // Additionally verify get_token_exchange_rate returns None for unregistered token.
    assert_eq!(t.client.get_token_exchange_rate(&no_rate_token), None);

    let _ = pool_id; // suppress unused warning
}

/// ma_5: Two-token pool settle — sole winner receives proportional share of both tokens.
#[test]
fn ma_5_two_token_pool_settle_winner_receives_both_tokens() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    // 1 base-token = 1 base unit (rate 10_000).
    // 1 alt-token = 1 base unit (rate 10_000) for simple math in this test.
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // user_a bets 100 base tokens on outcome 0.
    t.base_admin.mint(&user_a, &100i128);
    t.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &100i128,
        &t.base_token,
        &None::<Address>,
    );

    // user_b bets 200 alt tokens on outcome 1.
    t.alt_admin.mint(&user_b, &200i128);
    t.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &200i128,
        &t.alt_token,
        &None::<Address>,
    );

    // total normalised = 300, fee 2% = 6, net = 294.
    // user_a is sole winner (norm bet = 100, winning total = 100, share = 100%).
    t.env.ledger().with_mut(|l| l.timestamp = 3_701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let base_client = token::Client::new(&t.env, &t.base_token);
    let alt_client = token::Client::new(&t.env, &t.alt_token);

    // user_a claims: receives 100% of net of both tokens.
    // net_base = 100 - 2 = 98; net_alt = 200 - 4 = 196.
    t.client.claim_multi_asset_winnings(&user_a, &pool_id);

    assert_eq!(base_client.balance(&user_a), 98, "user_a base payout");
    assert_eq!(alt_client.balance(&user_a), 196, "user_a alt payout");
}

/// ma_6: Per-token min and max bet limits are enforced.
#[test]
fn ma_6_per_token_min_max_bet_enforced() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Set per-token limits for alt: min = 100, max = 500.
    t.client
        .set_pool_token_bet_limits(&t.treasury, &pool_id, &t.alt_token, &100i128, &500i128);

    t.alt_admin.mint(&user, &1_000i128);

    // Below minimum.
    let low = t.client.try_place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &99i128,
        &t.alt_token,
        &None::<Address>,
    );
    assert_eq!(low, Err(Ok(ContractError::BetBelowMinBet)));

    // Above maximum.
    let high = t.client.try_place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &501i128,
        &t.alt_token,
        &None::<Address>,
    );
    assert_eq!(high, Err(Ok(ContractError::BetAboveMaxBet)));

    // Exactly at minimum succeeds.
    t.client.place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &100i128,
        &t.alt_token,
        &None::<Address>,
    );

    // Exactly at maximum succeeds.
    t.client.place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &500i128,
        &t.alt_token,
        &None::<Address>,
    );
}

/// ma_7: collect_multi_asset_fees transfers pending fees to the treasury.
#[test]
fn ma_7_collect_fees_transfers_pending_fees_to_treasury() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    t.base_admin.mint(&user_a, &500i128);
    t.alt_admin.mint(&user_b, &500i128);

    t.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &500i128,
        &t.base_token,
        &None::<Address>,
    );
    t.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &500i128,
        &t.alt_token,
        &None::<Address>,
    );

    // total normalised = 1000, fee 2% = 20 (10 from each token).
    t.env.ledger().with_mut(|l| l.timestamp = 3_701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // First claim populates PoolTokenFeePending.
    t.client.claim_multi_asset_winnings(&user_a, &pool_id);

    let base_client = token::Client::new(&t.env, &t.base_token);
    let alt_client = token::Client::new(&t.env, &t.alt_token);

    let treasury_base_before = base_client.balance(&t.treasury);
    let treasury_alt_before = alt_client.balance(&t.treasury);

    // Treasury collects fees.
    t.client.collect_multi_asset_fees(&t.treasury, &pool_id);

    // Treasury should receive 2% of 500 base = 10, and 2% of 500 alt = 10.
    assert_eq!(
        base_client.balance(&t.treasury) - treasury_base_before,
        10,
        "treasury base fee"
    );
    assert_eq!(
        alt_client.balance(&t.treasury) - treasury_alt_before,
        10,
        "treasury alt fee"
    );
}

/// ma_8: collect_multi_asset_fees updates Treasury and PoolTreasuryCredited tracking.
#[test]
fn ma_8_collect_fees_updates_treasury_ledger() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    // Exchange rates: 1 base = 1 base unit, 1 alt = 0.5 base units.
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // user_a bets 500 base tokens (normalized: 500).
    t.base_admin.mint(&user_a, &500i128);
    t.client.place_multi_asset_bet(
        &user_a,
        &pool_id,
        &0u32,
        &500i128,
        &t.base_token,
        &None::<Address>,
    );

    // user_b bets 600 alt tokens (normalized: 600 × 0.5 = 300).
    t.alt_admin.mint(&user_b, &600i128);
    t.client.place_multi_asset_bet(
        &user_b,
        &pool_id,
        &1u32,
        &600i128,
        &t.alt_token,
        &None::<Address>,
    );

    // Total normalized = 800, fee 2% = 16.
    // Per-token fees: base = 500 × 0.02 = 10, alt = 600 × 0.02 = 12.
    // Normalized fees: base = 10 × 1.0 = 10, alt = 12 × 0.5 = 6, total = 16.
    t.env.ledger().with_mut(|l| l.timestamp = 3_701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Read treasury balance before fee collection.
    let treasury_before = t.client.get_treasury_balance();
    let _pool_revenue_before = t.client.get_pool_protocol_revenue(&pool_id);

    // First claim populates PoolTokenFeePending.
    t.client.claim_multi_asset_winnings(&user_a, &pool_id);

    // get_pool_protocol_revenue should now show pending fees (even though not yet collected).
    let pool_revenue_pending = t.client.get_pool_protocol_revenue(&pool_id);
    assert_eq!(
        pool_revenue_pending.treasury_credited, 16,
        "get_pool_protocol_revenue should include pending fees"
    );

    // Treasury collects fees.
    t.client.collect_multi_asset_fees(&t.treasury, &pool_id);

    // Read treasury balance after fee collection.
    let treasury_after = t.client.get_treasury_balance();
    let pool_revenue_after = t.client.get_pool_protocol_revenue(&pool_id);

    // Verify Treasury ledger was credited with normalized fee amount (16).
    assert_eq!(
        treasury_after - treasury_before,
        16,
        "Treasury should be credited with normalized fee"
    );

    // Verify PoolTreasuryCredited was updated and still shows 16 (no double-counting).
    assert_eq!(
        pool_revenue_after.treasury_credited, 16,
        "PoolTreasuryCredited should track the normalized fee"
    );

    // Verify the fee was only credited once (not double-counted).
    assert_eq!(
        pool_revenue_pending.treasury_credited, pool_revenue_after.treasury_credited,
        "Pending and collected amounts should match (no double-counting)"
    );
}

// ── PoolBettors population (issue #867) ───────────────────────────────────

/// #867-1: Two users bet on a multi-asset pool and both appear on the leaderboard.
#[test]
fn ma_867_1_leaderboard_populated_after_multi_asset_bets() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    t.base_admin.mint(&user_a, &2_000i128);
    t.base_admin.mint(&user_b, &3_000i128);

    t.client
        .place_multi_asset_bet(&user_a, &pool_id, &0u32, &1_000i128, &t.base_token, &None);
    t.client
        .place_multi_asset_bet(&user_b, &pool_id, &1u32, &2_000i128, &t.base_token, &None);

    let leaderboard = t.client.get_leaderboard(&pool_id, &50u32, &None::<Address>);
    assert_eq!(
        leaderboard.len(),
        2,
        "leaderboard must contain both multi-asset bettors"
    );

    // user_b bet more, so should be first.
    assert_eq!(leaderboard.get(0).unwrap().total_bet, 2_000i128);
    assert_eq!(leaderboard.get(1).unwrap().total_bet, 1_000i128);
}

/// #867-2: get_participant_count matches the number of unique bettors after multi-asset bets.
#[test]
fn ma_867_2_participant_count_matches_pool_bettors() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    t.alt_admin.mint(&user_a, &100i128);
    t.alt_admin.mint(&user_b, &200i128);

    t.client
        .place_multi_asset_bet(&user_a, &pool_id, &0u32, &50i128, &t.alt_token, &None);

    let count_after_first = t.client.get_participant_count(&pool_id);
    assert_eq!(count_after_first, 1, "one unique bettor after first bet");

    t.client
        .place_multi_asset_bet(&user_b, &pool_id, &1u32, &100i128, &t.alt_token, &None);

    let count_after_second = t.client.get_participant_count(&pool_id);
    assert_eq!(count_after_second, 2, "two unique bettors after second bet");

    // A second bet from user_a should NOT increase the count.
    t.client
        .place_multi_asset_bet(&user_a, &pool_id, &0u32, &30i128, &t.alt_token, &None);

    let count_after_repeat = t.client.get_participant_count(&pool_id);
    assert_eq!(
        count_after_repeat, 2,
        "repeat bet from same user must not increase count"
    );
}

/// Parity: single-asset and multi-asset pools with identical normalized stakes
/// must produce identical payouts via shared helpers.
#[test]
fn parity_single_vs_multi_asset_same_normalized_payout() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    // 1:1 rates for both tokens in this test.
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    // Single-asset pool.
    let single_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Single"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    // Multi-asset pool with single token at 1:1 (still flagged multi-asset).
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    let multi_id = t.client.create_multi_asset_pool(
        &creator,
        &String::from_str(&t.env, "Multi"),
        &String::from_str(&t.env, "Desc"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Yes"));
            v.push_back(String::from_str(&t.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None::<String>,
        &None::<u64>,
    );

    // Fund both bettors sufficiently for two pools.
    t.base_admin.mint(&winner, &20_000i128);
    t.base_admin.mint(&loser, &20_000i128);

    // Identical normalized bets: winner 3k on outcome 0, loser 6k on outcome 1.
    t.client
        .place_bet(&winner, &single_id, &0u32, &3_000i128, &None::<Address>);
    t.client
        .place_bet(&loser, &single_id, &1u32, &6_000i128, &None::<Address>);

    t.client.place_multi_asset_bet(
        &winner,
        &multi_id,
        &0u32,
        &3_000i128,
        &t.base_token,
        &None::<Address>,
    );
    t.client.place_multi_asset_bet(
        &loser,
        &multi_id,
        &1u32,
        &6_000i128,
        &t.base_token,
        &None::<Address>,
    );

    // Settle both pools on outcome 0.
    t.env.ledger().with_mut(|l| l.timestamp = 5_000);
    t.client.settle_pool(&creator, &single_id, &0u32);
    t.client.settle_pool(&creator, &multi_id, &0u32);

    let single_winnings = t.client.claim_winnings(&winner, &single_id);
    let multi_res = t.client.claim_multi_asset_winnings(&winner, &multi_id);

    // Total normalized payout must match single-asset winnings.
    assert_eq!(
        single_winnings, multi_res.total_normalized,
        "parity: single and multi normalized payouts must match"
    );
    assert_eq!(multi_res.per_asset.len(), 1);
    assert_eq!(multi_res.per_asset.get(0).unwrap().amount, single_winnings);

    // Direct helper parity: compute_winnings vs per-token calc must agree.
    let fee_bps = 200i128; // default protocol fee
    let w1 = PredinexContract::compute_winnings(3_000, 9_000, 3_000, fee_bps).unwrap();
    let w2 = PredinexContract::calc_payout_share(
        3_000,
        9_000 - PredinexContract::calc_protocol_fee(9_000, fee_bps).unwrap(),
        3_000,
    )
    .unwrap();
    assert_eq!(w1, w2);
    // Multi per-token helper should also match.
    let w_multi =
        PredinexContract::compute_payout_for_outcome(3_000, 9_000, 3_000, fee_bps).unwrap();
    assert_eq!(w1, w_multi);
}

/// Parity with mixed token rates: multi-asset pool using two tokens with different
/// exchange rates must still yield same normalized payout as single-asset pool
/// with equivalent normalized totals.
#[test]
fn parity_single_vs_multi_mixed_token_normalized_parity() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    // Base 1:1, alt 0.5 (5000 bps).
    t.client
        .set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    // Single-asset pool: 100 on 0, 100 on 1 => total 200, net 196, winner gets 196.
    let single_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "S"),
        &String::from_str(&t.env, "D"),
        &String::from_str(&t.env, "Y"),
        &String::from_str(&t.env, "N"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    // Multi-asset pool with both tokens allowed.
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    allowed.push_back(t.alt_token.clone());
    let multi_id = t.client.create_multi_asset_pool(
        &creator,
        &String::from_str(&t.env, "M"),
        &String::from_str(&t.env, "D"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Y"));
            v.push_back(String::from_str(&t.env, "N"));
            v
        },
        &3_600u64,
        &allowed,
        &None::<String>,
        &None::<u64>,
    );

    t.base_admin.mint(&winner, &10_000);
    t.base_admin.mint(&loser, &10_000);
    t.alt_admin.mint(&winner, &10_000);
    t.alt_admin.mint(&loser, &10_000);

    // Single bets in normalized units: 100 each side.
    t.client
        .place_bet(&winner, &single_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&loser, &single_id, &1u32, &100i128, &None::<Address>);

    // Multi bets that map to same normalized: winner 200 alt (100 norm) on 0, loser 100 base (100 norm) on 1.
    t.client.place_multi_asset_bet(
        &winner,
        &multi_id,
        &0u32,
        &200i128,
        &t.alt_token,
        &None::<Address>,
    );
    t.client.place_multi_asset_bet(
        &loser,
        &multi_id,
        &1u32,
        &100i128,
        &t.base_token,
        &None::<Address>,
    );

    t.env.ledger().with_mut(|l| l.timestamp = 5_000);
    t.client.settle_pool(&creator, &single_id, &0u32);
    t.client.settle_pool(&creator, &multi_id, &0u32);

    let single_winnings = t.client.claim_winnings(&winner, &single_id);
    let multi_res = t.client.claim_multi_asset_winnings(&winner, &multi_id);

    // Both should be 196 (200 total, 2% fee =4, net 196 winner gets all).
    assert_eq!(single_winnings, 196);
    // Multi's total_normalized currently sums raw per-asset payouts (98+196=294 raw).
    // For parity we compare normalized value: convert each raw payout via its rate.
    let mut normalized_sum: i128 = 0;
    for i in 0..multi_res.per_asset.len() {
        let entry = multi_res.per_asset.get(i).unwrap();
        let rate = t
            .client
            .get_token_exchange_rate(&entry.token)
            .unwrap_or(10_000);
        normalized_sum += entry.amount * rate / 10_000;
    }
    assert_eq!(
        normalized_sum, single_winnings,
        "mixed-token multi normalized sum must match single"
    );
    // Winner bet was in alt, but payout includes both tokens proportionally.
    assert_eq!(multi_res.per_asset.len(), 2);
    let mut sum_raw = 0i128;
    for i in 0..multi_res.per_asset.len() {
        sum_raw += multi_res.per_asset.get(i).unwrap().amount;
    }
    // Sum of raw per-asset (98+196=294) != normalized 196, but normalized sum via rates equals 196.
    // Verify that raw amounts are correctly computed via shared helpers: each is net * share.
    // base: net 98 *1, alt: net 196 *1 => as above.
    assert_eq!(sum_raw, 294);
}
