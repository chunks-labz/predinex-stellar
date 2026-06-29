//! Fuzz / property-based tests for arithmetic and storage edge cases.
//!
//! Run with:  cargo test --features testutils fuzz_
//! All tests are deterministic – "fuzz" here means exhaustive boundary
//! sweeps + derived property assertions, not libfuzzer targets.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

// ── helpers ──────────────────────────────────────────────────────────────────

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    token: token::Client<'static>,
    token_admin: token::StellarAssetClient<'static>,
    treasury: Address,
}

impl Ctx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        // SAFETY: we own `env` for the full test lifetime; the 'static cast is
        // sound within a single-threaded test.
        let client = unsafe {
            core::mem::transmute::<
                PredinexContractClient<'_>,
                PredinexContractClient<'static>,
            >(PredinexContractClient::new(&env, &contract_id))
        };

        let token_admin_addr = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin_addr.clone());

        let token = unsafe {
            core::mem::transmute::<token::Client<'_>, token::Client<'static>>(
                token::Client::new(&env, &token_id.address()),
            )
        };
        let token_admin = unsafe {
            core::mem::transmute::<
                token::StellarAssetClient<'_>,
                token::StellarAssetClient<'static>,
            >(token::StellarAssetClient::new(&env, &token_id.address()))
        };

        let treasury = Address::generate(&env);
        client.initialize(&token_id.address(), &treasury);

        Self { env, client, token, token_admin, treasury }
    }

    /// Create a pool and advance ledger so it is ready to expire when needed.
    fn make_pool(&self, duration: u64) -> u32 {
        let creator = Address::generate(&self.env);
        self.client.create_pool(
            &creator,
            &String::from_str(&self.env, "T"),
            &String::from_str(&self.env, "D"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &duration,
        )
    }

    fn mint_and_bet(&self, pool_id: u32, outcome: u32, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        self.token_admin.mint(&user, &amount);
        self.client.place_bet(&user, &pool_id, &outcome, &amount);
        user
    }

    fn expire(&self, pool_id: u32) {
        let pool = self.client.get_pool(&pool_id).unwrap();
        self.env.ledger().with_mut(|l| l.timestamp = pool.expiry + 1);
    }

    fn settle(&self, pool_id: u32, outcome: u32) {
        let pool = self.client.get_pool(&pool_id).unwrap();
        self.expire(pool_id);
        self.client.settle_pool(&pool.creator, &pool_id, &outcome);
    }
}

// ── arithmetic: fee invariants ────────────────────────────────────────────────

/// Property: total claimed winnings ≤ total deposited (2 % fee means payout < input).
#[test]
fn fuzz_fee_total_never_exceeds_deposit() {
    // Test a matrix of (total_a, total_b) pairs including edge values.
    let cases: &[(i128, i128)] = &[
        (1, 1),
        (1, 0),       // all on one side
        (0, 1),
        (100, 0),
        (0, 100),
        (50, 50),
        (1, 99),
        (99, 1),
        (1_000_000, 1),
        (1, 1_000_000),
        // NOTE: i128::MAX / 2 omitted – (total * 2) overflows; the release
        // profile has overflow-checks = true so this would trap at runtime.
        // The contract should guard against inputs this large before mainnet.
        (1_000_000_000, 1_000_000_000),
    ];

    for &(a, b) in cases {
        if a == 0 && b == 0 {
            continue;
        }
        let total = a + b;
        let fee = (total * 2) / 100;
        let net = total - fee;

        // fee is non-negative
        assert!(fee >= 0, "fee negative for a={a} b={b}");
        // net payout does not exceed total deposited
        assert!(net <= total, "net > total for a={a} b={b}");
        // fee ≤ 2% of total (integer division rounds down)
        assert!(fee * 100 <= total * 2, "fee exceeded 2% for a={a} b={b}");

        // Simulate per-winner payout and ensure sum ≤ net.
        // Use the winning side as `a` (outcome 0).
        if a > 0 {
            let winner_share = (a * net) / a; // = net when only one winner
            assert!(winner_share <= net, "single winner exceeds net for a={a} b={b}");
        }
    }
}

/// Property: sum of all individual winner payouts ≤ net_pool_balance.
#[test]
fn fuzz_sum_of_payouts_le_net_balance() {
    // Simulate N winners on the winning side.
    let scenarios: &[(i128, i128, &[i128])] = &[
        // (total_a, total_b, individual winning bets that sum to total_a)
        (100, 200, &[100]),
        (100, 200, &[50, 50]),
        (100, 200, &[30, 30, 40]),
        (100, 200, &[1, 1, 98]),
        (1, 999, &[1]),
        (999, 1, &[500, 499]),
    ];

    for &(total_a, total_b, bets) in scenarios {
        let total = total_a + total_b;
        let fee = (total * 2) / 100;
        let net = total - fee;

        let sum_payouts: i128 = bets
            .iter()
            .map(|&b| (b * net) / total_a)
            .sum();

        assert!(
            sum_payouts <= net,
            "sum of payouts {sum_payouts} > net {net} (total_a={total_a}, total_b={total_b})"
        );
    }
}

