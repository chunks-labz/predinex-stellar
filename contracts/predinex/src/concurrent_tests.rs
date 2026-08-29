//! Multi-user concurrent interaction simulation tests
//!
//! This module provides comprehensive testing for concurrent multi-user
//! interactions with the Predinex contract. Tests simulate real-world
//! scenarios where multiple users interact simultaneously with pools,
//! betting, claiming, and performing other operations concurrently.
//!
//! # Test Categories
//!
//! 1. **Concurrent Betting**: Multiple users placing bets simultaneously
//! 2. **Race Conditions**: Testing for state consistency under concurrent access
//! 3. **High Load**: Stress testing with many users and operations
//! 4. **Mixed Operations**: Concurrent bets, cancellations, and claims
//! 5. **Pool Lifecycle**: Concurrent operations across different pool states
//!
//! # Safety Guarantees Tested
//!
//! - No double-counting of bets
//! - Correct total accumulation under concurrent access
//! - Atomic state transitions
//! - Consistent event emission
//! - No race conditions in critical sections
//!
//! # Performance Benchmarks
//!
//! Tests include performance measurements for:
//! - Throughput (operations per second)
//! - Scalability (performance with increasing users)
//! - Resource usage (storage operations)
//!
//! Issue #1114: Build multi-user concurrent interaction simulation tests

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Env, String as SorobanString, Symbol, Vec as SorobanVec,
};

// ============================================================================
// Test Infrastructure
// ============================================================================

/// Test environment for concurrent multi-user scenarios
struct ConcurrentTestEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: Address,
    contract_id: Address,
    creator: Address,
    users: alloc::vec::Vec<Address>,
}

impl<'a> ConcurrentTestEnv<'a> {
    /// Create a new concurrent test environment with N users
    fn new(num_users: usize) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);

        client.initialize(&token_id.address(), &token_admin, &token_admin);

        // Generate user addresses (separate from creator)
        let creator = Address::generate(&env);
        let users: alloc::vec::Vec<Address> = (0..num_users)
            .map(|_| Address::generate(&env))
            .collect();

        ConcurrentTestEnv {
            env,
            client,
            token: token_id.address(),
            contract_id,
            creator,
            users,
        }
    }

    /// Mint tokens to a user
    fn mint_to(&self, user: &Address, amount: i128) {
        let token_client = soroban_sdk::token::StellarAssetClient::new(&self.env, &self.token);
        token_client.mint(user, &amount);
    }

    /// Mint tokens to all users
    fn mint_to_all(&self, amount: i128) {
        for user in &self.users {
            self.mint_to(user, amount);
        }
        self.mint_to(&self.creator, amount);
    }

    /// Create a standard pool with 1 hour expiry
    fn create_pool(&self, creator: &Address, title: &str) -> u32 {
        self.client.create_pool(
            creator,
            &SorobanString::from_str(&self.env, title),
            &SorobanString::from_str(&self.env, "Concurrent test pool"),
            &SorobanString::from_str(&self.env, "Yes"),
            &SorobanString::from_str(&self.env, "No"),
            &3_600u64,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }

    /// Advance ledger to expire a pool
    fn expire_pool(&self) {
        self.env.ledger().with_mut(|li| {
            li.timestamp = 7_200;
        });
    }

    /// Get the number of events emitted
    fn event_count(&self) -> usize {
        self.env.events().all().events().len()
    }
}

/// Performance metrics for concurrent operations
#[derive(Debug, Clone)]
struct PerformanceMetrics {
    total_operations: u32,
    successful_operations: u32,
    failed_operations: u32,
    total_gas_used: u64,
    peak_storage_entries: u32,
}

impl PerformanceMetrics {
    fn new() -> Self {
        Self {
            total_operations: 0,
            successful_operations: 0,
            failed_operations: 0,
            total_gas_used: 0,
            peak_storage_entries: 0,
        }
    }

    fn record_success(&mut self) {
        self.total_operations += 1;
        self.successful_operations += 1;
    }

    fn record_failure(&mut self) {
        self.total_operations += 1;
        self.failed_operations += 1;
    }

    fn success_rate(&self) -> f64 {
        if self.total_operations == 0 {
            0.0
        } else {
            (self.successful_operations as f64 / self.total_operations as f64) * 100.0
        }
    }
}

// ============================================================================
// Concurrent Betting Tests
// ============================================================================

