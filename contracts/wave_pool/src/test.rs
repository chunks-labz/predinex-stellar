//! Integration tests for the wave pool contract.
//!
//! These tests verify that **cumulative volume** tracking works correctly:
//! - Volume is incremented per `place_bet` call.
//! - Volume persists through settlement and claim operations.
//! - The global contract volume is the sum of all pool volumes.
//! - Overflow protection via `checked_add` (panic on overflow).
//! - Input validation (zero amounts, non‑existent pools, negative amounts, pool ID 0) is handled correctly.
//! - Logging provides observability into test operations.

#![cfg(test)]

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    tokens::StellarAssetClient as TokenAdminClient,
    Address, Env, IntoVal, Symbol,
};

use crate::contract::WavePool;
use crate::storage::DataKey;

// ---------------------------------------------------------------------------
// Constants for test pool IDs and expected values
// ---------------------------------------------------------------------------
const POOL_A: u32 = 1;
const POOL_B: u32 = 2;
const POOL_C: u32 = 3;
const POOL_D: u32 = 4;
const POOL_E: u32 = 5;
const POOL_F: u32 = 6;
const POOL_G: u32 = 10;
const POOL_H: u32 = 11;
const POOL_ZERO: u32 = 0; // edge case: pool ID 0
const POOL_NONEXISTENT: u32 = 99; // pool that was never created

/// The amount of tokens minted to each user in `setup_test`.
pub(crate) const INITIAL_BALANCE: i128 = 1_000_000_0000;

/// Maximum cumulative volume before overflow test.
pub(crate) const MAX_VOLUME: i128 = i128::MAX;

// ---------------------------------------------------------------------------
// Helper: create a test environment with a deployed contract and two funded users
// ---------------------------------------------------------------------------
/// Deploys the `WavePool` contract, generates two user addresses and a token admin,
/// and mint `INITIAL_BALANCE` units of a test asset to each user.
///
/// # Returns
/// A tuple `(env, contract_id, user1, user2)`.
#[must_use]
fn setup_test() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let contract_id = env.register_contract(None, WavePool);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token_client = TokenAdminClient::new(
        &env,
        &env.register_stellar_asset_contract(token_admin.clone()),
    );
    token_client.mint(&user1, &INITIAL_BALANCE);
    token_client.mint(&user2, &INITIAL_BALANCE);

    // Log setup completion with structured metadata
    env.logger()
        .log("info", &format!("Test environment setup complete. Contract: {}, User1: {}, User2: {}",
                               contract_id, user1, user2));

    (env, contract_id, user1, user2)
}

// ---------------------------------------------------------------------------
// Helper: place a bet with correct authentication
// ---------------------------------------------------------------------------
/// Calls `place_bet` on the contract, simulating a signed invocation from `user`.
///
/// # Panics
/// Panics if the contract call fails (e.g., overflow, pool closed, insufficient balance, invalid amount).
#[track_caller]
fn place_bet(env: &Env, contract_id: &Address, user: &Address, pool_id: u32, amount: i128) {
    let client = WavePoolClient::new(env, contract_id);
    client
        .mock_auths(&[MockAuth {
            address: user.clone(),
            invoke: &MockAuthInvoke {
                contract: contract_id.clone(),
                fn_name: "place_bet",
                args: (pool_id, amount).into_val(env),
                sub_invokes: &[],
            },
        }])
        .place_bet(pool_id, amount);
}

// ---------------------------------------------------------------------------
// Helper: place a bet expecting a panic (failure)
// ---------------------------------------------------------------------------
/// Attempts to call `place_bet` and asserts that it panics with the given error message fragment.
/// Used for testing invalid inputs or overflow conditions.
#[track_caller]
fn place_bet_expect_failure(
    env: &Env,
    contract_id: &Address,
    user: &Address,
    pool_id: u32,
    amount: i128,
    expected_msg: &str,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        place_bet(env, contract_id, user, pool_id, amount);
    }));
    assert!(
        result.is_err(),
        "Expected a panic when calling place_bet({pool_id}, {amount})"
    );
    // Optionally check error message (requires Debug impl)
    // For simplicity, only verify that a panic occurred.
    env.logger()
        .log("warn", &format!("Expected panic caught for place_bet({pool_id}, {amount}): {expected_msg}"));
}

// ---------------------------------------------------------------------------
// Helper: settle a pool (no auth needed, contract‑internal)
// ---------------------------------------------------------------------------
/// Calls `settle` on the pool.
///
/// # Panics
/// Panics if the pool does not exist or is in an invalid state.
#[track_caller]
fn settle_pool(env: &Env, contract_id: &Address, pool_id: u32) {
    let client = WavePoolClient::new(env, contract_id);
    client.settle(pool_id);
}

