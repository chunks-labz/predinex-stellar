// ============================================================================
// Issue #182: Fuzz / property tests for uneven winner and loser distributions
//
// These tests generate diverse bet distributions across both outcomes and
// verify that payout totals and fee accounting are correct for every case.
// A deterministic pseudo-random generator is used so the suite is stable
// for CI and fully reproducible without an external fuzzing harness.
//
// Running mode:
//   cargo test --package predinex -- fuzz_tests   (single-pass, CI-safe)
//
// Each test either:
//   (a) iterates over a hand-crafted set of representative distributions, or
//   (b) uses a deterministic LCG to generate N random distributions and
//       verifies the invariants hold for every generated case.
// ============================================================================

#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

// ── Deterministic pseudo-random number generator ─────────────────────────────
//
// A simple 64-bit LCG (Knuth multiplicative) that is fully deterministic and
// requires no external crates. Sufficient for generating diverse distributions
// in a reproducible way.

struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg(seed)
    }

    /// Return the next pseudo-random u64.
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    /// Return a value in [1, max] (inclusive).
    fn next_in(&mut self, max: u64) -> u64 {
        (self.next() % max) + 1
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

struct FuzzEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: Address,
    _contract_id: Address,
}

fn setup_fuzz() -> FuzzEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin, &token_admin);

    FuzzEnv {
        env,
        client,
        token: token_id.address(),
        _contract_id: contract_id,
    }
}

fn mint_fuzz(env: &Env, token: &Address, user: &Address, amount: i128) {
    let admin = soroban_sdk::token::StellarAssetClient::new(env, token);
    admin.mint(user, &amount);
}

fn make_pool_fuzz(t: &FuzzEnv) -> (u32, Address) {
    let creator = Address::generate(&t.env);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Fuzz Pool"),
        &String::from_str(&t.env, "Property test pool"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    );
    (pool_id, creator)
}

fn expire_fuzz(env: &Env) {
    env.ledger().with_mut(|li| {
        li.timestamp = 7_200;
    });
}

// ── Invariant helpers ─────────────────────────────────────────────────────────

/// Verify the core payout invariant for a single winner in a two-outcome pool:
///
///   winnings = floor(user_winning_bet * net_pool / winning_side_total)
///   net_pool = total_pool - floor(total_pool * fee_bps / 10_000)
///
/// Returns the computed winnings so callers can cross-check against the
/// actual transfer.
fn expected_winnings(
    user_winning_bet: i128,
    winning_side_total: i128,
    total_pool: i128,
    fee_bps: i128,
) -> i128 {
    let fee = (total_pool * fee_bps) / 10_000;
    let net = total_pool - fee;
    (user_winning_bet * net) / winning_side_total
}

// ── Suite P — property / fuzz tests ──────────────────────────────────────────

/// P1: Payout formula holds for a hand-crafted set of uneven distributions.
///
/// Each entry is (total_a, total_b, winning_outcome). A single winner holds
/// the entire winning side so the payout must equal the full net pool.
#[test]
fn p1_payout_formula_holds_for_uneven_distributions() {
    // (total_a, total_b, winning_outcome)
    let cases: &[(i128, i128, u32)] = &[
        (1, 999, 0),    // tiny winning side
        (999, 1, 1),    // tiny losing side
        (500, 500, 0),  // equal sides, A wins
        (500, 500, 1),  // equal sides, B wins
        (1, 1, 0),      // minimal pool
        (10_000, 1, 0), // heavily skewed toward A
        (1, 10_000, 1), // heavily skewed toward B
        (333, 667, 0),  // non-round split, A wins
        (667, 333, 1),  // non-round split, B wins
        (100, 900, 0),  // 10/90 split, A wins
        (900, 100, 1),  // 90/10 split, B wins
    ];

    for &(total_a, total_b, winning_outcome) in cases {
        let t = setup_fuzz();
        let (pool_id, creator) = make_pool_fuzz(&t);

        let winner = Address::generate(&t.env);
        let loser = Address::generate(&t.env);

        mint_fuzz(&t.env, &t.token, &winner, total_a.max(total_b) + 1);
        mint_fuzz(&t.env, &t.token, &loser, total_a.max(total_b) + 1);

        if winning_outcome == 0 {
            t.client
                .place_bet(&winner, &pool_id, &0u32, &total_a, &None::<Address>);
            if total_b > 0 {
                t.client
                    .place_bet(&loser, &pool_id, &1u32, &total_b, &None::<Address>);
            }
        } else {
            if total_a > 0 {
                t.client
                    .place_bet(&loser, &pool_id, &0u32, &total_a, &None::<Address>);
            }
            t.client
                .place_bet(&winner, &pool_id, &1u32, &total_b, &None::<Address>);
        }

        expire_fuzz(&t.env);
        t.client.settle_pool(&creator, &pool_id, &winning_outcome);

        let total_pool = total_a + total_b;
        let winning_side_total = if winning_outcome == 0 {
            total_a
        } else {
            total_b
        };
        let expected = expected_winnings(winning_side_total, winning_side_total, total_pool, 200);

        let actual = t.client.claim_winnings(&winner, &pool_id);
        assert_eq!(
            actual, expected,
            "payout mismatch for case total_a={total_a} total_b={total_b} outcome={winning_outcome}"
        );
    }
}

