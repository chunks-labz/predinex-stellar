//! Integration tests — multi-user betting and settlement (issue #577).
//!
//! Covers:
//! * 3+ users, 2+ outcomes, full lifecycle (create → bet → settle → claim)
//! * Proportional payout correctness and conservation invariant
//! * Dispute and freeze lifecycle: settle → dispute → unfreeze → re-bet → re-settle → claim
//! * Protocol fee accumulation across multiple pools with treasury withdrawal
//! * Concurrent pool operations: create and settle several pools in a single test
//!
//! These tests exercise the full contract ABI end-to-end via
//! `PredinexContractClient` and do NOT reach into internal helpers.

extern crate std;

use predinex::{
    ClaimStatus, Pool, PoolStatus, PredinexContract, PredinexContractClient, MIN_CREATOR_DEPOSIT,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

struct Ctx<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
    /// Treasury recipient (= contract admin for fee-related calls).
    treasury: Address,
    /// The deployed contract address (used as escrow balance check target).
    contract_addr: Address,
}

fn setup() -> Ctx<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let token_asset = env.register_stellar_asset_contract_v2(treasury.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_asset.address(), &treasury, &treasury);

    let token: token::Client<'static> = token::Client::new(&env, &token_asset.address());
    let token_admin: token::StellarAssetClient<'static> =
        token::StellarAssetClient::new(&env, &token_asset.address());

    let contract_addr = contract_id;

    Ctx {
        env,
        client,
        token,
        token_admin,
        treasury,
        contract_addr,
    }
}

/// Create a standard two-outcome pool with a 1-hour duration.
fn make_pool(ctx: &Ctx, creator: &Address) -> u32 {
    ctx.client.create_pool(
        creator,
        &String::from_str(&ctx.env, "Binary Market"),
        &String::from_str(&ctx.env, "A two-outcome prediction pool"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    )
}

/// Mint `amount` base-token units to `addr`.
fn mint(ctx: &Ctx, addr: &Address, amount: i128) {
    ctx.token_admin.mint(addr, &amount);
}

/// Advance ledger past the 1-hour pool expiry.
fn expire(ctx: &Ctx) {
    ctx.env.ledger().with_mut(|l| l.timestamp = 3_700);
}

// ---------------------------------------------------------------------------
// MU-1: Three users, two outcomes — full create → bet → settle → claim cycle
// ---------------------------------------------------------------------------

/// Three users bet on different outcomes.  After expiry the pool is settled
/// and every winner claims their proportional share of the net pool.
/// Losers receive nothing; the treasury accumulates the protocol fee.
#[test]
fn mu1_three_users_full_lifecycle() {
    let ctx = setup();

    let creator = Address::generate(&ctx.env);
    let user_a1 = Address::generate(&ctx.env); // outcome 0 (wins)
    let user_a2 = Address::generate(&ctx.env); // outcome 0 (wins)
    let user_b = Address::generate(&ctx.env); // outcome 1 (loses)

    mint(&ctx, &user_a1, 300);
    mint(&ctx, &user_a2, 100);
    mint(&ctx, &user_b, 200);

    let pool_id = make_pool(&ctx, &creator);

    ctx.client
        .place_bet(&user_a1, &pool_id, &0, &300, &None::<Address>);
    ctx.client
        .place_bet(&user_a2, &pool_id, &0, &100, &None::<Address>);
    ctx.client
        .place_bet(&user_b, &pool_id, &1, &200, &None::<Address>);

    // Verify mid-flight pool state.
    let pool: Pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 400, "total_a must equal 300 + 100");
    assert_eq!(pool.total_b, 200, "total_b must equal 200");
    assert_eq!(pool.participant_count, 3, "three distinct participants");
    assert!(!pool.settled, "pool must not be settled yet");

    // Expire and settle — outcome 0 wins.
    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    let pool_after: Pool = ctx
        .client
        .get_pool(&pool_id)
        .expect("pool must exist after settle");
    assert!(pool_after.settled, "pool must be marked settled");
    assert_eq!(pool_after.winning_outcome, Some(0));

    // Payout math:
    // total_pool = 600, fee 2% = 12, net = 588, total_a = 400
    // user_a1: 300 * 588 / 400 = 441
    // user_a2: 100 * 588 / 400 = 147
    let w1 = ctx.client.claim_winnings(&user_a1, &pool_id);
    let w2 = ctx.client.claim_winnings(&user_a2, &pool_id);

    assert_eq!(w1, 441, "user_a1 payout must be 441");
    assert_eq!(w2, 147, "user_a2 payout must be 147");
    assert_eq!(w1 + w2, 588, "combined winner payouts must equal net pool");

    // Token balances match transferred amounts.
    assert_eq!(ctx.token.balance(&user_a1), 441);
    assert_eq!(ctx.token.balance(&user_a2), 147);
    assert_eq!(ctx.token.balance(&user_b), 0, "loser must receive nothing");

    // Treasury holds the 2% fee (12 stroops) plus any rounding dust.
    let treasury_balance = ctx.client.get_treasury_balance();
    assert_eq!(
        treasury_balance, 12,
        "treasury must hold exactly the protocol fee"
    );

    // Claim statuses reflect reality.
    assert_eq!(
        ctx.client.get_claim_status(&pool_id, &user_a1),
        ClaimStatus::AlreadyClaimed,
    );
    assert_eq!(
        ctx.client.get_claim_status(&pool_id, &user_a2),
        ClaimStatus::AlreadyClaimed,
    );
    assert_eq!(
        ctx.client.get_claim_status(&pool_id, &user_b),
        ClaimStatus::NotEligible,
    );
}

