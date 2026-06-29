// ============================================================================
// Issue #188: Multi-user accumulation tests with repeated bets across both sides
//
// These tests stress repeated betting over time from many actors, verifying
// that stored pool totals and per-user totals stay correct after every step,
// and that final settlement and claim logic works after the accumulation
// sequence.
// ============================================================================

#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

// ── Shared helpers ────────────────────────────────────────────────────────────

struct MultiUserEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: Address,
    _contract_id: Address,
}

fn setup_multi_user() -> MultiUserEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin, &token_admin);

    MultiUserEnv {
        env,
        client,
        token: token_id.address(),
        _contract_id: contract_id,
    }
}

/// Mint tokens to a user via the token admin.
fn mint(env: &Env, token: &Address, user: &Address, amount: i128) {
    let admin = soroban_sdk::token::StellarAssetClient::new(env, token);
    admin.mint(user, &amount);
}

/// Create a standard 1-hour pool and return its ID.
fn make_pool_mu(t: &MultiUserEnv) -> u32 {
    let creator = Address::generate(&t.env);
    t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Accumulation Pool"),
        &String::from_str(&t.env, "Multi-user stress test"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    )
}

/// Advance the ledger past the pool expiry.
fn expire_mu(env: &Env) {
    env.ledger().with_mut(|li| {
        li.timestamp = 7_200;
    });
}

// ── Suite M — multi-user accumulation ────────────────────────────────────────

/// M1: Pool totals accumulate correctly across many users betting on both sides.
///
/// Five users each place two bets (one on each outcome). After all bets the
/// pool totals must equal the sum of every individual bet.
#[test]
fn m1_pool_totals_accumulate_across_many_users() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let users: alloc::vec::Vec<Address> = (0..5).map(|_| Address::generate(&t.env)).collect();
    let bet_a = 100i128;
    let bet_b = 200i128;

    for user in &users {
        mint(&t.env, &t.token, user, bet_a + bet_b);
        t.client
            .place_bet(user, &pool_id, &0u32, &bet_a, &None::<Address>);
        t.client
            .place_bet(user, &pool_id, &1u32, &bet_b, &None::<Address>);
    }

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let expected_a = bet_a * users.len() as i128;
    let expected_b = bet_b * users.len() as i128;

    assert_eq!(
        pool.total_a, expected_a,
        "total_a must equal sum of all outcome-A bets"
    );
    assert_eq!(
        pool.total_b, expected_b,
        "total_b must equal sum of all outcome-B bets"
    );
}

/// M2: Per-user bet records stay correct after repeated bets on both sides.
///
/// A single user places multiple bets on each outcome in alternating order.
/// The stored `amount_a`, `amount_b`, and `total_bet` must reflect the running
/// cumulative totals after every individual bet.
#[test]
fn m2_per_user_totals_stay_correct_after_repeated_bets() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 10_000);

    // Interleave bets on both outcomes
    let bets: &[(u32, i128)] = &[(0, 100), (1, 200), (0, 150), (1, 50), (0, 300), (1, 400)];

    let mut expected_a = 0i128;
    let mut expected_b = 0i128;

    for &(outcome, amount) in bets {
        t.client
            .place_bet(&user, &pool_id, &outcome, &amount, &None::<Address>);
        if outcome == 0 {
            expected_a += amount;
        } else {
            expected_b += amount;
        }

        let bet = t
            .client
            .get_user_bet(&pool_id, &user)
            .expect("bet must exist");
        assert_eq!(
            bet.amount_a, expected_a,
            "amount_a must match running total after each bet"
        );
        assert_eq!(
            bet.amount_b, expected_b,
            "amount_b must match running total after each bet"
        );
        assert_eq!(
            bet.total_bet,
            expected_a + expected_b,
            "total_bet must equal sum of both sides"
        );
    }
}