/// P2: Fee accounting is correct for diverse pool sizes.
///
/// For each case the treasury must hold exactly floor(total_pool * 2 / 100)
/// after the sole winner claims.
#[test]
fn p2_fee_accounting_correct_for_diverse_pool_sizes() {
    let pool_sizes: &[(i128, i128)] = &[
        (100, 100),
        (1, 1),
        (999, 1),
        (1, 999),
        (50_000, 50_000),
        (123, 456),
        (789, 321),
        (1_000_000, 1),
        (1, 1_000_000),
    ];

    for &(total_a, total_b) in pool_sizes {
        let t = setup_fuzz();
        let (pool_id, creator) = make_pool_fuzz(&t);

        let winner = Address::generate(&t.env);
        let loser = Address::generate(&t.env);

        mint_fuzz(&t.env, &t.token, &winner, total_a + 1);
        mint_fuzz(&t.env, &t.token, &loser, total_b + 1);

        t.client
            .place_bet(&winner, &pool_id, &0u32, &total_a, &None::<Address>);
        t.client
            .place_bet(&loser, &pool_id, &1u32, &total_b, &None::<Address>);

        expire_fuzz(&t.env);
        t.client.settle_pool(&creator, &pool_id, &0u32);

        t.client.claim_winnings(&winner, &pool_id);

        let total_pool = total_a + total_b;
        let expected_fee = (total_pool * 200) / 10_000;

        let treasury = t.client.get_treasury_balance();
        // Treasury must hold at least the fee (dust may add a small amount)
        assert!(
            treasury >= expected_fee,
            "treasury must hold at least the fee for pool ({total_a}, {total_b})"
        );
        // And must not exceed fee + 1 (single-winner pool has at most 1 dust token)
        assert!(
            treasury <= expected_fee + 1,
            "treasury must not exceed fee + 1 dust for pool ({total_a}, {total_b})"
        );
    }
}

/// P3: Deterministic fuzz — 50 randomly generated single-winner distributions.
///
/// Uses a seeded LCG to generate (total_a, total_b) pairs and verifies the
/// payout formula and fee invariant for each.
#[test]
fn p3_deterministic_fuzz_single_winner_distributions() {
    let mut rng = Lcg::new(0xDEAD_BEEF_CAFE_1234);

    for iteration in 0..50u32 {
        let total_a = rng.next_in(100_000) as i128;
        let total_b = rng.next_in(100_000) as i128;
        let winning_outcome: u32 = (rng.next() % 2) as u32;

        let t = setup_fuzz();
        let (pool_id, creator) = make_pool_fuzz(&t);

        let winner = Address::generate(&t.env);
        let loser = Address::generate(&t.env);

        mint_fuzz(&t.env, &t.token, &winner, total_a.max(total_b) + 1);
        mint_fuzz(&t.env, &t.token, &loser, total_a.max(total_b) + 1);

        if winning_outcome == 0 {
            t.client
                .place_bet(&winner, &pool_id, &0u32, &total_a, &None::<Address>);
            t.client
                .place_bet(&loser, &pool_id, &1u32, &total_b, &None::<Address>);
        } else {
            t.client
                .place_bet(&loser, &pool_id, &0u32, &total_a, &None::<Address>);
            t.client
                .place_bet(&winner, &pool_id, &1u32, &total_b, &None::<Address>);
        }

        expire_fuzz(&t.env);
        t.client.settle_pool(&creator, &pool_id, &winning_outcome);

        let total_pool = total_a + total_b;
        let winning_side_total = if winning_outcome == 0 {
            total_a
        } else {
            total_b
        };
        let expected = expected_winnings(winning_side_total, winning_side_total, total_pool, 200);

        let actual = t.client.claim_winnings(&winner, &pool_id);
        assert_eq!(
            actual, expected,
            "fuzz iteration {iteration}: payout mismatch for total_a={total_a} total_b={total_b} outcome={winning_outcome}"
        );

        let expected_fee = (total_pool * 200) / 10_000;
        let treasury = t.client.get_treasury_balance();
        assert!(
            treasury >= expected_fee,
            "fuzz iteration {iteration}: treasury below fee for total_a={total_a} total_b={total_b}"
        );
        assert!(
            treasury <= expected_fee + 1,
            "fuzz iteration {iteration}: treasury exceeds fee+1 for total_a={total_a} total_b={total_b}"
        );
    }
}