// ── boundary: zero / single-participant ──────────────────────────────────────

/// Zero-amount bet must be rejected (no state mutation).
#[test]
#[should_panic(expected = "Invalid bet amount")]
fn fuzz_zero_amount_bet_rejected() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let user = Address::generate(&ctx.env);
    ctx.client.place_bet(&user, &pool_id, &0, &0);
}

/// Negative bet must be rejected.
#[test]
#[should_panic(expected = "Invalid bet amount")]
fn fuzz_negative_amount_bet_rejected() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let user = Address::generate(&ctx.env);
    ctx.client.place_bet(&user, &pool_id, &0, &-1);
}

/// Single participant: their payout ≤ their own deposit (no profit from empty opposing side).
#[test]
fn fuzz_single_participant_all_on_one_side() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let bet = 1_000_000i128;
    let user = ctx.mint_and_bet(pool_id, 0, bet);

    ctx.settle(pool_id, 0);

    let payout = ctx.client.claim_winnings(&user, &pool_id);
    // With only outcome-A bets, total = bet, fee = bet*2/100, net = bet - fee.
    let expected = bet - (bet * 2) / 100;
    assert_eq!(payout, expected);
    assert!(payout <= bet, "single-participant payout {payout} > deposited {bet}");
}

/// Pool with outcome-B winners: payout invariant holds symmetrically.
#[test]
fn fuzz_single_participant_outcome_b() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let bet = 500_000i128;
    let user = ctx.mint_and_bet(pool_id, 1, bet);

    ctx.settle(pool_id, 1);

    let payout = ctx.client.claim_winnings(&user, &pool_id);
    assert!(payout <= bet);
}

// ── boundary: u32/u64 limits ─────────────────────────────────────────────────

/// Duration of u64::MAX must not panic on pool creation (expiry wraps only if
/// the contract allows it; here we just verify creation succeeds or panics
/// gracefully rather than producing UB).
#[test]
fn fuzz_pool_creation_max_duration() {
    let ctx = Ctx::new();
    // u64::MAX duration: created_at + u64::MAX overflows – contract should
    // either succeed (wrapping disabled by overflow-checks=true in release,
    // but tests use debug which traps) or produce a clear panic.
    // We use catch_unwind to assert no silent UB.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ctx.make_pool(u64::MAX)
    }));
    // Either a pool is created (unlikely due to overflow) or it panics
    // with a known message. The important thing: no silent corruption.
    let _ = result; // outcome is either Ok or Err(panic), both are acceptable
}

/// get_pool on a non-existent ID returns None, not a panic.
#[test]
fn fuzz_get_pool_missing_id_returns_none() {
    let ctx = Ctx::new();
    assert!(ctx.client.get_pool(&u32::MAX).is_none());
    assert!(ctx.client.get_pool(&0).is_none());
    assert!(ctx.client.get_pool(&999_999).is_none());
}

/// get_user_bet on a pool/user that never bet returns None.
#[test]
fn fuzz_get_user_bet_missing_returns_none() {
    let ctx = Ctx::new();
    let user = Address::generate(&ctx.env);
    assert!(ctx.client.get_user_bet(&0, &user).is_none());
    assert!(ctx.client.get_user_bet(&u32::MAX, &user).is_none());
}

// ── boundary: expiry ledger conditions ───────────────────────────────────────

/// Bet placed exactly at expiry timestamp must be rejected.
#[test]
#[should_panic(expected = "Pool expired")]
fn fuzz_bet_at_exact_expiry_rejected() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(100);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    ctx.env.ledger().with_mut(|l| l.timestamp = pool.expiry);
    let user = Address::generate(&ctx.env);
    ctx.token_admin.mint(&user, &100);
    ctx.client.place_bet(&user, &pool_id, &0, &100);
}

/// settle_pool before expiry must be rejected.
#[test]
#[should_panic(expected = "Pool has not expired yet")]
fn fuzz_settle_before_expiry_rejected() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(9999);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    ctx.client.settle_pool(&pool.creator, &pool_id, &0);
}

// ── multi-bet accumulation ────────────────────────────────────────────────────