/// M3: Participant count increments once per new user, not once per bet.
///
/// Three users each place multiple bets. The participant count must equal 3,
/// not the total number of bet calls.
#[test]
fn m3_participant_count_increments_once_per_user() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);

    for user in [&user1, &user2, &user3] {
        mint(&t.env, &t.token, user, 1_000);
    }

    // Each user places two bets
    t.client
        .place_bet(&user1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user1, &pool_id, &1u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &0u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &1u32, &300i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(
        pool.participant_count, 3,
        "participant_count must be 3 (one per unique user)"
    );
}

/// M4: Settlement and claim payouts are correct after a multi-user accumulation.
///
/// Four users bet on outcome A, two users bet on outcome B. Outcome A wins.
/// Each winner's payout must equal their proportional share of the net pool.
#[test]
fn m4_settlement_and_claims_correct_after_accumulation() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    // Winners bet on outcome A
    let winners: alloc::vec::Vec<Address> = (0..4).map(|_| Address::generate(&t.env)).collect();
    // Losers bet on outcome B
    let losers: alloc::vec::Vec<Address> = (0..2).map(|_| Address::generate(&t.env)).collect();

    let winner_bet = 250i128;
    let loser_bet = 500i128;

    for w in &winners {
        mint(&t.env, &t.token, w, winner_bet);
        t.client
            .place_bet(w, &pool_id, &0u32, &winner_bet, &None::<Address>);
    }
    for l in &losers {
        mint(&t.env, &t.token, l, loser_bet);
        t.client
            .place_bet(l, &pool_id, &1u32, &loser_bet, &None::<Address>);
    }

    // total_a = 4 * 250 = 1000, total_b = 2 * 500 = 1000, total = 2000
    let total_a = winner_bet * winners.len() as i128; // 1000
    let total_b = loser_bet * losers.len() as i128; // 1000
    let total_pool = total_a + total_b; // 2000
    let fee = (total_pool * 200) / 10_000; // 2% = 40
    let net = total_pool - fee; // 1960

    expire_mu(&t.env);

    // Settle with outcome 0 (A wins) — creator is the pool creator address
    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let creator = pool.creator.clone();
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Each winner's expected payout: winner_bet * net / total_a
    let expected_payout = (winner_bet * net) / total_a; // 250 * 1960 / 1000 = 490

    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    for w in &winners {
        let winnings = t.client.claim_winnings(w, &pool_id);
        assert_eq!(
            winnings, expected_payout,
            "each winner must receive their proportional share"
        );
        assert_eq!(
            token_client.balance(w),
            expected_payout,
            "winner token balance must equal payout"
        );
    }

    // Losers must not be able to claim
    for l in &losers {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.client.claim_winnings(l, &pool_id);
        }));
        assert!(result.is_err(), "loser claim must panic");
    }
}

/// M5: Pool totals stay correct when users place many small repeated bets.
///
/// Ten users each place ten bets of 10 tokens on outcome A. The pool total_a
/// must equal 10 * 10 * 10 = 1000 and total_b must remain 0.
#[test]
fn m5_pool_totals_correct_with_many_small_repeated_bets() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let num_users = 10usize;
    let bets_per_user = 10usize;
    let bet_amount = 10i128;

    let users: alloc::vec::Vec<Address> =
        (0..num_users).map(|_| Address::generate(&t.env)).collect();

    for user in &users {
        mint(&t.env, &t.token, user, bet_amount * bets_per_user as i128);
        for _ in 0..bets_per_user {
            t.client
                .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
        }
    }

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let expected_total_a = bet_amount * (num_users * bets_per_user) as i128;

    assert_eq!(
        pool.total_a, expected_total_a,
        "total_a must equal sum of all small bets"
    );
    assert_eq!(pool.total_b, 0i128, "total_b must remain 0");
}

