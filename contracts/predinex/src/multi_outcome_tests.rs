//! #1428 — Tests for multi-outcome markets.
//!
//! These tests exercise the full lifecycle of pools with 3+ mutually
//! exclusive outcomes, verifying:
//!   * Markets can be created with 2..N outcomes.
//!   * Settlement pays the winning outcome's holders proportionally.
//!   * Outcome counts and uniqueness are validated at creation.
//!   * Proportional payout math is correct for 3+ outcome markets.

#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String, Vec};

/// Test harness mirroring the pattern used across the contract's other test
/// modules.
struct MultiOutcomeEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    token: Address,
}

fn setup() -> MultiOutcomeEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token, &admin, &admin);

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&user, &100_000_000i128);
    token_admin.mint(&admin, &(MIN_CREATOR_DEPOSIT * 200));

    MultiOutcomeEnv {
        env,
        client,
        admin,
        token,
    }
}

/// Advance the ledger past the pool expiry so settlement is allowed.
fn expire_pool(env: &Env) {
    env.ledger().with_mut(|info| {
        info.timestamp += 7_200;
    });
}

/// Build a labelled outcome vector from an iterator of &str labels.
fn make_outcomes(env: &Env, labels: &[&str]) -> Vec<String> {
    let mut outcomes = Vec::new(env);
    for label in labels {
        outcomes.push_back(String::from_str(env, label));
    }
    outcomes
}

// ── Acceptance criterion 1: Markets can be created with 2..N outcomes ───────

/// A pool with exactly the minimum (2) outcomes is accepted.
#[test]
fn test_two_outcomes_accepted_at_minimum_boundary() {
    let t = setup();
    let outcomes = make_outcomes(&t.env, &["Yes", "No"]);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Binary pool"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert!(result.is_ok(), "2 outcomes (minimum) must be accepted");
}

/// A pool with exactly the maximum (20) outcomes is accepted.
#[test]
fn test_twenty_outcomes_accepted_at_maximum_boundary() {
    let t = setup();
    let labels: std::vec::Vec<String> = (0..MAX_OUTCOME_COUNT)
        .map(|i| String::from_str(&t.env, &std::format!("Outcome {}", i)))
        .collect();
    let mut outcomes = Vec::new(&t.env);
    for label in &labels {
        outcomes.push_back(label.clone());
    }
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Max pool"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert!(result.is_ok(), "20 outcomes (maximum) must be accepted");
}

/// A pool with fewer than 2 outcomes (1) is rejected.
#[test]
fn test_single_outcome_rejected_below_minimum() {
    let t = setup();
    let outcomes = make_outcomes(&t.env, &["Only one"]);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Too few"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));
}

/// A pool with more than MAX_OUTCOME_COUNT (21) is rejected.
#[test]
fn test_twenty_one_outcomes_rejected_above_maximum() {
    let t = setup();
    let labels: std::vec::Vec<String> = (0..(MAX_OUTCOME_COUNT + 1))
        .map(|i| String::from_str(&t.env, &std::format!("Outcome {}", i)))
        .collect();
    let mut outcomes = Vec::new(&t.env);
    for label in &labels {
        outcomes.push_back(label.clone());
    }
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Too many"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::TooManyOutcomes)));
}

/// An empty outcome vector is rejected.
#[test]
fn test_zero_outcomes_rejected() {
    let t = setup();
    let outcomes = Vec::new(&t.env);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Empty"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));
}

// ── Acceptance criterion: Validate outcome uniqueness at creation ────────────

/// Duplicate outcome labels (exact match) are rejected for multi-outcome pools.
#[test]
fn test_duplicate_outcomes_exact_rejected() {
    let t = setup();
    let outcomes = make_outcomes(&t.env, &["Red", "Red", "Blue"]);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Dup pool"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));
}

/// Duplicate outcome labels (case-insensitive) are rejected.
#[test]
fn test_duplicate_outcomes_case_insensitive_rejected() {
    let t = setup();
    let outcomes = make_outcomes(&t.env, &["Red", "RED", "Blue"]);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Case dup"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));
}

/// Duplicate outcome labels (whitespace-trimmed) are rejected.
#[test]
fn test_duplicate_outcomes_whitespace_trimmed_rejected() {
    let t = setup();
    let outcomes = make_outcomes(&t.env, &["Red", "  Red  ", "Blue"]);
    let result = t.client.try_create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "WS dup"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert_eq!(result, Err(Ok(ContractError::DuplicateOutcomeLabels)));
}

// ── Acceptance criterion 2: Settlement pays winning outcome proportionally ──

