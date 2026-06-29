#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── E2E Test Harness ─────────────────────────────────────────────────────────

struct E2eEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: Address,
    freeze_admin: Address,
    /// Address used as treasury_recipient in initialize(). Required by
    /// admin-only functions such as set_pool_bet_limits.
    treasury: Address,
}

fn setup_e2e() -> E2eEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin, &token_admin);

    let freeze_admin = Address::generate(&env);
    client.set_freeze_admin(&token_admin, &freeze_admin);

    E2eEnv {
        env,
        client,
        token: token_id.address(),
        freeze_admin,
        treasury: token_admin,
    }
}

fn mint_e2e(env: &Env, token: &Address, user: &Address, amount: i128) {
    let admin = soroban_sdk::token::StellarAssetClient::new(env, token);
    admin.mint(user, &amount);
}

// ── E2E Test Cases ───────────────────────────────────────────────────────────

/// 1. E2E: Create → Bet (winners + losers) → Settle → Winner claims → Loser gets nothing
#[test]
fn test_e2e_successful_lifecycle() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    // Initial balances
    mint_e2e(&t.env, &t.token, &user_a, 1000);
    mint_e2e(&t.env, &t.token, &user_b, 1000);

    // Step 1: Create Pool
    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "E2E Pool"),
        &String::from_str(&t.env, "Full lifecycle validation"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.status, PoolStatus::Open);
    assert_eq!(pool.expiry, 3700);

    // Step 2: Place Bets
    t.client
        .place_bet(&user_a, &pool_id, &0u32, &500i128, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1u32, &500i128, &None::<Address>);

    // Verify token escrows and pool state
    assert_eq!(token_client.balance(&user_a), 500);
    assert_eq!(token_client.balance(&user_b), 500);
    assert_eq!(token_client.balance(&t.client.address), 1000);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 500);
    assert_eq!(pool.total_b, 500);
    assert_eq!(pool.participant_count, 2);

    // Step 3: Expire & Settle
    t.env.ledger().with_mut(|li| li.timestamp = 3701);
    t.client.settle_pool(&creator, &pool_id, &0u32); // Outcome A wins

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(0));

    // Step 4: Claim Winnings
    // total = 1000, 2% fee = 20, net = 980. User A has 100% of winning side.
    let winnings = t.client.claim_winnings(&user_a, &pool_id);
    assert_eq!(winnings, 980);
    assert_eq!(token_client.balance(&user_a), 500 + 980); // 1480 total

    // Loser gets nothing / claim fails
    let loser_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&user_b, &pool_id);
    }));
    assert!(loser_result.is_err(), "loser claim must fail");
    assert_eq!(token_client.balance(&user_b), 500); // untouched

    // Treasury accrual check
    assert_eq!(t.client.get_treasury_balance(), 20);
}

/// 2. E2E: Create → Bet → Void → All claim refunds
#[test]
fn test_e2e_void_and_refund() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    mint_e2e(&t.env, &t.token, &user_a, 1000);
    mint_e2e(&t.env, &t.token, &user_b, 1000);

    // Step 1: Create Pool
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Void Pool"),
        &String::from_str(&t.env, "Void validation"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    // Step 2: Bet
    t.client
        .place_bet(&user_a, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1u32, &400i128, &None::<Address>);

    // Step 3: Void Pool (Creator only)
    t.client.void_pool(&creator, &pool_id);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Voided);

    // Step 4: Claim Refunds
    let refund_a = t.client.claim_refund(&user_a, &pool_id);
    let refund_b = t.client.claim_refund(&user_b, &pool_id);

    assert_eq!(refund_a, 300);
    assert_eq!(refund_b, 400);

    // Verify original balances restored exactly with 0 fees taken
    assert_eq!(token_client.balance(&user_a), 1000);
    assert_eq!(token_client.balance(&user_b), 1000);
    assert_eq!(token_client.balance(&t.client.address), 0);
}

/// 3. E2E: Create → Bet → Settle → Dispute → Unfreeze → Claim
#[test]
fn test_e2e_dispute_unfreeze_claim() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    mint_e2e(&t.env, &t.token, &user_a, 1000);
    mint_e2e(&t.env, &t.token, &user_b, 1000);

    // Step 1: Create Pool & Bet
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Dispute Pool"),
        &String::from_str(&t.env, "Dispute validation"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    t.client
        .place_bet(&user_a, &pool_id, &0u32, &500i128, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1u32, &500i128, &None::<Address>);

    // Step 2: Settle
    t.env.ledger().with_mut(|li| li.timestamp = 3701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Step 3: Dispute Pool
    t.client.dispute_pool(&t.freeze_admin, &pool_id);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Disputed);

    // Attempted claims must block/panic while disputed
    let claim_fail = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&user_a, &pool_id);
    }));
    assert!(claim_fail.is_err(), "claims must block on disputed pools");

    // Step 4: Unfreeze
    t.client.unfreeze_pool(&t.freeze_admin, &pool_id);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Open); // Returns to Open

    // Re-settle to enable claims again
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Step 5: Claim
    let winnings = t.client.claim_winnings(&user_a, &pool_id);
    assert_eq!(winnings, 980);
}