/// M6: Asymmetric multi-user accumulation — unequal bets on both sides.
///
/// Users place varying amounts on both outcomes. After settlement the winner
/// with the largest stake receives the largest payout, proportional to their
/// share of the winning side.
#[test]
fn m6_asymmetric_accumulation_payouts_are_proportional() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    // Three winners with different stakes on outcome A
    let winner1 = Address::generate(&t.env);
    let winner2 = Address::generate(&t.env);
    let winner3 = Address::generate(&t.env);
    // One loser on outcome B
    let loser = Address::generate(&t.env);

    mint(&t.env, &t.token, &winner1, 100);
    mint(&t.env, &t.token, &winner2, 300);
    mint(&t.env, &t.token, &winner3, 600);
    mint(&t.env, &t.token, &loser, 400);

    t.client
        .place_bet(&winner1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&winner2, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&winner3, &pool_id, &0u32, &600i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &400i128, &None::<Address>);

    // total_a = 1000, total_b = 400, total = 1400
    let total_pool = 1400i128;
    let fee = (total_pool * 200) / 10_000; // 28
    let net = total_pool - fee; // 1372
    let total_a = 1000i128;

    expire_mu(&t.env);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let creator = pool.creator.clone();
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Expected payouts proportional to stake
    let payout1 = (100i128 * net) / total_a; // 100 * 1372 / 1000 = 137
    let payout2 = (300i128 * net) / total_a; // 300 * 1372 / 1000 = 411
    let payout3 = (600i128 * net) / total_a; // 600 * 1372 / 1000 = 823

    assert_eq!(
        t.client.claim_winnings(&winner1, &pool_id),
        payout1,
        "winner1 payout must be proportional to their stake"
    );
    assert_eq!(
        t.client.claim_winnings(&winner2, &pool_id),
        payout2,
        "winner2 payout must be proportional to their stake"
    );
    assert_eq!(
        t.client.claim_winnings(&winner3, &pool_id),
        payout3,
        "winner3 payout must be proportional to their stake"
    );

    // Loser cannot claim
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&loser, &pool_id);
    }));
    assert!(result.is_err(), "loser claim must panic");
}

/// M7: Treasury balance equals the protocol fee after all winners claim.
///
/// After a full accumulation + settlement + all-claims cycle, the treasury
/// must hold exactly the protocol fee (plus any rounding dust).
#[test]
fn m7_treasury_equals_fee_after_all_claims() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let winners: alloc::vec::Vec<Address> = (0..3).map(|_| Address::generate(&t.env)).collect();
    let loser = Address::generate(&t.env);

    let winner_bet = 200i128;
    let loser_bet = 300i128;

    for w in &winners {
        mint(&t.env, &t.token, w, winner_bet);
        t.client
            .place_bet(w, &pool_id, &0u32, &winner_bet, &None::<Address>);
    }
    mint(&t.env, &t.token, &loser, loser_bet);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &loser_bet, &None::<Address>);

    // total = 3*200 + 300 = 900
    let total_pool = 900i128;
    let expected_fee = (total_pool * 200) / 10_000; // 18

    expire_mu(&t.env);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let creator = pool.creator.clone();
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // All winners claim
    for w in &winners {
        t.client.claim_winnings(w, &pool_id);
    }

    let treasury = t.client.get_treasury_balance();
    // Treasury must hold the fee (plus any integer-division dust, which is ≥ 0)
    assert!(
        treasury >= expected_fee,
        "treasury must hold at least the protocol fee"
    );
    // And must not exceed fee + (n_winners - 1) dust tokens
    assert!(
        treasury <= expected_fee + (winners.len() as i128 - 1),
        "treasury must not exceed fee plus rounding dust"
    );
}