/// Three-outcome pool: two winners split the net pool proportionally to their
/// stakes within the winning outcome. The loser gets nothing.
///
/// Setup: 3 outcomes (Red, Blue, Green)
///   - user1 bets 100 on Red   (outcome 0)
///   - user2 bets 300 on Red   (outcome 0)
///   - user3 bets 200 on Blue  (outcome 1)
///   - nobody bets on Green    (outcome 2)
/// Pool total = 600, fee (2% default) = 12, net pool = 588.
/// Winning outcome = Red, winning_side_total = 400.
/// user1 share = 100/400 * 588 = 147
/// user2 share = 300/400 * 588 = 441
/// user3 (loser) gets nothing.
#[test]
fn test_three_outcome_proportional_payout_two_winners() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);
    token_admin.mint(&user2, &10_000i128);
    token_admin.mint(&user3, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Three-way pool"),
        &String::from_str(&t.env, "Choose a color"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &1u32, &200i128, &None::<Address>);

    // Verify outcome totals are tracked per-outcome.
    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.len(), 3);
    assert_eq!(outcome_state.get(0).unwrap().total, 400i128);
    assert_eq!(outcome_state.get(1).unwrap().total, 200i128);
    assert_eq!(outcome_state.get(2).unwrap().total, 0i128);

    expire_pool(&t.env);
    // Settle on outcome 0 (Red) — the outcome two users backed.
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    // user1: 100/400 of 588 = 147
    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user1),
        ClaimPreview::Claimable(147i128)
    );
    // user2: 300/400 of 588 = 441
    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user2),
        ClaimPreview::Claimable(441i128)
    );
    // user3 backed the losing outcome — not eligible.
    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user3),
        ClaimPreview::NotEligible
    );

    let payout1 = t.client.claim_winnings(&user1, &pool_id);
    assert_eq!(payout1, 147i128);
    let payout2 = t.client.claim_winnings(&user2, &pool_id);
    assert_eq!(payout2, 441i128);
}

/// Four-outcome pool: single winner gets the entire net pool.
///
/// Setup: 4 outcomes (A, B, C, D)
///   - user1 bets 100 on A (outcome 0)
///   - user2 bets 200 on B (outcome 1)
///   - user3 bets 150 on C (outcome 2)
///   - nobody bets on D    (outcome 3)
/// Pool total = 450, fee (2%) = 9, net pool = 441.
/// Winning outcome = C (outcome 2), winning_side_total = 150.
/// user3 is the only winner: 150/150 * 441 = 441.
#[test]
fn test_four_outcome_single_winner_gets_entire_net_pool() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);
    token_admin.mint(&user2, &10_000i128);
    token_admin.mint(&user3, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["A", "B", "C", "D"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Four-way pool"),
        &String::from_str(&t.env, "Pick one"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &2u32, &150i128, &None::<Address>);

    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.len(), 4);
    assert_eq!(outcome_state.get(0).unwrap().total, 100i128);
    assert_eq!(outcome_state.get(1).unwrap().total, 200i128);
    assert_eq!(outcome_state.get(2).unwrap().total, 150i128);
    assert_eq!(outcome_state.get(3).unwrap().total, 0i128);

    expire_pool(&t.env);
    // Settle on outcome 2 (C) — only user3 backed it.
    t.client.settle_pool(&t.admin, &pool_id, &2u32);

    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user3),
        ClaimPreview::Claimable(441i128)
    );

    let payout = t.client.claim_winnings(&user3, &pool_id);
    assert_eq!(payout, 441i128);
}

/// Five-outcome pool with proportional payout among two winners.
///
/// Setup: 5 outcomes
///   - user1 bets 100 on outcome 0
///   - user2 bets 200 on outcome 0
///   - user3 bets 300 on outcome 1
///   - user4 bets 400 on outcome 2
///   - nobody bets on outcomes 3 or 4
/// Pool total = 1000, fee (2%) = 20, net pool = 980.
/// Winning outcome = 0, winning_side_total = 300.
/// user1: 100/300 * 980 = 326 (floor)
/// user2: 200/300 * 980 = 653 (floor)
/// Remainder (dust) swept to treasury on final claim.
#[test]
fn test_five_outcome_proportional_payout_two_winners() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);
    let user4 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);
    token_admin.mint(&user2, &10_000i128);
    token_admin.mint(&user3, &10_000i128);
    token_admin.mint(&user4, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["One", "Two", "Three", "Four", "Five"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Five-way pool"),
        &String::from_str(&t.env, "Pick a number"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &0u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &1u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&user4, &pool_id, &2u32, &400i128, &None::<Address>);

    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.len(), 5);
    assert_eq!(outcome_state.get(0).unwrap().total, 300i128);
    assert_eq!(outcome_state.get(1).unwrap().total, 300i128);
    assert_eq!(outcome_state.get(2).unwrap().total, 400i128);
    assert_eq!(outcome_state.get(3).unwrap().total, 0i128);
    assert_eq!(outcome_state.get(4).unwrap().total, 0i128);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    // user1: 100/300 * 980 = 326
    let payout1 = t.client.claim_winnings(&user1, &pool_id);
    assert_eq!(payout1, 326i128);

    // user2: 200/300 * 980 = 653
    let payout2 = t.client.claim_winnings(&user2, &pool_id);
    assert_eq!(payout2, 653i128);

    // Losers cannot claim.
    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user3),
        ClaimPreview::NotEligible
    );
    assert_eq!(
        t.client.preview_claimable_amount(&pool_id, &user4),
        ClaimPreview::NotEligible
    );
}