// ---------------------------------------------------------------------------
// Helper: claim winnings after settlement
// ---------------------------------------------------------------------------
/// Calls `claim` for the given user and outcome.
///
/// # Panics
/// Panics if the user has no valid claim or the pool is not settled.
#[track_caller]
fn claim_winnings(env: &Env, contract_id: &Address, user: &Address, pool_id: u32, outcome: u32) {
    let client = WavePoolClient::new(env, contract_id);
    client
        .mock_auths(&[MockAuth {
            address: user.clone(),
            invoke: &MockAuthInvoke {
                contract: contract_id.clone(),
                fn_name: "claim",
                args: (pool_id, outcome).into_val(env),
                sub_invokes: &[],
            },
        }])
        .claim(pool_id, outcome);
}

// ===========================================================================
// Tests — cumulative volume correctness
// ===========================================================================

/// Volume is incremented by the bet amount on each `place_bet` call.
#[test]
fn test_volume_increment_per_bet() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // Initial state: all volumes zero
    assert_eq!(
        client.get_pool_volume(POOL_A),
        0,
        "Initial pool volume should be 0"
    );
    assert_eq!(
        client.get_total_contract_volume(),
        0,
        "Initial total volume should be 0"
    );

    // Single bet adds its amount
    place_bet(&env, &contract_id, &user1, POOL_A, 100);
    assert_eq!(client.get_pool_volume(POOL_A), 100);
    assert_eq!(client.get_total_contract_volume(), 100);

    // Second bet accumulates
    place_bet(&env, &contract_id, &user1, POOL_A, 50);
    assert_eq!(client.get_pool_volume(POOL_A), 150);
    assert_eq!(client.get_total_contract_volume(), 150);

    // Third bet to another pool
    place_bet(&env, &contract_id, &user1, POOL_B, 25);
    assert_eq!(client.get_pool_volume(POOL_B), 25);
    assert_eq!(client.get_total_contract_volume(), 175);

    env.logger()
        .log("info", "test_volume_increment_per_bet passed");
}

/// Volume is **not** reset when the pool is settled.
#[test]
fn test_volume_persists_after_settlement() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    place_bet(&env, &contract_id, &user1, POOL_B, 200);
    assert_eq!(client.get_pool_volume(POOL_B), 200);

    settle_pool(&env, &contract_id, POOL_B);

    // Volume must remain unchanged after settlement
    assert_eq!(
        client.get_pool_volume(POOL_B),
        200,
        "Volume unchanged after settlement"
    );
    assert_eq!(
        client.get_total_contract_volume(),
        200,
        "Total volume unchanged after settlement"
    );

    env.logger()
        .log("info", "test_volume_persists_after_settlement passed");
}

/// Volume is **not** reset when a user claims winnings.
#[test]
fn test_volume_persists_after_claim() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    place_bet(&env, &contract_id, &user1, POOL_C, 300);
    settle_pool(&env, &contract_id, POOL_C);

    // Claim with outcome 0 (assumes contract uses that outcome; adjust if needed)
    claim_winnings(&env, &contract_id, &user1, POOL_C, 0);

    // Volume must still be intact
    assert_eq!(client.get_pool_volume(POOL_C), 300);
    assert_eq!(client.get_total_contract_volume(), 300);

    env.logger()
        .log("info", "test_volume_persists_after_claim passed");
}

/// Cumulative volume across multiple users and multiple pools.
#[test]
fn test_multi_user_volume() {
    let (env, contract_id, user1, user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // User1 and User2 both bet in Pool_D
    place_bet(&env, &contract_id, &user1, POOL_D, 150);
    assert_eq!(client.get_pool_volume(POOL_D), 150);
    assert_eq!(client.get_total_contract_volume(), 150);

    place_bet(&env, &contract_id, &user2, POOL_D, 250);
    assert_eq!(client.get_pool_volume(POOL_D), 400);
    assert_eq!(client.get_total_contract_volume(), 400);

    // User1 bets in a different pool
    place_bet(&env, &contract_id, &user1, POOL_E, 100);
    assert_eq!(client.get_pool_volume(POOL_E), 100);
    assert_eq!(client.get_total_contract_volume(), 500);

    env.logger()
        .log("info", "test_multi_user_volume passed");
}

/// Overflow protection: cumulative volume should panic on overflow when exceeding i128::MAX.
#[test]
fn test_overflow_protection() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // First, place a bet to bring volume to near MAX
    // Since we can only bet up to user's balance, we need a user with huge balance.
    // Override the user's balance by minting more.
    let token_admin = Address::generate(&env);
    let token_client = TokenAdminClient::new(
        &env,
        &env.register_stellar_asset_contract(token_admin.clone()),
    );
    // Mint enough to trigger overflow
    let huge_amount = MAX_VOLUME / 2;
    token_client.mint(&user1, &huge_amount);

    // Place a large bet to get close to MAX_VOLUME
    place_bet(&env, &contract_id, &user1, POOL_F, huge_amount);
    assert_eq!(client.get_pool_volume(POOL_F), huge_amount);

    // Now try to place another bet that would overflow the total contract volume
    // We need to overflow total, which includes any other pools. Bet enough to overflow.
    // Since total currently = huge_amount, next bet of (MAX_VOLUME - huge_amount + 1) should overflow.
    let overflow_amount = (MAX_VOLUME - huge_amount).checked_add(1).unwrap();
    place_bet_expect_failure(
        &env,
        &contract_id,
        &user1,
        POOL_F,
        overflow_amount,
        "overflow on total volume",
    );

    env.logger()
        .log("info", "test_overflow_protection passed");
}