/// M8: Multiple pools accumulate independently — bets in one pool do not
/// affect totals in another.
#[test]
fn m8_multiple_pools_accumulate_independently() {
    let t = setup_multi_user();

    let pool_a = make_pool_mu(&t);
    let pool_b = make_pool_mu(&t);

    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);

    mint(&t.env, &t.token, &user1, 1_000);
    mint(&t.env, &t.token, &user2, 1_000);

    // user1 bets only in pool_a
    t.client
        .place_bet(&user1, &pool_a, &0u32, &400i128, &None::<Address>);
    // user2 bets only in pool_b
    t.client
        .place_bet(&user2, &pool_b, &1u32, &600i128, &None::<Address>);

    let pa = t.client.get_pool(&pool_a).expect("pool_a must exist");
    let pb = t.client.get_pool(&pool_b).expect("pool_b must exist");

    assert_eq!(pa.total_a, 400i128, "pool_a total_a must be 400");
    assert_eq!(pa.total_b, 0i128, "pool_a total_b must be 0");
    assert_eq!(pb.total_a, 0i128, "pool_b total_a must be 0");
    assert_eq!(pb.total_b, 600i128, "pool_b total_b must be 600");
}

/// M9: A user who bets on both sides in the same pool can only claim winnings
/// for the winning side.
#[test]
fn m9_user_betting_both_sides_claims_only_winning_side() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let user = Address::generate(&t.env);
    let other = Address::generate(&t.env);

    mint(&t.env, &t.token, &user, 1_000);
    mint(&t.env, &t.token, &other, 500);

    // User bets on both sides
    t.client
        .place_bet(&user, &pool_id, &0u32, &300i128, &None::<Address>); // outcome A
    t.client
        .place_bet(&user, &pool_id, &1u32, &200i128, &None::<Address>); // outcome B
                                                                        // Other user bets on B to ensure there is a losing side
    t.client
        .place_bet(&other, &pool_id, &1u32, &500i128, &None::<Address>);

    // total_a = 300, total_b = 700, total = 1000
    let total_pool = 1000i128;
    let fee = (total_pool * 200) / 10_000; // 20
    let net = total_pool - fee; // 980
    let total_a = 300i128;

    expire_mu(&t.env);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    let creator = pool.creator.clone();
    t.client.settle_pool(&creator, &pool_id, &0u32); // A wins

    // User's winning stake is 300 (outcome A)
    let expected_payout = (300i128 * net) / total_a; // 300 * 980 / 300 = 980
    let winnings = t.client.claim_winnings(&user, &pool_id);

    assert_eq!(
        winnings, expected_payout,
        "user must receive payout based on winning-side stake only"
    );
}

/// M10: Accumulation sequence — verify pool state after every individual bet.
///
/// Three users each place three bets in sequence. After each bet the pool
/// totals are read and verified to match the running expected values.
#[test]
fn m10_pool_state_verified_after_every_bet_in_sequence() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let user1 = Address::generate(&t.env);
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);

    for u in [&user1, &user2, &user3] {
        mint(&t.env, &t.token, u, 3_000);
    }

    // Sequence of (user_index, outcome, amount)
    let sequence: &[(usize, u32, i128)] = &[
        (0, 0, 100),
        (1, 1, 200),
        (2, 0, 150),
        (0, 1, 300),
        (1, 0, 250),
        (2, 1, 400),
        (0, 0, 50),
        (1, 1, 100),
        (2, 0, 200),
    ];

    let users = [&user1, &user2, &user3];
    let mut running_a = 0i128;
    let mut running_b = 0i128;

    for &(user_idx, outcome, amount) in sequence {
        t.client.place_bet(
            users[user_idx],
            &pool_id,
            &outcome,
            &amount,
            &None::<Address>,
        );
        if outcome == 0 {
            running_a += amount;
        } else {
            running_b += amount;
        }

        let pool = t.client.get_pool(&pool_id).expect("pool must exist");
        assert_eq!(
            pool.total_a, running_a,
            "total_a must match running sum after each bet"
        );
        assert_eq!(
            pool.total_b, running_b,
            "total_b must match running sum after each bet"
        );
    }
}