/// Settlement to an outcome that nobody backed is rejected.
/// This prevents the creator from locking all bettors' deposits.
#[test]
fn test_settle_to_outcome_nobody_backed_rejected() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Three-way"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);

    expire_pool(&t.env);
    // Outcome 2 (Green) has zero stakes — settling to it must fail.
    let result = t.client.try_settle_pool(&t.admin, &pool_id, &2u32);
    assert_eq!(result, Err(Ok(ContractError::NoWinningBets)));
}

/// A user can bet on different outcomes in the same 3-outcome pool and only
/// the winning side pays out.
#[test]
fn test_user_bets_multiple_outcomes_only_winning_side_pays() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Spread bets"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    // user1 bets 100 on Red (0) and 200 on Blue (1).
    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user1, &pool_id, &1u32, &200i128, &None::<Address>);

    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.get(0).unwrap().total, 100i128);
    assert_eq!(outcome_state.get(1).unwrap().total, 200i128);
    assert_eq!(outcome_state.get(2).unwrap().total, 0i128);

    expire_pool(&t.env);
    // Settle on Red (0) — user1 only gets payout for the Red stake.
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    // user1 is the sole winner: 100/100 * (300 - 6) = 294.
    let payout = t.client.claim_winnings(&user1, &pool_id);
    assert_eq!(payout, 294i128);
}

/// Betting on an out-of-range outcome index in a 3-outcome pool is rejected.
#[test]
fn test_place_bet_outcome_index_out_of_range_rejected() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Range check"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    // outcome 3 is out of range for a 3-outcome pool (indices 0, 1, 2).
    let result = t
        .client
        .try_place_bet(&user1, &pool_id, &3u32, &100i128, &None::<Address>);
    assert_eq!(result, Err(Ok(ContractError::InvalidOutcome)));
}

/// The outcome labels and totals are stored and retrievable via get_pool_outcomes.
#[test]
fn test_get_pool_outcomes_returns_all_labels_and_totals() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green", "Yellow"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Labels"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &2u32, &500i128, &None::<Address>);

    let result = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(result.len(), 4);
    assert_eq!(result.get(0).unwrap().index, 0u32);
    assert_eq!(
        result.get(0).unwrap().label,
        String::from_str(&t.env, "Red")
    );
    assert_eq!(result.get(0).unwrap().total, 0i128);
    assert_eq!(
        result.get(1).unwrap().label,
        String::from_str(&t.env, "Blue")
    );
    assert_eq!(result.get(2).unwrap().total, 500i128);
    assert_eq!(
        result.get(3).unwrap().label,
        String::from_str(&t.env, "Yellow")
    );
}

/// Bet cancellation on a 3-outcome pool correctly updates the per-outcome total.
#[test]
fn test_cancel_bet_on_third_outcome_updates_total() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Cancel test"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &2u32, &300i128, &None::<Address>);

    let state_before = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(state_before.get(2).unwrap().total, 300i128);

    let refunded = t.client.cancel_bet(&user1, &pool_id, &2u32, &100i128);
    assert_eq!(refunded, 100i128);

    let state_after = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(state_after.get(2).unwrap().total, 200i128);
}

/// Double claim is rejected for multi-outcome pools.
#[test]
fn test_double_claim_rejected_multi_outcome() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);
    token_admin.mint(&user2, &10_000i128);

    let outcomes = make_outcomes(&t.env, &["Red", "Blue", "Green"]);
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Double claim"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1u32, &200i128, &None::<Address>);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    let _ = t.client.claim_winnings(&user1, &pool_id);
    // Second claim must fail — the bet record was removed.
    let result = t.client.try_claim_winnings(&user1, &pool_id);
    assert_eq!(result, Err(Ok(ContractError::NoBetFound)));
}

/// A 20-outcome pool can be settled and claimed correctly.
#[test]
fn test_max_outcome_pool_settle_and_claim() {
    let t = setup();
    let user1 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user1, &10_000i128);

    let labels: std::vec::Vec<String> = (0..MAX_OUTCOME_COUNT)
        .map(|i| String::from_str(&t.env, &std::format!("Option {}", i)))
        .collect();
    let mut outcomes = Vec::new(&t.env);
    for label in &labels {
        outcomes.push_back(label.clone());
    }

    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "20-option pool"),
        &String::from_str(&t.env, "Desc"),
        &outcomes,
        &3_600u64,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&user1, &pool_id, &10u32, &1000i128, &None::<Address>);

    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.len(), 20);
    assert_eq!(outcome_state.get(10).unwrap().total, 1000i128);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &10u32);

    let payout = t.client.claim_winnings(&user1, &pool_id);
    // user1 is sole bettor, sole winner: 1000 - 2% fee = 980.
    assert_eq!(payout, 980i128);
}