/// 4. E2E: Pool cancellation before bets
#[test]
fn test_e2e_pool_cancellation_before_bets() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);

    t.env.ledger().with_mut(|li| li.timestamp = 100);

    // Step 1: Create Scheduled Pool
    let pool_id = t.client.schedule_pool(
        &creator,
        &String::from_str(&t.env, "Scheduled Pool"),
        &String::from_str(&t.env, "Future event"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &200, // Open at timestamp 200
    );

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Scheduled(200));

    // Step 2: Cancel Scheduled Pool (no bets can exist yet)
    t.client.cancel_scheduled_pool(&creator, &pool_id);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Cancelled);

    // Attempting to activate the cancelled pool must fail
    t.env.ledger().with_mut(|li| li.timestamp = 201);
    let activate_result = t.client.try_activate_scheduled_pool(&pool_id);
    assert_eq!(activate_result, Err(Ok(ContractError::PoolNotOpen)));
}

/// 5. E2E: Zero-activity pool — settlement rejected, no claims possible
#[test]
fn test_e2e_zero_activity_pool_cannot_settle() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);

    // Create pool at t=100; expires at t=3700.
    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Zero Bet Pool"),
        &String::from_str(&t.env, "No one bets here"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    // Advance past expiry so the time-check passes before the participant check.
    t.env.ledger().with_mut(|li| li.timestamp = 3701);

    // Settlement must fail: pool has 0 participants (< DEFAULT_MIN_SETTLEMENT_PARTICIPANTS).
    let settle_result = t.client.try_settle_pool(&creator, &pool_id, &0u32);
    assert_eq!(
        settle_result,
        Err(Ok(ContractError::InsufficientParticipants))
    );

    // A claim attempt on an unsettled pool fails with PoolNotSettled (the pool
    // status check fires before the bet-existence check).
    let stranger = Address::generate(&t.env);
    let claim_result = t.client.try_claim_winnings(&stranger, &pool_id);
    assert_eq!(claim_result, Err(Ok(ContractError::PoolNotSettled)));
}

/// 6. E2E: Expired unsettled pool — full stake refund via claim_expired, no fee
#[test]
fn test_e2e_expired_unsettled_refund() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    mint_e2e(&t.env, &t.token, &user_a, 1000);
    mint_e2e(&t.env, &t.token, &user_b, 1000);

    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Refund Pool"),
        &String::from_str(&t.env, "Expires without settlement"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    // Place bets — pool is live.
    t.client
        .place_bet(&user_a, &pool_id, &0u32, &400i128, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1u32, &600i128, &None::<Address>);

    assert_eq!(token_client.balance(&user_a), 600);
    assert_eq!(token_client.balance(&user_b), 400);

    // Advance past expiry WITHOUT settling.
    t.env.ledger().with_mut(|li| li.timestamp = 3701);

    // Both users reclaim full stake — no protocol fee deducted.
    let refund_a = t.client.claim_expired(&user_a, &pool_id);
    let refund_b = t.client.claim_expired(&user_b, &pool_id);

    assert_eq!(refund_a, 400, "user_a must get full 400 back");
    assert_eq!(refund_b, 600, "user_b must get full 600 back");

    assert_eq!(
        token_client.balance(&user_a),
        1000,
        "user_a balance restored"
    );
    assert_eq!(
        token_client.balance(&user_b),
        1000,
        "user_b balance restored"
    );
    assert_eq!(
        token_client.balance(&t.client.address),
        0,
        "contract holds nothing"
    );

    // Double-claim is rejected: bet record was removed on first call.
    let second_claim = t.client.try_claim_expired(&user_a, &pool_id);
    assert_eq!(second_claim, Err(Ok(ContractError::NoBetFound)));
}

/// 7. E2E: Minimum bet enforcement — bets below the floor are rejected
#[test]
fn test_e2e_min_bet_enforcement() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    mint_e2e(&t.env, &t.token, &user, 10_000);

    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Min Bet Pool"),
        &String::from_str(&t.env, "Bet floor test"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    // Set minimum bet to 1_000 (max = 0 means no upper limit).
    t.client
        .set_pool_bet_limits(&t.treasury, &pool_id, &1_000i128, &0i128);

    // Bet below minimum must fail.
    let low_bet = t
        .client
        .try_place_bet(&user, &pool_id, &0u32, &999i128, &None::<Address>);
    assert_eq!(low_bet, Err(Ok(ContractError::BetBelowMinBet)));

    // Bet exactly at minimum must succeed.
    t.client
        .place_bet(&user, &pool_id, &0u32, &1_000i128, &None::<Address>);
}