// ── Suite L — state consistency under load ──────────────────────────────────
//
// These tests exercise many distinct users interacting with the same pool in
// rapid succession (Soroban executes transactions sequentially, so "rapid"
// here means back-to-back invocations with no ledger advance between them) and
// assert that participant_count, outcome totals, and payouts stay internally
// consistent at every step.

/// L1: 50 users place bets on the same pool, then the winning side claims.
///
/// 30 users bet on outcome A (winners), 20 on outcome B (losers). After every
/// bet the running totals and participant_count are re-verified. After
/// settlement, each winner claims in turn and the per-claim payout, the user's
/// token balance, and the running sum of payouts are all checked. The pool's
/// escrow balance must never go negative and the treasury must end holding
/// exactly the protocol fee plus bounded rounding dust.
#[test]
fn l1_fifty_users_same_pool_multiple_winner_claims() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);
    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);
    let contract_addr = t._contract_id.clone();

    let num_winners = 30usize;
    let num_losers = 20usize;
    let winner_bet = 100i128;
    let loser_bet = 50i128;

    let winners: alloc::vec::Vec<Address> = (0..num_winners)
        .map(|_| Address::generate(&t.env))
        .collect();
    let losers: alloc::vec::Vec<Address> =
        (0..num_losers).map(|_| Address::generate(&t.env)).collect();

    // Interleave A/B bets and verify state after each placement.
    let mut running_a = 0i128;
    let mut running_b = 0i128;
    let mut seen_participants = 0u32;
    let max_pairs = core::cmp::max(num_winners, num_losers);
    for i in 0..max_pairs {
        if i < num_winners {
            let w = &winners[i];
            mint(&t.env, &t.token, w, winner_bet);
            t.client
                .place_bet(w, &pool_id, &0u32, &winner_bet, &None::<Address>);
            running_a += winner_bet;
            seen_participants += 1;

            let pool = t.client.get_pool(&pool_id).expect("pool must exist");
            assert_eq!(pool.total_a, running_a, "total_a running sum after A bet");
            assert_eq!(pool.total_b, running_b, "total_b unchanged after A bet");
            assert_eq!(
                pool.participant_count, seen_participants,
                "participant_count must equal number of unique bettors so far"
            );
        }
        if i < num_losers {
            let l = &losers[i];
            mint(&t.env, &t.token, l, loser_bet);
            t.client
                .place_bet(l, &pool_id, &1u32, &loser_bet, &None::<Address>);
            running_b += loser_bet;
            seen_participants += 1;

            let pool = t.client.get_pool(&pool_id).expect("pool must exist");
            assert_eq!(pool.total_b, running_b, "total_b running sum after B bet");
            assert_eq!(pool.total_a, running_a, "total_a unchanged after B bet");
            assert_eq!(
                pool.participant_count, seen_participants,
                "participant_count must equal number of unique bettors so far"
            );
        }
    }

    let total_a = winner_bet * num_winners as i128; // 3000
    let total_b = loser_bet * num_losers as i128; // 1000
    let total_pool = total_a + total_b; // 4000
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().participant_count,
        (num_winners + num_losers) as u32,
        "final participant_count must equal all 50 unique users"
    );
    assert_eq!(
        token_client.balance(&contract_addr),
        total_pool,
        "contract escrow must hold every staked token"
    );

    let fee = (total_pool * 200) / 10_000; // 80
    let net = total_pool - fee; // 3920
    let expected_payout = (winner_bet * net) / total_a; // 100 * 3920 / 3000 = 130

    expire_mu(&t.env);
    let creator = t.client.get_pool(&pool_id).unwrap().creator;
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Each winner claims in rapid succession; verify per-claim consistency.
    let mut total_paid = 0i128;
    for (idx, w) in winners.iter().enumerate() {
        let winnings = t.client.claim_winnings(w, &pool_id);
        assert_eq!(
            winnings, expected_payout,
            "every winner with an equal stake gets an equal payout"
        );
        assert_eq!(
            token_client.balance(w),
            expected_payout,
            "winner token balance equals payout"
        );
        total_paid += winnings;

        // Escrow must always cover what is still owed; never negative.
        let escrow = token_client.balance(&contract_addr);
        assert!(escrow >= 0, "escrow balance must never go negative");

        // Bet record removed → claim status reflects AlreadyClaimed.
        assert_eq!(
            t.client.get_claim_status(&pool_id, w),
            ClaimStatus::AlreadyClaimed,
            "claimed winner #{} must be marked AlreadyClaimed",
            idx
        );
    }

    // Losers cannot claim anything.
    for l in &losers {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.client.claim_winnings(l, &pool_id);
        }));
        assert!(result.is_err(), "loser claim must panic");
    }

    // Conservation: payouts + treasury == total pool (no tokens created/lost).
    let treasury = t.client.get_treasury_balance();
    assert_eq!(
        total_paid + treasury,
        total_pool,
        "sum of payouts plus treasury must equal the total staked"
    );
    assert!(treasury >= fee, "treasury holds at least the protocol fee");
    assert!(
        treasury <= fee + (num_winners as i128 - 1),
        "treasury must not exceed fee plus bounded rounding dust"
    );
}