/// P4: Deterministic fuzz — 30 multi-winner distributions.
///
/// Generates pools with 2–5 winners and 1–3 losers. Verifies that:
///   - Each winner's payout matches the formula.
///   - The sum of all payouts plus treasury equals the total pool.
///   - No loser can claim.
#[test]
fn p4_deterministic_fuzz_multi_winner_distributions() {
    let mut rng = Lcg::new(0x1234_5678_9ABC_DEF0);

    for iteration in 0..30u32 {
        let num_winners = (rng.next_in(4) + 1) as usize; // 2–5
        let num_losers = rng.next_in(3) as usize; // 1–3

        let t = setup_fuzz();
        let (pool_id, creator) = make_pool_fuzz(&t);

        let winners: alloc::vec::Vec<Address> = (0..num_winners)
            .map(|_| Address::generate(&t.env))
            .collect();
        let losers: alloc::vec::Vec<Address> =
            (0..num_losers).map(|_| Address::generate(&t.env)).collect();

        let winner_bets: alloc::vec::Vec<i128> = (0..num_winners)
            .map(|_| rng.next_in(10_000) as i128)
            .collect();
        let loser_bets: alloc::vec::Vec<i128> = (0..num_losers)
            .map(|_| rng.next_in(10_000) as i128)
            .collect();

        let total_a: i128 = winner_bets.iter().sum();
        let total_b: i128 = loser_bets.iter().sum();
        let total_pool = total_a + total_b;

        // Skip degenerate cases where a side is empty
        if total_b == 0 || total_a == 0 {
            continue;
        }

        for (w, &bet) in winners.iter().zip(winner_bets.iter()) {
            mint_fuzz(&t.env, &t.token, w, bet);
            t.client
                .place_bet(w, &pool_id, &0u32, &bet, &None::<Address>);
        }
        for (l, &bet) in losers.iter().zip(loser_bets.iter()) {
            mint_fuzz(&t.env, &t.token, l, bet);
            t.client
                .place_bet(l, &pool_id, &1u32, &bet, &None::<Address>);
        }

        expire_fuzz(&t.env);
        t.client.settle_pool(&creator, &pool_id, &0u32); // A wins

        let fee = (total_pool * 200) / 10_000;
        let net = total_pool - fee;

        let mut total_paid_out = 0i128;

        for (w, &bet) in winners.iter().zip(winner_bets.iter()) {
            let expected = (bet * net) / total_a;
            let actual = t.client.claim_winnings(w, &pool_id);
            assert_eq!(
                actual, expected,
                "fuzz iteration {iteration}: winner payout mismatch (bet={bet}, total_a={total_a}, net={net})"
            );
            total_paid_out += actual;
        }

        // Losers must not be able to claim
        for l in &losers {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                t.client.claim_winnings(l, &pool_id);
            }));
            assert!(
                result.is_err(),
                "fuzz iteration {iteration}: loser claim must panic"
            );
        }

        // Treasury + total_paid_out must equal total_pool
        let treasury = t.client.get_treasury_balance();
        assert_eq!(
            treasury + total_paid_out,
            total_pool,
            "fuzz iteration {iteration}: treasury + payouts must equal total pool"
        );
    }
}