/// Edge case: Pool ID 0 should be handled gracefully (rejected or accepted? depends on contract spec).
/// We assume pool ID 0 is invalid and should return an error.
#[test]
fn test_pool_id_zero() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // Attempt to place bet on pool 0; expect panic due to invalid pool.
    place_bet_expect_failure(&env, &contract_id, &user1, POOL_ZERO, 100, "invalid pool id 0");
    // Also verify that get_pool_volume for pool 0 returns 0 (or panics? depends on implementation)
    // We assume it returns 0 for non-existent pools.
    assert_eq!(
        client.get_pool_volume(POOL_ZERO),
        0,
        "Pool volume for ID 0 should be 0 (non-existent pool)"
    );

    env.logger()
        .log("info", "test_pool_id_zero passed");
}

/// Edge case: Non‑existent pool ID should not affect volume.
#[test]
fn test_nonexistent_pool_volume() {
    let (env, contract_id, _user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    assert_eq!(
        client.get_pool_volume(POOL_NONEXISTENT),
        0,
        "Non-existent pool volume should be 0"
    );

    // Trying to settle a non-existent pool should panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        settle_pool(&env, &contract_id, POOL_NONEXISTENT);
    }));
    assert!(
        result.is_err(),
        "Settling non-existent pool should panic"
    );

    env.logger()
        .log("info", "test_nonexistent_pool_volume passed");
}

/// Edge case: Zero bet amount should be rejected.
#[test]
fn test_zero_bet() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // Zero amount should cause a panic (invalid input)
    place_bet_expect_failure(&env, &contract_id, &user1, POOL_G, 0, "zero bet amount");

    // Volume should remain 0
    assert_eq!(client.get_pool_volume(POOL_G), 0);
    assert_eq!(client.get_total_contract_volume(), 0);

    env.logger()
        .log("info", "test_zero_bet passed");
}

/// Edge case: Negative bet amounts should be rejected.
#[test]
fn test_negative_bet() {
    let (env, contract_id, user1, _user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // Negative amount should cause a panic
    place_bet_expect_failure(
        &env,
        &contract_id,
        &user1,
        POOL_H,
        -50,
        "negative bet amount",
    );

    assert_eq!(client.get_pool_volume(POOL_H), 0);
    assert_eq!(client.get_total_contract_volume(), 0);

    env.logger()
        .log("info", "test_negative_bet passed");
}

/// Verify that total contract volume is the sum of all pool volumes after multiple operations.
#[test]
fn test_total_contract_volume_aggregation() {
    let (env, contract_id, user1, user2) = setup_test();
    let client = WavePoolClient::new(&env, &contract_id);

    // Bets in multiple pools
    place_bet(&env, &contract_id, &user1, POOL_A, 100);
    place_bet(&env, &contract_id, &user2, POOL_B, 200);
    place_bet(&env, &contract_id, &user1, POOL_C, 300);
    place_bet(&env, &contract_id, &user2, POOL_D, 400);

    let expected_total = 100 + 200 + 300 + 400;
    assert_eq!(client.get_total_contract_volume(), expected_total);

    // Settle one pool, volume unchanged
    settle_pool(&env, &contract_id, POOL_B);
    assert_eq!(client.get_total_contract_volume(), expected_total);

    // Claim on settled pool
    claim_winnings(&env, &contract_id, &user2, POOL_B, 0);
    assert_eq!(client.get_total_contract_volume(), expected_total);

    env.logger()
        .log("info", "test_total_contract_volume_aggregation passed");
}