/// L2: Settle and claim in rapid succession across many winners.
///
/// All winners claim immediately after settlement with no ledger advance
/// between calls. The first claim credits the protocol fee exactly once; the
/// final claim sweeps rounding dust. State (payout-state accounting, treasury,
/// escrow) is asserted after each claim.
#[test]
fn l2_settle_and_claim_rapid_succession() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);
    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);
    let contract_addr = t._contract_id.clone();

    // Uneven stakes to force integer-division rounding dust.
    let winners: alloc::vec::Vec<(Address, i128)> = (0..5)
        .map(|i| (Address::generate(&t.env), 100i128 + (i as i128) * 37))
        .collect();
    let loser = Address::generate(&t.env);
    let loser_bet = 333i128;

    let mut total_a = 0i128;
    for (w, stake) in &winners {
        mint(&t.env, &t.token, w, *stake);
        t.client
            .place_bet(w, &pool_id, &0u32, stake, &None::<Address>);
        total_a += *stake;
    }
    mint(&t.env, &t.token, &loser, loser_bet);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &loser_bet, &None::<Address>);

    let total_pool = total_a + loser_bet;
    let fee = (total_pool * 200) / 10_000;
    let net = total_pool - fee;

    expire_mu(&t.env);
    let creator = t.client.get_pool(&pool_id).unwrap().creator;

    // Settle, then immediately claim — no ledger advance in between.
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let mut total_paid = 0i128;
    let mut claimed_winning_stake = 0i128;
    let n = winners.len();
    for (idx, (w, stake)) in winners.iter().enumerate() {
        let winnings = t.client.claim_winnings(w, &pool_id);
        let expected = (*stake * net) / total_a;
        assert_eq!(winnings, expected, "payout #{} must be proportional", idx);
        total_paid += winnings;
        claimed_winning_stake += *stake;

        // After the first claim the protocol fee must already be credited.
        let payout_state = t
            .client
            .get_pool_payout_state(&pool_id)
            .expect("payout state must exist after first claim");
        assert!(
            payout_state.fee_credited,
            "fee must be credited on/after the first claim"
        );
        assert_eq!(
            payout_state.claimed_winning_stake, claimed_winning_stake,
            "claimed winning stake accumulates exactly"
        );

        let escrow = token_client.balance(&contract_addr);
        assert!(escrow >= 0, "escrow must never be negative mid-claim");

        if idx == n - 1 {
            // Final claim sweeps dust: payouts + treasury == pool exactly.
            let treasury = t.client.get_treasury_balance();
            assert_eq!(
                total_paid + treasury,
                total_pool,
                "after the final claim, payouts + treasury must equal the pool"
            );
            // The treasury accrual (fee + dust) is an on-chain counter that
            // stays in the contract escrow until withdrawn, so the remaining
            // escrow must equal exactly the treasury balance — nothing stranded.
            assert_eq!(
                token_client.balance(&contract_addr),
                treasury,
                "escrow must equal the treasury balance once all winners claim"
            );
        }
    }

    // Double-claim is impossible — the bet record is gone.
    let first_winner = winners[0].0.clone();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&first_winner, &pool_id);
    }));
    assert!(result.is_err(), "re-claiming after payout must panic");
}