/// P5: Seeded edge-case distribution — verify expected payout math is reproduced.
///
/// This test pins a specific deterministic distribution and hard-codes the
/// expected outputs so regressions are immediately visible.
///
/// Distribution:
///   - 3 winners on outcome A: 100, 200, 700 tokens
///   - 2 losers on outcome B:  400, 600 tokens
///   - total_a = 1000, total_b = 1000, total = 2000
///   - fee (2%) = 40, net = 1960
///   - winner payouts: 100*1960/1000=196, 200*1960/1000=392, 700*1960/1000=1372
#[test]
fn p5_seeded_edge_case_distribution_reproduces_expected_math() {
    let t = setup_fuzz();
    let (pool_id, creator) = make_pool_fuzz(&t);

    let winner1 = Address::generate(&t.env);
    let winner2 = Address::generate(&t.env);
    let winner3 = Address::generate(&t.env);
    let loser1 = Address::generate(&t.env);
    let loser2 = Address::generate(&t.env);

    mint_fuzz(&t.env, &t.token, &winner1, 100);
    mint_fuzz(&t.env, &t.token, &winner2, 200);
    mint_fuzz(&t.env, &t.token, &winner3, 700);
    mint_fuzz(&t.env, &t.token, &loser1, 400);
    mint_fuzz(&t.env, &t.token, &loser2, 600);

    t.client
        .place_bet(&winner1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&winner2, &pool_id, &0u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&winner3, &pool_id, &0u32, &700i128, &None::<Address>);
    t.client
        .place_bet(&loser1, &pool_id, &1u32, &400i128, &None::<Address>);
    t.client
        .place_bet(&loser2, &pool_id, &1u32, &600i128, &None::<Address>);

    expire_fuzz(&t.env);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Hard-coded expected values
    assert_eq!(t.client.claim_winnings(&winner1, &pool_id), 196);
    assert_eq!(t.client.claim_winnings(&winner2, &pool_id), 392);
    assert_eq!(t.client.claim_winnings(&winner3, &pool_id), 1372);

    // Treasury must hold fee (40) plus any rounding dust
    let treasury = t.client.get_treasury_balance();
    assert!(treasury >= 40, "treasury must hold at least the 2% fee");
    assert!(treasury <= 42, "treasury must not exceed fee + dust");
}

/// P6: Payout invariant holds when only one token is on the losing side.
///
/// Extreme skew: 1 token on the losing side, large amount on the winning side.
/// The winner should receive nearly the entire pool minus the fee.
#[test]
fn p6_payout_invariant_holds_with_minimal_losing_side() {
    let t = setup_fuzz();
    let (pool_id, creator) = make_pool_fuzz(&t);

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    let total_a = 9_999i128;
    let total_b = 1i128;

    mint_fuzz(&t.env, &t.token, &winner, total_a);
    mint_fuzz(&t.env, &t.token, &loser, total_b);

    t.client
        .place_bet(&winner, &pool_id, &0u32, &total_a, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &total_b, &None::<Address>);

    expire_fuzz(&t.env);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let total_pool = total_a + total_b; // 10_000
    let fee = (total_pool * 200) / 10_000; // 200
    let net = total_pool - fee; // 9_800
    let expected = (total_a * net) / total_a; // 9_800

    let actual = t.client.claim_winnings(&winner, &pool_id);
    assert_eq!(
        actual, expected,
        "payout must equal net pool for sole winner"
    );
}

/// P7: Payout invariant holds when only one token is on the winning side.
///
/// Extreme skew: 1 token on the winning side, large amount on the losing side.
/// The sole winner should receive the entire net pool.
#[test]
fn p7_payout_invariant_holds_with_minimal_winning_side() {
    let t = setup_fuzz();
    let (pool_id, creator) = make_pool_fuzz(&t);

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    let total_a = 1i128;
    let total_b = 9_999i128;

    mint_fuzz(&t.env, &t.token, &winner, total_a);
    mint_fuzz(&t.env, &t.token, &loser, total_b);

    t.client
        .place_bet(&winner, &pool_id, &0u32, &total_a, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &total_b, &None::<Address>);

    expire_fuzz(&t.env);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let total_pool = total_a + total_b; // 10_000
    let fee = (total_pool * 200) / 10_000; // 200
    let net = total_pool - fee; // 9_800
    let expected = (total_a * net) / total_a; // 9_800

    let actual = t.client.claim_winnings(&winner, &pool_id);
    assert_eq!(
        actual, expected,
        "sole winner must receive the full net pool"
    );
}