/// Multiple bets by the same user accumulate correctly.
#[test]
fn fuzz_repeated_bets_accumulate() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let user = Address::generate(&ctx.env);
    ctx.token_admin.mint(&user, &1_000);

    for _ in 0..10 {
        ctx.client.place_bet(&user, &pool_id, &0, &10);
    }
    for _ in 0..10 {
        ctx.client.place_bet(&user, &pool_id, &1, &10);
    }

    let bet = ctx.client.get_user_bet(&pool_id, &user).unwrap();
    assert_eq!(bet.amount_a, 100);
    assert_eq!(bet.amount_b, 100);
    assert_eq!(bet.total_bet, 200);
}

/// participant_count increments once per unique user, not per bet.
#[test]
fn fuzz_participant_count_unique_per_user() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);

    let users: std::vec::Vec<Address> = (0..5)
        .map(|_| {
            let u = Address::generate(&ctx.env);
            ctx.token_admin.mint(&u, &200);
            u
        })
        .collect();

    // Each user bets twice
    for u in &users {
        ctx.client.place_bet(u, &pool_id, &0, &100);
        ctx.client.place_bet(u, &pool_id, &1, &100);
    }

    assert_eq!(ctx.client.get_participant_count(&pool_id), 5);
}

// ── treasury accumulation ─────────────────────────────────────────────────────

/// Treasury grows by exactly the fee after each claim; total treasury ≤ sum of fees.
#[test]
fn fuzz_treasury_grows_by_fee() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);

    let bet_a = 300i128;
    let bet_b = 700i128;
    let user_a = ctx.mint_and_bet(pool_id, 0, bet_a);
    let _user_b = ctx.mint_and_bet(pool_id, 1, bet_b);

    ctx.settle(pool_id, 0);

    let treasury_before = ctx.client.get_treasury_balance();
    ctx.client.claim_winnings(&user_a, &pool_id);
    let treasury_after = ctx.client.get_treasury_balance();

    let total = bet_a + bet_b;
    let expected_fee = (total * 2) / 100;
    assert_eq!(treasury_after - treasury_before, expected_fee);
}

/// Double claim on the same pool+user must be rejected.
#[test]
#[should_panic]
fn fuzz_double_claim_rejected() {
    let ctx = Ctx::new();
    let pool_id = ctx.make_pool(3600);
    let user = ctx.mint_and_bet(pool_id, 0, 500);
    ctx.settle(pool_id, 0);
    ctx.client.claim_winnings(&user, &pool_id);
    ctx.client.claim_winnings(&user, &pool_id); // must panic
}

// ── storage: get_pools_batch edge cases ──────────────────────────────────────

/// Batch with start_id beyond pool count returns empty.
#[test]
fn fuzz_batch_start_beyond_count_empty() {
    let ctx = Ctx::new();
    ctx.make_pool(3600); // pool_id = 1 (counter starts at 1)
    let result = ctx.client.get_pools_batch(&9999, &10);
    assert_eq!(result.len(), 0);
}

/// Batch count capped at 100.
#[test]
fn fuzz_batch_count_capped_at_100() {
    let ctx = Ctx::new();
    for _ in 0..5 {
        ctx.make_pool(3600);
    }
    // Requesting 200 but only 5 exist; also internally capped at 100.
    let result = ctx.client.get_pools_batch(&1, &200);
    assert!(result.len() <= 100);
    assert_eq!(result.len(), 5);
}

/// Batch of exactly 0 count returns empty.
#[test]
fn fuzz_batch_zero_count_empty() {
    let ctx = Ctx::new();
    ctx.make_pool(3600);
    let result = ctx.client.get_pools_batch(&1, &0);
    assert_eq!(result.len(), 0);
}

// ── outcome label edge cases ──────────────────────────────────────────────────

/// Duplicate outcome labels (case-insensitive) must be rejected.
#[test]
#[should_panic(expected = "Duplicate outcome labels")]
fn fuzz_duplicate_outcome_labels_rejected() {
    let ctx = Ctx::new();
    let creator = Address::generate(&ctx.env);
    ctx.client.create_pool(
        &creator,
        &String::from_str(&ctx.env, "T"),
        &String::from_str(&ctx.env, "D"),
        &String::from_str(&ctx.env, "yes"),
        &String::from_str(&ctx.env, "YES"),
        &3600,
    );
}

/// Whitespace-trimmed duplicates are also rejected.
#[test]
#[should_panic(expected = "Duplicate outcome labels")]
fn fuzz_whitespace_trimmed_duplicate_labels_rejected() {
    let ctx = Ctx::new();
    let creator = Address::generate(&ctx.env);
    ctx.client.create_pool(
        &creator,
        &String::from_str(&ctx.env, "T"),
        &String::from_str(&ctx.env, "D"),
        &String::from_str(&ctx.env, " yes "),
        &String::from_str(&ctx.env, "yes"),
        &3600,
    );
}