/// L3: Rapid interleaved bets from many users keep per-user and pool state
/// consistent, and `claim_all_winnings` batches payouts consistently.
///
/// 12 users bet repeatedly in an interleaved sequence on the same pool. After
/// settlement the winners claim via `claim_all_winnings`; the batch's reported
/// amounts must match each winner's proportional share and the conservation
/// invariant (payouts + treasury == pool) must hold.
#[test]
fn l3_rapid_interleaved_bets_then_batch_claim_consistent() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);
    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    let num_users = 12usize;
    let users: alloc::vec::Vec<Address> =
        (0..num_users).map(|_| Address::generate(&t.env)).collect();
    for u in &users {
        mint(&t.env, &t.token, u, 10_000);
    }

    // Each user bets twice; even-indexed users back A (winners), odd back B.
    // Track expected per-user winning stake on outcome A.
    let mut expected_a_stake: alloc::vec::Vec<i128> = alloc::vec![0i128; num_users];
    let mut running_a = 0i128;
    let mut running_b = 0i128;
    for round in 0..2u32 {
        for (i, u) in users.iter().enumerate() {
            let outcome = (i % 2) as u32; // 0 = A, 1 = B
            let amount = 10i128 + (i as i128) * 5 + (round as i128) * 3;
            t.client
                .place_bet(u, &pool_id, &outcome, &amount, &None::<Address>);
            if outcome == 0 {
                running_a += amount;
                expected_a_stake[i] += amount;
            } else {
                running_b += amount;
            }

            // Verify pool totals and the user's own record stay consistent.
            let pool = t.client.get_pool(&pool_id).unwrap();
            assert_eq!(pool.total_a, running_a, "total_a running sum");
            assert_eq!(pool.total_b, running_b, "total_b running sum");

            let bet = t.client.get_user_bet(&pool_id, u).unwrap();
            assert_eq!(
                bet.amount_a + bet.amount_b,
                bet.total_bet,
                "user amount_a + amount_b must equal total_bet"
            );
        }
    }

    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().participant_count,
        num_users as u32,
        "participant_count must equal the number of unique users"
    );

    let total_a = running_a;
    let total_pool = running_a + running_b;
    let fee = (total_pool * 200) / 10_000;
    let net = total_pool - fee;

    expire_mu(&t.env);
    let creator = t.client.get_pool(&pool_id).unwrap().creator;
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Winners (even indices) batch-claim. claim_all_winnings takes a Vec<u32>.
    let mut total_paid = 0i128;
    for (i, u) in users.iter().enumerate() {
        if i % 2 != 0 {
            continue; // odd users are losers
        }
        let mut ids = Vec::new(&t.env);
        ids.push_back(pool_id);
        let entries = t.client.claim_all_winnings(u, &ids);
        assert_eq!(entries.len(), 1, "one entry per claimable pool");
        let entry = entries.get(0).unwrap();
        let expected = (expected_a_stake[i] * net) / total_a;
        assert_eq!(
            entry.amount, expected,
            "batch claim payout for user #{} must be proportional",
            i
        );
        // Even-indexed winners only ever staked on outcome A, so their balance
        // is the initial mint minus what they escrowed plus the payout.
        assert_eq!(
            token_client.balance(u),
            10_000 - expected_a_stake[i] + expected,
            "winner balance reflects escrowed stake plus payout"
        );
        total_paid += entry.amount;
    }

    let treasury = t.client.get_treasury_balance();
    assert_eq!(
        total_paid + treasury,
        total_pool,
        "payouts plus treasury must equal the total staked (conservation)"
    );
}