// ---------------------------------------------------------------------------
// MU-2: Five users, asymmetric stakes — proportionality invariant
// ---------------------------------------------------------------------------

/// Five users with different stake sizes all on the winning side; one user on
/// the losing side.  Each winner's payout must be proportional to their
/// individual stake and the sum of all payouts plus the treasury must equal
/// the total staked amount (conservation invariant).
#[test]
fn mu2_five_winners_proportional_payout_conservation() {
    let ctx = setup();

    let creator = Address::generate(&ctx.env);
    // Stakes deliberately non-uniform to expose rounding edge cases.
    let stakes: &[(u32, i128)] = &[
        (0, 150), // winner
        (0, 275), // winner
        (0, 430), // winner
        (0, 95),  // winner
        (0, 50),  // winner
        (1, 300), // loser
    ];

    let mut users = std::vec![];
    let pool_id = make_pool(&ctx, &creator);

    for &(outcome, amount) in stakes {
        let user = Address::generate(&ctx.env);
        mint(&ctx, &user, amount);
        ctx.client
            .place_bet(&user, &pool_id, &outcome, &amount, &None::<Address>);
        users.push((user, outcome, amount));
    }

    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    let total_pool: i128 = stakes.iter().map(|(_, a)| *a).sum();
    let fee = total_pool * 200 / 10_000;
    let net = total_pool - fee;
    let total_a: i128 = stakes
        .iter()
        .filter(|(o, _)| *o == 0)
        .map(|(_, a)| *a)
        .sum();

    let mut total_paid = 0i128;
    for (user, outcome, stake) in &users {
        if *outcome == 0 {
            let payout = ctx.client.claim_winnings(user, &pool_id);
            let expected = (*stake * net) / total_a;
            assert_eq!(
                payout, expected,
                "payout for stake {} must be proportional (expected {})",
                stake, expected
            );
            total_paid += payout;
        }
    }

    let treasury = ctx.client.get_treasury_balance();
    assert_eq!(
        total_paid + treasury,
        total_pool,
        "conservation: payouts + treasury must equal total staked"
    );
    assert!(
        treasury >= fee,
        "treasury must hold at least the protocol fee"
    );
}

// ---------------------------------------------------------------------------
// MU-3: Dispute and freeze lifecycle
// ---------------------------------------------------------------------------