/// 8. E2E: Maximum bet enforcement — bets above the ceiling are rejected
#[test]
fn test_e2e_max_bet_enforcement() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    mint_e2e(&t.env, &t.token, &user, 10_000);

    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Max Bet Pool"),
        &String::from_str(&t.env, "Bet ceiling test"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    // Set maximum bet to 500 (min = 0 means no lower limit).
    t.client
        .set_pool_bet_limits(&t.treasury, &pool_id, &0i128, &500i128);

    // Bet above maximum must fail.
    let high_bet = t
        .client
        .try_place_bet(&user, &pool_id, &0u32, &501i128, &None::<Address>);
    assert_eq!(high_bet, Err(Ok(ContractError::BetAboveMaxBet)));

    // Bet exactly at maximum must succeed.
    t.client
        .place_bet(&user, &pool_id, &0u32, &500i128, &None::<Address>);
}

/// 9. E2E: Multi-bettor proportional distribution — exact payout math and dust sweep
#[test]
fn test_e2e_multiple_bettors_proportional_distribution() {
    let t = setup_e2e();
    let creator = Address::generate(&t.env);

    // 5 winners (outcome A): stakes 100, 200, 300, 400, 500 → total A = 1500
    let w1 = Address::generate(&t.env);
    let w2 = Address::generate(&t.env);
    let w3 = Address::generate(&t.env);
    let w4 = Address::generate(&t.env);
    let w5 = Address::generate(&t.env);

    // 3 losers (outcome B): stakes 150, 250, 350 → total B = 750
    let l1 = Address::generate(&t.env);
    let l2 = Address::generate(&t.env);
    let l3 = Address::generate(&t.env);

    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    // total = 2250, fee 2% = 45, net = 2205
    mint_e2e(&t.env, &t.token, &w1, 100);
    mint_e2e(&t.env, &t.token, &w2, 200);
    mint_e2e(&t.env, &t.token, &w3, 300);
    mint_e2e(&t.env, &t.token, &w4, 400);
    mint_e2e(&t.env, &t.token, &w5, 500);
    mint_e2e(&t.env, &t.token, &l1, 150);
    mint_e2e(&t.env, &t.token, &l2, 250);
    mint_e2e(&t.env, &t.token, &l3, 350);

    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Multi Bettor Pool"),
        &String::from_str(&t.env, "Proportional distribution test"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    t.client
        .place_bet(&w1, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&w2, &pool_id, &0u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&w3, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&w4, &pool_id, &0u32, &400i128, &None::<Address>);
    t.client
        .place_bet(&w5, &pool_id, &0u32, &500i128, &None::<Address>);
    t.client
        .place_bet(&l1, &pool_id, &1u32, &150i128, &None::<Address>);
    t.client
        .place_bet(&l2, &pool_id, &1u32, &250i128, &None::<Address>);
    t.client
        .place_bet(&l3, &pool_id, &1u32, &350i128, &None::<Address>);

    t.env.ledger().with_mut(|li| li.timestamp = 3701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // Expected payouts: floor(stake × 2205 / 1500)
    // 100→147, 200→294, 300→441, 400→588, 500→735; sum=2205
    let p1 = t.client.claim_winnings(&w1, &pool_id);
    let p2 = t.client.claim_winnings(&w2, &pool_id);
    let p3 = t.client.claim_winnings(&w3, &pool_id);
    let p4 = t.client.claim_winnings(&w4, &pool_id);
    let p5 = t.client.claim_winnings(&w5, &pool_id);

    assert_eq!(p1, 147, "w1 payout");
    assert_eq!(p2, 294, "w2 payout");
    assert_eq!(p3, 441, "w3 payout");
    assert_eq!(p4, 588, "w4 payout");
    assert_eq!(p5, 735, "w5 payout");

    // Entire net pool distributed (no stranded funds).
    assert_eq!(
        p1 + p2 + p3 + p4 + p5,
        2205,
        "sum of payouts must equal net pool"
    );

    // Treasury holds exactly the 2% fee.
    assert_eq!(t.client.get_treasury_balance(), 45, "treasury must hold 45");

    // Losers cannot claim.
    assert_eq!(
        t.client.try_claim_winnings(&l1, &pool_id),
        Err(Ok(ContractError::NoWinningsToClaim))
    );
    assert_eq!(
        t.client.try_claim_winnings(&l2, &pool_id),
        Err(Ok(ContractError::NoWinningsToClaim))
    );
    assert_eq!(
        t.client.try_claim_winnings(&l3, &pool_id),
        Err(Ok(ContractError::NoWinningsToClaim))
    );

    // Contract holds nothing after all claims (fee stays until treasury withdrawal).
    let contract_balance = token_client.balance(&t.client.address);
    assert_eq!(
        contract_balance, 45,
        "contract holds only the unclaimed fee"
    );
}