/// L4: Leaderboard returns entries sorted by total bet descending.
///
/// Five users bet different amounts on the same pool. `get_leaderboard`
/// must return them ordered by total_bet from highest to lowest.
#[test]
fn l4_leaderboard_ordered_by_total_bet_descending() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let users: alloc::vec::Vec<Address> = (0..5).map(|_| Address::generate(&t.env)).collect();
    let amounts = [1000i128, 500i128, 2000i128, 750i128, 1500i128];

    for (user, &amount) in users.iter().zip(amounts.iter()) {
        mint(&t.env, &t.token, user, amount);
        t.client
            .place_bet(user, &pool_id, &0u32, &amount, &None::<Address>);
    }

    let leaderboard = t.client.get_leaderboard(&pool_id, &50u32, &None::<Address>);

    assert_eq!(leaderboard.len(), 5, "all five users must appear");

    let expected_order = [2000i128, 1500i128, 1000i128, 750i128, 500i128];
    for i in 0..leaderboard.len() {
        assert_eq!(
            leaderboard.get(i).unwrap().total_bet,
            expected_order[i as usize],
            "entry #{} must have correct total_bet",
            i
        );
    }
}

/// L5: Leaderboard cursor pagination skips entries before the cursor.
///
/// After fetching the top 2 entries, pass the last user address as cursor
/// to get the remaining 3 entries.
#[test]
fn l5_leaderboard_cursor_pagination() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let users: alloc::vec::Vec<Address> = (0..5).map(|_| Address::generate(&t.env)).collect();
    let amounts = [1000i128, 500i128, 2000i128, 750i128, 1500i128];

    for (user, &amount) in users.iter().zip(amounts.iter()) {
        mint(&t.env, &t.token, user, amount);
        t.client
            .place_bet(user, &pool_id, &0u32, &amount, &None::<Address>);
    }

    // Fetch top 2.
    let page1 = t.client.get_leaderboard(&pool_id, &2u32, &None::<Address>);
    assert_eq!(page1.len(), 2, "page 1 must have 2 entries");
    assert_eq!(page1.get(0).unwrap().total_bet, 2000i128);
    assert_eq!(page1.get(1).unwrap().total_bet, 1500i128);

    // Fetch remaining with cursor = last user from page 1.
    let cursor = page1.get(1).unwrap().user.clone();
    let page2 = t.client.get_leaderboard(&pool_id, &50u32, &Some(cursor));
    assert_eq!(page2.len(), 3, "page 2 must have the remaining 3 entries");
    assert_eq!(page2.get(0).unwrap().total_bet, 1000i128);
    assert_eq!(page2.get(1).unwrap().total_bet, 750i128);
    assert_eq!(page2.get(2).unwrap().total_bet, 500i128);
}

/// L6: Leaderboard limit is capped at 50.
///
/// Even if a pool has many participants, requesting limit > 50 should
/// return at most 50 entries.
#[test]
fn l6_leaderboard_limit_capped_at_fifty() {
    let t = setup_multi_user();
    let pool_id = make_pool_mu(&t);

    let num_users = 60usize;
    let users: alloc::vec::Vec<Address> =
        (0..num_users).map(|_| Address::generate(&t.env)).collect();

    for user in &users {
        mint(&t.env, &t.token, user, 100);
        t.client
            .place_bet(user, &pool_id, &0u32, &100i128, &None::<Address>);
    }

    let leaderboard = t
        .client
        .get_leaderboard(&pool_id, &100u32, &None::<Address>);
    assert_eq!(
        leaderboard.len(),
        50,
        "leaderboard must be capped at 50 entries"
    );
}