/// P8: Fee is zero when protocol fee is set to 0 bps.
///
/// With a 0% fee the winner receives the entire pool and the treasury stays at 0.
#[test]
fn p8_zero_fee_winner_receives_entire_pool() {
    let t = setup_fuzz();
    let (pool_id, creator) = make_pool_fuzz(&t);

    // Set fee to 0 — treasury_recipient is the token_admin used in setup_fuzz
    let config = t.client.get_config();
    t.client.set_protocol_fee(&config.treasury_recipient, &0u32);

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    mint_fuzz(&t.env, &t.token, &winner, 500);
    mint_fuzz(&t.env, &t.token, &loser, 500);

    t.client
        .place_bet(&winner, &pool_id, &0u32, &500i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &500i128, &None::<Address>);

    expire_fuzz(&t.env);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let actual = t.client.claim_winnings(&winner, &pool_id);
    assert_eq!(
        actual, 1000i128,
        "with 0% fee winner must receive entire pool"
    );
    assert_eq!(
        t.client.get_treasury_balance(),
        0i128,
        "treasury must be 0 with 0% fee"
    );
}

/// P9: Fee is capped at 10% (1000 bps) and payout formula still holds.
#[test]
fn p9_max_fee_payout_formula_holds() {
    let t = setup_fuzz();
    let (pool_id, creator) = make_pool_fuzz(&t);

    let config = t.client.get_config();
    t.client
        .set_protocol_fee(&config.treasury_recipient, &1000u32); // 10%

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);

    mint_fuzz(&t.env, &t.token, &winner, 600);
    mint_fuzz(&t.env, &t.token, &loser, 400);

    t.client
        .place_bet(&winner, &pool_id, &0u32, &600i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &400i128, &None::<Address>);

    expire_fuzz(&t.env);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let total_pool = 1000i128;
    let fee = (total_pool * 1000) / 10_000; // 100
    let net = total_pool - fee; // 900
    let expected = (600i128 * net) / 600i128; // 900

    let actual = t.client.claim_winnings(&winner, &pool_id);
    assert_eq!(actual, expected, "payout must use the configured 10% fee");

    let treasury = t.client.get_treasury_balance();
    assert!(treasury >= fee, "treasury must hold at least the 10% fee");
}

/// P10: Sum of all winner payouts plus treasury equals total pool for a
///      randomly generated multi-winner, multi-loser distribution.
///
/// This is the core conservation invariant: no tokens are created or destroyed.
#[test]
fn p10_conservation_invariant_holds_for_random_distribution() {
    let mut rng = Lcg::new(0xFEED_FACE_DEAD_BEEF);

    for iteration in 0..20u32 {
        let num_winners = (rng.next_in(5) + 1) as usize; // 2–6
        let num_losers = (rng.next_in(4) + 1) as usize; // 2–5

        let t = setup_fuzz();
        let (pool_id, creator) = make_pool_fuzz(&t);

        let winners: alloc::vec::Vec<Address> = (0..num_winners)
            .map(|_| Address::generate(&t.env))
            .collect();
        let losers: alloc::vec::Vec<Address> =
            (0..num_losers).map(|_| Address::generate(&t.env)).collect();

        let winner_bets: alloc::vec::Vec<i128> = (0..num_winners)
            .map(|_| rng.next_in(5_000) as i128)
            .collect();
        let loser_bets: alloc::vec::Vec<i128> = (0..num_losers)
            .map(|_| rng.next_in(5_000) as i128)
            .collect();

        let total_a: i128 = winner_bets.iter().sum();
        let total_b: i128 = loser_bets.iter().sum();

        if total_a == 0 || total_b == 0 {
            continue;
        }

        for (w, &bet) in winners.iter().zip(winner_bets.iter()) {
            mint_fuzz(&t.env, &t.token, w, bet);
            t.client
                .place_bet(w, &pool_id, &0u32, &bet, &None::<Address>);
        }
        for (l, &bet) in losers.iter().zip(loser_bets.iter()) {
            mint_fuzz(&t.env, &t.token, l, bet);
            t.client
                .place_bet(l, &pool_id, &1u32, &bet, &None::<Address>);
        }

        expire_fuzz(&t.env);
        t.client.settle_pool(&creator, &pool_id, &0u32);

        let total_pool = total_a + total_b;
        let mut total_paid_out = 0i128;

        for w in &winners {
            let payout = t.client.claim_winnings(w, &pool_id);
            total_paid_out += payout;
        }

        let treasury = t.client.get_treasury_balance();

        assert_eq!(
            treasury + total_paid_out,
            total_pool,
            "conservation invariant violated at iteration {iteration}: \
             treasury({treasury}) + paid_out({total_paid_out}) != total_pool({total_pool})"
        );
    }
}