/// Full dispute lifecycle:
/// create → bet (3 users) → settle → freeze_admin disputes →
/// claim is blocked → freeze_admin unfreezes → pool re-opens →
/// users bet again → expire → re-settle → winners claim successfully.
#[test]
fn mu3_dispute_blocks_claims_unfreeze_re_settles() {
    let ctx = setup();

    // Register freeze admin (only treasury recipient can set it).
    let freeze_admin = Address::generate(&ctx.env);
    ctx.client.set_freeze_admin(&ctx.treasury, &freeze_admin);

    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    let user_c = Address::generate(&ctx.env);

    mint(&ctx, &user_a, 400);
    mint(&ctx, &user_b, 300);
    mint(&ctx, &user_c, 300);

    // Phase 1: initial pool lifecycle.
    let pool_id = ctx.client.create_pool(
        &creator,
        &String::from_str(&ctx.env, "Disputed Market"),
        &String::from_str(&ctx.env, "Tests dispute flow"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    );

    ctx.client
        .place_bet(&user_a, &pool_id, &0, &400, &None::<Address>); // Yes
    ctx.client
        .place_bet(&user_b, &pool_id, &1, &300, &None::<Address>); // No
    ctx.client
        .place_bet(&user_c, &pool_id, &1, &300, &None::<Address>); // No

    // Expire and settle — outcome 0 (Yes) declared winner.
    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    {
        let pool: Pool = ctx.client.get_pool(&pool_id).unwrap();
        assert!(matches!(pool.status, PoolStatus::Settled(0)));
    }

    // Phase 2: freeze admin disputes the settlement.
    ctx.client.dispute_pool(&freeze_admin, &pool_id);

    {
        let pool: Pool = ctx.client.get_pool(&pool_id).unwrap();
        assert_eq!(pool.status, PoolStatus::Disputed, "pool must be Disputed");
    }

    // Claim attempt is blocked while disputed.
    let claim_result = ctx.client.try_claim_winnings(&user_a, &pool_id);
    assert!(
        claim_result.is_err(),
        "claim must fail while pool is disputed"
    );

    // Phase 3: freeze admin unfreezes, which restores Open status so the pool
    // can receive more bets and be re-settled.
    ctx.client.unfreeze_pool(&freeze_admin, &pool_id);

    {
        let pool: Pool = ctx.client.get_pool(&pool_id).unwrap();
        assert_eq!(
            pool.status,
            PoolStatus::Open,
            "pool must be Open after unfreeze"
        );
    }

    // Phase 4: additional user places a bet while pool is back open.
    // We must advance time back before expiry for new bets to land.
    // Reset timestamp to within the original betting window.
    ctx.env.ledger().with_mut(|l| l.timestamp = 100);
    let user_d = Address::generate(&ctx.env);
    mint(&ctx, &user_d, 200);
    ctx.client
        .place_bet(&user_d, &pool_id, &0, &200, &None::<Address>);

    // Phase 5: expire again and re-settle (outcome 0 wins again).
    ctx.env.ledger().with_mut(|l| l.timestamp = 3_700);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    // Phase 6: all outcome-0 winners claim successfully.
    let w_a = ctx.client.claim_winnings(&user_a, &pool_id);
    let w_d = ctx.client.claim_winnings(&user_d, &pool_id);

    assert!(w_a > 0, "user_a must receive a positive payout");
    assert!(w_d > 0, "user_d must receive a positive payout");

    // Outcome-1 users get nothing.
    assert!(
        ctx.client.try_claim_winnings(&user_b, &pool_id).is_err(),
        "user_b must not be able to claim"
    );
    assert!(
        ctx.client.try_claim_winnings(&user_c, &pool_id).is_err(),
        "user_c must not be able to claim"
    );
}

// ---------------------------------------------------------------------------
// MU-4: Protocol fee accumulation across multiple pools + treasury withdrawal
// ---------------------------------------------------------------------------

/// Create three separate pools, run each through a full bet→settle→claim
/// cycle, then verify the treasury balance equals the sum of all three pools'
/// fees and that the treasury recipient can withdraw the full balance.
#[test]
fn mu4_fee_accumulation_multiple_pools_treasury_withdrawal() {
    let ctx = setup();

    let creator = Address::generate(&ctx.env);

    // Three pools with different sizes.
    let pool_configs: &[(i128, i128)] = &[
        (1_000, 500),   // pool 1: total 1500
        (2_000, 3_000), // pool 2: total 5000
        (750, 250),     // pool 3: total 1000
    ];

    let mut pool_ids = std::vec![];
    let mut winner_users = std::vec![];
    let mut loser_users = std::vec![];
    let mut expected_fee_total = 0i128;

    for &(stake_a, stake_b) in pool_configs {
        let pool_id = make_pool(&ctx, &creator);
        pool_ids.push(pool_id);

        let winner = Address::generate(&ctx.env);
        let loser = Address::generate(&ctx.env);
        mint(&ctx, &winner, stake_a);
        mint(&ctx, &loser, stake_b);

        ctx.client
            .place_bet(&winner, &pool_id, &0, &stake_a, &None::<Address>);
        ctx.client
            .place_bet(&loser, &pool_id, &1, &stake_b, &None::<Address>);

        let pool_total = stake_a + stake_b;
        expected_fee_total += pool_total * 200 / 10_000;

        winner_users.push(winner);
        loser_users.push(loser);
    }

    // Expire all pools simultaneously.
    expire(&ctx);

    // Settle and have each winner claim.
    for (i, &pool_id) in pool_ids.iter().enumerate() {
        ctx.client.settle_pool(&creator, &pool_id, &0);
        ctx.client.claim_winnings(&winner_users[i], &pool_id);
    }

    // Treasury must hold the sum of all three pools' protocol fees.
    let treasury_balance = ctx.client.get_treasury_balance();
    assert_eq!(
        treasury_balance, expected_fee_total,
        "treasury must equal sum of all protocol fees: expected {}, got {}",
        expected_fee_total, treasury_balance
    );

    // Treasury recipient withdraws the full accumulated balance.
    let treasury_token_before = ctx.token.balance(&ctx.treasury);
    ctx.client
        .withdraw_treasury(&ctx.treasury, &treasury_balance);
    let treasury_token_after = ctx.token.balance(&ctx.treasury);

    assert_eq!(
        treasury_token_after - treasury_token_before,
        treasury_balance,
        "treasury recipient must receive the withdrawn amount"
    );
    assert_eq!(
        ctx.client.get_treasury_balance(),
        0,
        "on-chain treasury balance must be zero after full withdrawal"
    );
}

// ---------------------------------------------------------------------------
// MU-5: Concurrent pool operations
// ---------------------------------------------------------------------------

/// Create five pools concurrently (within the same block/ledger sequence),
/// all share the same creator and the same expiry window.  After a single
/// ledger advance they are batch-settled and all winners claim.  Pools must
/// be completely independent — a user's bet in pool N must not affect pool M.
#[test]
fn mu5_concurrent_pools_state_isolated() {
    let ctx = setup();

    let creator = Address::generate(&ctx.env);
    let num_pools = 5usize;

    // For each pool: one winner (outcome 0) and one loser (outcome 1).
    let mut pool_ids = std::vec![];
    let mut winners = std::vec![];
    let mut losers = std::vec![];

    let stake = 200i128;

    for _ in 0..num_pools {
        let pool_id = make_pool(&ctx, &creator);
        let winner = Address::generate(&ctx.env);
        let loser = Address::generate(&ctx.env);

        mint(&ctx, &winner, stake);
        mint(&ctx, &loser, stake);

        ctx.client
            .place_bet(&winner, &pool_id, &0, &stake, &None::<Address>);
        ctx.client
            .place_bet(&loser, &pool_id, &1, &stake, &None::<Address>);

        pool_ids.push(pool_id);
        winners.push(winner);
        losers.push(loser);
    }

    // Verify isolation: each pool has independent totals.
    for &pool_id in &pool_ids {
        let pool: Pool = ctx.client.get_pool(&pool_id).expect("pool must exist");
        assert_eq!(
            pool.total_a, stake,
            "each pool total_a must be exactly one stake"
        );
        assert_eq!(
            pool.total_b, stake,
            "each pool total_b must be exactly one stake"
        );
        assert_eq!(
            pool.participant_count, 2,
            "each pool must have exactly 2 participants"
        );
    }

    // Expire and settle all pools.
    expire(&ctx);

    // net per pool = 400 - 2% = 392; sole winner gets all 392.
    let expected_payout = 400 - (400 * 200 / 10_000); // 392

    for (i, &pool_id) in pool_ids.iter().enumerate() {
        ctx.client.settle_pool(&creator, &pool_id, &0);

        let w = ctx.client.claim_winnings(&winners[i], &pool_id);
        assert_eq!(
            w, expected_payout,
            "winner in pool {} must receive {} (got {})",
            pool_id, expected_payout, w
        );
        assert_eq!(
            ctx.token.balance(&winners[i]),
            expected_payout,
            "winner token balance must equal payout"
        );

        // Loser cannot claim.
        assert!(
            ctx.client.try_claim_winnings(&losers[i], &pool_id).is_err(),
            "loser in pool {} must not be able to claim",
            pool_id
        );
    }

    // Treasury must hold 2% × 400 × num_pools = 8 × 5 = 40.
    assert_eq!(
        ctx.client.get_treasury_balance(),
        8 * num_pools as i128,
        "treasury must hold the sum of all five pools' fees"
    );
}

// ---------------------------------------------------------------------------
// MU-6: Freeze blocks bets; betting resumes after unfreeze
// ---------------------------------------------------------------------------

/// A pool is frozen by the freeze admin mid-way through the betting window.
/// New bets are rejected while frozen.  Once unfrozen betting resumes normally
/// and the full lifecycle completes.
#[test]
fn mu6_freeze_blocks_bets_unfreeze_resumes_betting() {
    let ctx = setup();

    let freeze_admin = Address::generate(&ctx.env);
    ctx.client.set_freeze_admin(&ctx.treasury, &freeze_admin);

    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    let user_c = Address::generate(&ctx.env);

    mint(&ctx, &user_a, 500);
    mint(&ctx, &user_b, 300);
    mint(&ctx, &user_c, 200);

    let pool_id = make_pool(&ctx, &creator);

    // user_a bets before freeze.
    ctx.client
        .place_bet(&user_a, &pool_id, &0, &500, &None::<Address>);

    // Freeze the pool.
    ctx.client.freeze_pool(&freeze_admin, &pool_id);

    {
        let pool: Pool = ctx.client.get_pool(&pool_id).unwrap();
        assert_eq!(pool.status, PoolStatus::Frozen, "pool must be Frozen");
    }

    // Bet from user_b is rejected.
    assert!(
        ctx.client
            .try_place_bet(&user_b, &pool_id, &1, &300, &None::<Address>)
            .is_err(),
        "bet must be rejected while pool is frozen"
    );

    // Unfreeze restores Open status.
    ctx.client.unfreeze_pool(&freeze_admin, &pool_id);

    {
        let pool: Pool = ctx.client.get_pool(&pool_id).unwrap();
        assert_eq!(
            pool.status,
            PoolStatus::Open,
            "pool must be Open after unfreeze"
        );
    }

    // user_b and user_c can now bet.
    ctx.client
        .place_bet(&user_b, &pool_id, &1, &300, &None::<Address>);
    ctx.client
        .place_bet(&user_c, &pool_id, &1, &200, &None::<Address>);

    // Full lifecycle: expire, settle, claim.
    expire(&ctx);
    ctx.client.settle_pool(&creator, &pool_id, &0); // user_a wins

    // total = 1000, fee 2% = 20, net = 980, sole winner = user_a with 500 on A.
    let payout = ctx.client.claim_winnings(&user_a, &pool_id);
    assert_eq!(payout, 980, "user_a must win the net pool");

    assert!(
        ctx.client.try_claim_winnings(&user_b, &pool_id).is_err(),
        "user_b must not be able to claim"
    );
    assert!(
        ctx.client.try_claim_winnings(&user_c, &pool_id).is_err(),
        "user_c must not be able to claim"
    );
}

// ---------------------------------------------------------------------------
// MU-7: Double-claim is rejected
// ---------------------------------------------------------------------------

/// A winner claims successfully on the first call; the second call must fail.
#[test]
fn mu7_double_claim_rejected() {
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
    ctx.client.settle_pool(&creator, &pool_id, &0);

    // First claim succeeds.
    let payout = ctx.client.claim_winnings(&winner, &pool_id);
    assert!(payout > 0, "first claim must yield a positive payout");

    // Second claim is rejected (bet record was removed).
    assert!(
        ctx.client.try_claim_winnings(&winner, &pool_id).is_err(),
        "second claim must be rejected"
    );
}