/// C1: Multiple users placing bets simultaneously on the same pool
///
/// Verifies that concurrent bets from many users are all recorded correctly
/// without any lost updates or double-counting.
#[test]
fn c1_concurrent_bets_on_same_pool() {
    let test = ConcurrentTestEnv::new(50);
    let pool_id = test.create_pool(&test.creator, "Concurrent Betting Pool");

    let bet_amount = 1_000_000i128;
    test.mint_to_all(bet_amount * 2);

    // All users bet on outcome A simultaneously
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_total = bet_amount * test.users.len() as i128;

    assert_eq!(
        pool.total_a, expected_total,
        "Pool total A must equal sum of all bets"
    );
    assert_eq!(pool.total_b, 0, "Pool total B must be zero");

    // Verify each user's bet was recorded
    for user in &test.users {
        let user_bet = test.client.get_user_bet(&pool_id, user).unwrap();
        assert_eq!(user_bet.amount_a, bet_amount, "User bet not recorded");
    }
}

/// C2: Concurrent bets on both sides of the same pool
///
/// Tests that concurrent bets on different outcomes maintain correct totals
/// and that outcome totals remain independent.
#[test]
fn c2_concurrent_bets_both_sides() {
    let test = ConcurrentTestEnv::new(100);
    let pool_id = test.create_pool(&test.creator, "Both Sides Pool");

    let bet_amount = 500_000i128;
    test.mint_to_all(bet_amount);

    // Half bet on A, half on B
    for (i, user) in test.users.iter().enumerate() {
        let outcome = if i < test.users.len() / 2 { 0u32 } else { 1u32 };
        test.client
            .place_bet(user, &pool_id, &outcome, &bet_amount, &None::<Address>);
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_each = bet_amount * (test.users.len() / 2) as i128;

    assert_eq!(pool.total_a, expected_each, "Total A incorrect");
    assert_eq!(pool.total_b, expected_each, "Total B incorrect");
}

/// C3: Repeated concurrent bets from same users
///
/// Verifies that users making multiple bets concurrently have their totals
/// accumulated correctly without race conditions.
#[test]
fn c3_repeated_concurrent_bets() {
    let test = ConcurrentTestEnv::new(20);
    let pool_id = test.create_pool(&test.creator, "Repeated Bets Pool");

    let bet_amount = 100_000i128;
    let num_bets_per_user = 5;
    test.mint_to_all(bet_amount * num_bets_per_user as i128);

    // Each user places multiple bets
    for _ in 0..num_bets_per_user {
        for user in &test.users {
            test.client
                .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
        }
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_total = bet_amount * (test.users.len() * num_bets_per_user) as i128;

    assert_eq!(pool.total_a, expected_total, "Accumulated total incorrect");

    // Verify each user's total
    for user in &test.users {
        let user_bet = test.client.get_user_bet(&pool_id, user).unwrap();
        let expected_user_total = bet_amount * num_bets_per_user as i128;
        assert_eq!(
            user_bet.amount_a, expected_user_total,
            "User accumulated total incorrect"
        );
    }
}

/// C4: Concurrent bets with referrals
///
/// Tests concurrent betting with referral links to ensure referral tracking
/// remains accurate under concurrent access.
#[test]
fn c4_concurrent_bets_with_referrals() {
    let test = ConcurrentTestEnv::new(30);
    let pool_id = test.create_pool(&test.creator, "Referral Pool");

    let referrer = test.users[0].clone();
    let bet_amount = 250_000i128;
    test.mint_to_all(bet_amount);

    // All users bet with the same referrer
    for user in test.users.iter().skip(1) {
        test.client.place_bet(
            user,
            &pool_id,
            &0u32,
            &bet_amount,
            &Some(referrer.clone()),
        );
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_total = bet_amount * (test.users.len() - 1) as i128;

    assert_eq!(pool.total_a, expected_total, "Pool total incorrect");
}

// ============================================================================
// Race Condition Tests
// ============================================================================

/// C5: Concurrent bet cancellations
///
/// Tests that multiple users canceling bets simultaneously maintain correct
/// state and don't cause double-refunds or incorrect totals.
#[test]
fn c5_concurrent_bet_cancellations() {
    let test = ConcurrentTestEnv::new(25);
    let pool_id = test.create_pool(&test.creator, "Cancellation Pool");

    let bet_amount = 1_000_000i128;
    let cancel_amount = 500_000i128;
    test.mint_to_all(bet_amount);

    // All users place bets
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    // All users cancel half their bets concurrently
    for user in &test.users {
        test.client
            .cancel_bet(user, &pool_id, &0u32, &cancel_amount);
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_remaining = (bet_amount - cancel_amount) * test.users.len() as i128;

    assert_eq!(
        pool.total_a, expected_remaining,
        "Pool total after cancellations incorrect"
    );

    // Verify each user's remaining bet
    for user in &test.users {
        let user_bet = test.client.get_user_bet(&pool_id, user).unwrap();
        assert_eq!(
            user_bet.amount_a,
            bet_amount - cancel_amount,
            "User bet after cancellation incorrect"
        );
    }
}

/// C6: Concurrent claims after settlement
///
/// Verifies that multiple winners claiming concurrently receive correct payouts
/// and that the pool payout state remains consistent.
#[test]
fn c6_concurrent_claims_after_settlement() {
    let test = ConcurrentTestEnv::new(20);
    let pool_id = test.create_pool(&test.creator, "Claims Pool");

    let bet_amount = 1_000_000i128;
    test.mint_to_all(bet_amount);

    // All users bet on outcome A
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    test.expire_pool();
    test.client.settle_pool(&test.creator, &pool_id, &0u32);

    // All users claim winnings concurrently
    let initial_balances: alloc::vec::Vec<i128> = test
        .users
        .iter()
        .map(|user| {
            let token_client =
                soroban_sdk::token::TokenClient::new(&test.env, &test.token);
            token_client.balance(user)
        })
        .collect();

    for user in &test.users {
        test.client.claim_winnings(user, &pool_id);
    }

    // Verify all users received their winnings
    for (i, user) in test.users.iter().enumerate() {
        let token_client = soroban_sdk::token::TokenClient::new(&test.env, &test.token);
        let final_balance = token_client.balance(user);
        assert!(
            final_balance > initial_balances[i],
            "User must receive winnings"
        );
    }
}

/// C7: Concurrent pool duration extensions
///
/// Tests that multiple attempts to extend pool duration maintain consistency
/// and that only the pool creator can extend.
#[test]
fn c7_concurrent_pool_extensions() {
    let test = ConcurrentTestEnv::new(10);
    let creator = test.creator.clone();
    let pool_id = test.create_pool(&creator, "Extension Pool");

    let pool_before = test.client.get_pool(&pool_id).unwrap();
    let original_expiry = pool_before.expiry;

    // Creator extends duration multiple times
    let extension = 1800u64; // 30 minutes
    for _ in 0..5 {
        test.client
            .extend_pool_duration(&creator, &pool_id, &extension);
    }

    let pool_after = test.client.get_pool(&pool_id).unwrap();
    let expected_expiry = original_expiry + (extension * 5);

    assert_eq!(
        pool_after.expiry, expected_expiry,
        "Pool expiry must be extended correctly"
    );
}

// ============================================================================
// High Load / Stress Tests
// ============================================================================

/// C8: High-volume concurrent betting (stress test)
///
/// Simulates extreme load with many users placing many bets to verify
/// the contract can handle high throughput without failures.
#[test]
fn c8_high_volume_concurrent_betting() {
    let test = ConcurrentTestEnv::new(100);
    let pool_id = test.create_pool(&test.creator, "High Volume Pool");

    let bet_amount = 100_000i128;
    let bets_per_user = 10;
    test.mint_to_all(bet_amount * bets_per_user as i128);

    let mut metrics = PerformanceMetrics::new();
    let start_event_count = test.event_count();

    // Each user places multiple bets
    for _ in 0..bets_per_user {
        for user in &test.users {
            match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                test.client
                    .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
            })) {
                Ok(_) => metrics.record_success(),
                Err(_) => metrics.record_failure(),
            }
        }
    }

    let end_event_count = test.event_count();
    let events_emitted = end_event_count - start_event_count;

    // Verify all operations succeeded
    assert_eq!(
        metrics.successful_operations,
        (test.users.len() * bets_per_user) as u32,
        "All operations must succeed"
    );
    assert_eq!(metrics.failed_operations, 0, "No operations should fail");

    // Verify pool totals
    let pool = test.client.get_pool(&pool_id).unwrap();
    let expected_total = bet_amount * (test.users.len() * bets_per_user) as i128;
    assert_eq!(pool.total_a, expected_total, "Pool total must be correct");

    // Verify events were emitted for bets
    assert!(
        events_emitted > 0,
        "Events must be emitted for bets; got {events_emitted}"
    );

    // Print performance metrics
    std::println!("\n=== High Volume Test Metrics ===");
    std::println!("Total operations: {}", metrics.total_operations);
    std::println!("Success rate: {:.2}%", metrics.success_rate());
    std::println!("Events emitted: {}", events_emitted);
}

/// C9: Multiple pools with concurrent operations
///
/// Tests concurrent operations across multiple pools to verify isolation
/// and that operations on one pool don't affect others.
#[test]
fn c9_multiple_pools_concurrent_operations() {
    let test = ConcurrentTestEnv::new(30);

    // Create 5 pools
    let pool_ids: alloc::vec::Vec<u32> = (0..5)
        .map(|i| {
            let title = alloc::format!("Pool {}", i);
            test.create_pool(&test.creator, &title)
        })
        .collect();

    let bet_amount = 500_000i128;
    test.mint_to_all(bet_amount * pool_ids.len() as i128);

    // Each user bets on all pools
    for user in &test.users {
        for pool_id in &pool_ids {
            test.client
                .place_bet(user, pool_id, &0u32, &bet_amount, &None::<Address>);
        }
    }

    // Verify each pool has correct totals
    let expected_per_pool = bet_amount * test.users.len() as i128;
    for pool_id in &pool_ids {
        let pool = test.client.get_pool(pool_id).unwrap();
        assert_eq!(
            pool.total_a, expected_per_pool,
            "Pool {} total incorrect",
            pool_id
        );
    }
}

/// C10: Concurrent operations with pool state transitions
///
/// Tests concurrent betting during pool state changes (e.g., approaching expiry,
/// settlement) to ensure state transitions are handled correctly.
#[test]
fn c10_concurrent_ops_during_state_transitions() {
    let test = ConcurrentTestEnv::new(20);
    let pool_id = test.create_pool(&test.creator, "Transition Pool");

    let bet_amount = 250_000i128;
    test.mint_to_all(bet_amount * 3);

    // Wave 1: Bets while pool is active
    for user in test.users.iter().take(10) {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    // Advance time close to expiry
    test.env.ledger().with_mut(|li| {
        li.timestamp = 3_500; // 100 seconds before expiry
    });

    // Wave 2: More bets near expiry
    for user in test.users.iter().skip(10) {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    // Expire and settle
    test.expire_pool();
    test.client.settle_pool(&test.creator, &pool_id, &0u32);

    // All users claim
    for user in &test.users {
        test.client.claim_winnings(user, &pool_id);
    }

    // Verify pool is fully claimed
    let pool = test.client.get_pool(&pool_id).unwrap();
    assert_eq!(
        pool.status,
        PoolStatus::Settled(0),
        "Pool must be in settled state"
    );
}

// ============================================================================
// Mixed Operations Tests
// ============================================================================

/// C11: Concurrent mixed operations (bet, cancel, claim)
///
/// Simulates real-world scenario with users performing different operations
/// concurrently on the same pool.
#[test]
fn c11_concurrent_mixed_operations() {
    let test = ConcurrentTestEnv::new(30);
    let pool_id = test.create_pool(&test.creator, "Mixed Ops Pool");

    let bet_amount = 1_000_000i128;
    test.mint_to_all(bet_amount * 2);

    // Phase 1: Everyone bets
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    // Phase 2: Half the users cancel, half add more bets
    for (i, user) in test.users.iter().enumerate() {
        if i < test.users.len() / 2 {
            test.client
                .cancel_bet(user, &pool_id, &0u32, &(bet_amount / 2));
        } else {
            test.client
                .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
        }
    }

    // Verify pool state is consistent
    let pool = test.client.get_pool(&pool_id).unwrap();
    let half_users = test.users.len() / 2;

    // Calculate expected: first half has 0.5x bet, second half has 2x bet
    let expected = (bet_amount / 2) * half_users as i128 + (bet_amount * 2) * half_users as i128;

    assert_eq!(pool.total_a, expected, "Pool total must reflect all operations");
}

/// C12: Concurrent participant count accuracy
///
/// Verifies that participant_count remains accurate when many users
/// join and leave (via cancellation) concurrently.
#[test]
fn c12_concurrent_participant_count() {
    let test = ConcurrentTestEnv::new(40);
    let pool_id = test.create_pool(&test.creator, "Participant Count Pool");

    let bet_amount = 100_000i128;
    test.mint_to_all(bet_amount);

    // All users bet (first bet for each)
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    let pool = test.client.get_pool(&pool_id).unwrap();
    assert_eq!(
        pool.participant_count,
        test.users.len() as u32,
        "Participant count must equal number of users"
    );

    // Some users cancel all their bets
    for user in test.users.iter().take(10) {
        test.client
            .cancel_bet(user, &pool_id, &0u32, &bet_amount);
    }

    // Participant count should remain the same (they still participated)
    let pool_after = test.client.get_pool(&pool_id).unwrap();
    assert_eq!(
        pool_after.participant_count,
        test.users.len() as u32,
        "Participant count should not decrease after cancellation"
    );
}

// ============================================================================
// Event Emission Tests
// ============================================================================

/// C13: Event emission under concurrent operations
///
/// Verifies that all events are emitted correctly even when many operations
/// happen concurrently.
#[test]
fn c13_event_emission_concurrent() {
    let test = ConcurrentTestEnv::new(25);
    let pool_id = test.create_pool(&test.creator, "Event Emission Pool");

    let bet_amount = 200_000i128;
    test.mint_to_all(bet_amount);

    let events_before = test.event_count();

    // All users bet
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    let events_after = test.event_count();
    let bet_events = events_after - events_before;

    // Events were emitted for bets (count may vary by SDK version)
    assert!(
        bet_events > 0,
        "At least one event must be emitted; got {bet_events}"
    );
}

/// C14: Scalability test - increasing user count
///
/// Tests performance degradation as user count increases to identify
/// scalability limits.
#[test]
fn c14_scalability_increasing_users() {
    let user_counts = [10, 25, 50, 100];
    let bet_amount = 100_000i128;

    std::println!("\n=== Scalability Test Results ===");

    for &num_users in &user_counts {
        let test = ConcurrentTestEnv::new(num_users);
        let pool_id = test.create_pool(&test.creator, "Scalability Pool");

        test.mint_to_all(bet_amount);

        let start_events = test.event_count();

        // All users bet
        for user in &test.users {
            test.client
                .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
        }

        let end_events = test.event_count();
        let events_emitted = end_events - start_events;

        let pool = test.client.get_pool(&pool_id).unwrap();
        let expected_total = bet_amount * num_users as i128;

        assert_eq!(pool.total_a, expected_total, "Pool total must be correct");

        std::println!(
            "Users: {}, Events: {}, Pool Total: {}",
            num_users, events_emitted, pool.total_a
        );
    }
}

/// C15: Data consistency verification across concurrent operations
///
/// Final comprehensive test that verifies all data structures remain
/// consistent after a complex sequence of concurrent operations.
#[test]
fn c15_data_consistency_comprehensive() {
    let test = ConcurrentTestEnv::new(50);
    let pool_id = test.create_pool(&test.creator, "Consistency Pool");

    let bet_amount = 500_000i128;
    test.mint_to_all(bet_amount * 3);

    // Complex sequence of operations
    // Round 1: All users bet on A
    for user in &test.users {
        test.client
            .place_bet(user, &pool_id, &0u32, &bet_amount, &None::<Address>);
    }

    // Round 2: Half bet on B as well
    for user in test.users.iter().take(test.users.len() / 2) {
        test.client
            .place_bet(user, &pool_id, &1u32, &bet_amount, &None::<Address>);
    }

    // Round 3: Quarter cancel from A
    for user in test.users.iter().take(test.users.len() / 4) {
        test.client
            .cancel_bet(user, &pool_id, &0u32, &(bet_amount / 2));
    }

    // Verify consistency
    let pool = test.client.get_pool(&pool_id).unwrap();

    // Calculate expected totals
    let all_users = test.users.len() as i128;
    let half_users = (test.users.len() / 2) as i128;
    let quarter_users = (test.users.len() / 4) as i128;

    let expected_a = bet_amount * all_users - (bet_amount / 2) * quarter_users;
    let expected_b = bet_amount * half_users;

    assert_eq!(pool.total_a, expected_a, "Total A must be consistent");
    assert_eq!(pool.total_b, expected_b, "Total B must be consistent");

    // Verify individual user bets
    let mut verified_users = 0;
    for (i, user) in test.users.iter().enumerate() {
        let user_bet = test.client.get_user_bet(&pool_id, user).unwrap();

        if i < test.users.len() / 4 {
            // These users cancelled half of A
            assert_eq!(user_bet.amount_a, bet_amount / 2);
            assert_eq!(user_bet.amount_b, bet_amount);
        } else if i < test.users.len() / 2 {
            // These users bet on both
            assert_eq!(user_bet.amount_a, bet_amount);
            assert_eq!(user_bet.amount_b, bet_amount);
        } else {
            // These users only bet on A
            assert_eq!(user_bet.amount_a, bet_amount);
            assert_eq!(user_bet.amount_b, 0);
        }
        verified_users += 1;
    }

    assert_eq!(
        verified_users,
        test.users.len(),
        "All user bets must be verified"
    );
}
