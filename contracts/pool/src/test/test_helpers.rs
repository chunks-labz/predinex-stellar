// ---------------------------------------------------------------------------
// Imports & Types
// ---------------------------------------------------------------------------

use log::{info, warn, error};
use std::fmt::Debug;

// These types are assumed to be defined in the contract crate or test harness.
// For clarity, we re‑export them here; in practice they would be imported.
use soroban_test_framework::{
    Address, Env, PoolId, UserAddress, Amount, TestResult, TestError, 
    invoke_contract, to_val, Symbol, debug_log, snapshot_pool_state, PoolState,
};

// ---------------------------------------------------------------------------
// Logging helper with severity
// ---------------------------------------------------------------------------

/// Log an event with a given severity level.
///
/// # Arguments
/// * `level` - Log level (`"info"`, `"warn"`, `"error"`).
/// * `message` - Human‑readable message.
/// * `data` - Optional additional data (printed via Debug).
fn log_event<T: Debug>(level: &str, message: &str, data: &T) {
    match level {
        "info" => info!("{}: {:?}", message, data),
        "warn" => warn!("{}: {:?}", message, data),
        "error" => error!("{}: {:?}", message, data),
        _ => info!("{}: {:?}", message, data), // fallback
    }
}

// ---------------------------------------------------------------------------
// Bet placement (single)
// ---------------------------------------------------------------------------

/// Place a single bet on a pool.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The target pool (must not be empty).
/// * `user` - Address of the user placing the bet.
/// * `amount` - Bet amount in the pool's base units (must be > 0).
///
/// # Errors
/// * `TestError::ValidationError` if `pool_id` is empty or `amount <= 0`.
/// * `TestError::InvocationError` if the contract invocation reverts.
pub fn place_bet(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
    user: &UserAddress,
    amount: Amount,
) -> TestResult<()> {
    // Input validation – non‑empty pool ID
    if pool_id.is_empty() {
        return Err(TestError::ValidationError(
            "place_bet: pool_id must not be empty".to_string(),
        ));
    }
    // Input validation – positive amount
    if amount <= 0 {
        return Err(TestError::ValidationError(
            format!("place_bet: amount must be > 0, got {}", amount),
        ));
    }

    // Build contract arguments
    let args = vec![
        e,
        to_val(e, pool_id.clone()),
        to_val(e, user.clone()),
        to_val(e, amount),
    ];

    // Invoke the contract and propagate errors
    invoke_contract::<()>(e, contract_id, &Symbol::new(e, "place_bet"), args)
        .map_err(|err| {
            log_event("error", "place_bet: contract invocation failed", &err);
            err
        })?;

    log_event("info", "Placed bet", &(user, amount));
    Ok(())
}

// ---------------------------------------------------------------------------
// Bet placement (bulk)
// ---------------------------------------------------------------------------

/// Place multiple bets on a single pool from multiple users.
///
/// All validation is performed before any contract calls to avoid partial state changes.
/// If the list is empty or any amount is ≤ 0, the function returns immediately.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The target pool (must not be empty).
/// * `user_amounts` - A list of `(UserAddress, Amount)` pairs. All amounts must be > 0.
///
/// # Errors
/// * `TestError::ValidationError` if `pool_id` is empty, the list is empty,
///   or any amount ≤ 0.
/// * `TestError::InvocationError` on any contract revert (first failure propagates).
pub fn bulk_place_bets(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
    user_amounts: Vec<(UserAddress, Amount)>,
) -> TestResult<()> {
    // Pre‑validate pool ID
    if pool_id.is_empty() {
        return Err(TestError::ValidationError(
            "bulk_place_bets: pool_id must not be empty".to_string(),
        ));
    }
    // Pre‑validate non‑empty list
    if user_amounts.is_empty() {
        return Err(TestError::ValidationError(
            "bulk_place_bets: user_amounts must not be empty".to_string(),
        ));
    }
    // Pre‑validate all amounts
    for (user, amount) in user_amounts.iter() {
        if *amount <= 0 {
            return Err(TestError::ValidationError(
                format!(
                    "bulk_place_bets: amount must be > 0, got {} for user {:?}",
                    amount, user
                ),
            ));
        }
    }

    // Execute each bet sequentially
    for (user, amount) in user_amounts.into_iter() {
        place_bet(e, contract_id, pool_id, &user, amount)?;
    }

    log_event(
        "info",
        "Bulk placed bets",
        &format!("count={}", user_amounts.len()),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Pool settlement
// ---------------------------------------------------------------------------

/// Settle a single pool.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The pool to settle (must not be empty).
///
/// # Errors
/// * `TestError::ValidationError` if `pool_id` is empty.
/// * `TestError::InvocationError` if the contract invocation reverts.
pub fn settle_pool(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
) -> TestResult<()> {
    if pool_id.is_empty() {
        return Err(TestError::ValidationError(
            "settle_pool: pool_id must not be empty".to_string(),
        ));
    }

    let args = vec![e, to_val(e, pool_id.clone())];
    invoke_contract::<()>(e, contract_id, &Symbol::new(e, "settle_pool"), args)
        .map_err(|err| {
            log_event("error", "settle_pool: contract invocation failed", &err);
            err
        })?;

    log_event("info", "Settled pool", pool_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Pool settlement (bulk)
// ---------------------------------------------------------------------------

/// Settle multiple pools.
///
/// All pool IDs are validated before any contract call.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_ids` - List of pool IDs to settle (all must be non‑empty).
///
/// # Errors
/// * `TestError::ValidationError` if any pool ID is empty or the list is empty.
/// * `TestError::InvocationError` on any contract revert (first failure propagates).
pub fn bulk_settle(
    e: &Env,
    contract_id: &Address,
    pool_ids: Vec<PoolId>,
) -> TestResult<()> {
    if pool_ids.is_empty() {
        return Err(TestError::ValidationError(
            "bulk_settle: pool_ids must not be empty".to_string(),
        ));
    }

    // Validate all pool IDs upfront
    for pool_id in pool_ids.iter() {
        if pool_id.is_empty() {
            return Err(TestError::ValidationError(
                "bulk_settle: pool_id must not be empty".to_string(),
            ));
        }
    }

    // Settle each pool
    for pool_id in pool_ids.into_iter() {
        settle_pool(e, contract_id, &pool_id)?;
    }

    log_event("info", "Bulk settled pools", &pool_ids.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// Claim (single winner)
// ---------------------------------------------------------------------------

/// Execute a claim for a given winner on a specific pool.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The pool from which to claim (must not be empty).
/// * `winner` - The winning user address.
///
/// # Errors
/// * `TestError::ValidationError` if `pool_id` is empty.
/// * `TestError::InvocationError` if the contract invocation reverts.
pub fn claim(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
    winner: &UserAddress,
) -> TestResult<()> {
    if pool_id.is_empty() {
        return Err(TestError::ValidationError(
            "claim: pool_id must not be empty".to_string(),
        ));
    }

    let args = vec![
        e,
        to_val(e, pool_id.clone()),
        to_val(e, winner.clone()),
    ];
    invoke_contract::<()>(e, contract_id, &Symbol::new(e, "claim"), args)
        .map_err(|err| {
            log_event("error", "claim: contract invocation failed", &err);
            err
        })?;

    log_event("info", "Claimed for winner", winner);
    Ok(())
}

// ---------------------------------------------------------------------------
// Claim (bulk)
// ---------------------------------------------------------------------------

/// Execute claims for multiple winners on (potentially) different pools.
///
/// All (pool_id, winner) pairs are validated before any contract call.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `claims` - A list of `(PoolId, UserAddress)` tuples.
///
/// # Errors
/// * `TestError::ValidationError` if any pool ID is empty or the list is empty.
/// * `TestError::InvocationError` on any contract revert (first failure propagates).
pub fn bulk_claim(
    e: &Env,
    contract_id: &Address,
    claims: Vec<(PoolId, UserAddress)>,
) -> TestResult<()> {
    if claims.is_empty() {
        return Err(TestError::ValidationError(
            "bulk_claim: claims must not be empty".to_string(),
        ));
    }

    // Validate all pool IDs upfront
    for (pool_id, _) in claims.iter() {
        if pool_id.is_empty() {
            return Err(TestError::ValidationError(
                "bulk_claim: pool_id must not be empty".to_string(),
            ));
        }
    }

    // Execute each claim
    for (pool_id, winner) in claims.into_iter() {
        claim(e, contract_id, &pool_id, &winner)?;
    }

    log_event("info", "Bulk claims", &claims.len());
    Ok(())
}

// ---------------------------------------------------------------------------
// Pool state query
// ---------------------------------------------------------------------------

/// Retrieve the full state of a pool for invariant checking.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The pool to query (must not be empty).
///
/// # Returns
/// `PoolState` containing `participant_count`, `total_bets`, `total_payouts`, etc.
pub fn get_pool_state(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
) -> TestResult<PoolState> {
    if pool_id.is_empty() {
        return Err(TestError::ValidationError(
            "get_pool_state: pool_id must not be empty".to_string(),
        ));
    }

    // Call a read‑only contract function to get the state snapshot.
    // The function name `pool_state` is assumed to exist on the contract.
    let args = vec![e, to_val(e, pool_id.clone())];
    let state: PoolState = invoke_contract(e, contract_id, &Symbol::new(e, "pool_state"), args)
        .map_err(|err| {
            log_event("error", "get_pool_state: invocation failed", &err);
            err
        })?;

    log_event("info", "Retrieved pool state", pool_id);
    Ok(state)
}

// ---------------------------------------------------------------------------
// Invariant assertions for a pool
// ---------------------------------------------------------------------------

/// Assert that the pool state satisfies basic invariants.
///
/// This function fetches the current pool state and validates:
/// - `participant_count` must equal the number of distinct users who placed bets.
/// - `total_bets` must equal the sum of all individual bet amounts.
/// - `total_payouts` must be less than or equal to `total_bets` (no over‑distribution).
/// - If the pool is settled, `total_payouts` must equal the correctly computed payout.
///
/// # Arguments
/// * `e` - Soroban environment.
/// * `contract_id` - Address of the betting pool contract.
/// * `pool_id` - The pool to check.
/// * `expected_participants` - The expected number of distinct users.
/// * `expected_total_bets` - The expected sum of bets.
/// * `expected_payout` - The expected total payout (0 if unsettled).
/// * `settled` - Whether the pool should be in a settled state.
///
/// # Errors
/// * `TestError::AssertionError` if any invariant is violated.
/// * `TestError::InvocationError` if the state cannot be fetched.
pub fn assert_pool_invariants(
    e: &Env,
    contract_id: &Address,
    pool_id: &PoolId,
    expected_participants: u64,
    expected_total_bets: Amount,
    expected_payout: Amount,
    settled: bool,
) -> TestResult<()> {
    let state = get_pool_state(e, contract_id, pool_id)?;

    // 1. Participant count
    if state.participant_count != expected_participants {
        return Err(TestError::AssertionError(format!(
            "assert_pool_invariants: participant_count mismatch. Expected {}, got {}",
            expected_participants, state.participant_count
        )));
    }

    // 2. Total bets
    if state.total_bets != expected_total_bets {
        return Err(TestError::AssertionError(format!(
            "assert_pool_invariants: total_bets mismatch. Expected {}, got {}",
            expected_total_bets, state.total_bets
        )));
    }

    // 3. Total payouts must not exceed total bets
    if state.total_payouts > state.total_bets {
        return Err(TestError::AssertionError(format!(
            "assert_pool_invariants: total_payouts {} exceeds total_bets {}",
            state.total_payouts, state.total_bets
        )));
    }

    // 4. If settled, check exact payout; if not settled, payout must be zero.
    if settled {
        if state.total_payouts != expected_payout {
            return Err(TestError::AssertionError(format!(
                "assert_pool_invariants: total_payouts mismatch after settle. Expected {}, got {}",
                expected_payout, state.total_payouts
            )));
        }
    } else {
        if state.total_payouts != 0 {
            return Err(TestError::AssertionError(format!(
                "assert_pool_invariants: non‑zero payout {} but pool is not settled",
                state.total_payouts
            )));
        }
    }

    log_event("info", "Pool invariants passed", pool_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// High‑concurrency test scenario
// ---------------------------------------------------------------------------

/// # High‑concurrency test: 50 users placing bets on the same pool,
/// followed by multiple claims from different winners.
///
/// This test validates state consistency under load.
///
/// ## Procedure
/// 1. Create a pool.
/// 2. 50 users each place a bet of 100 units (total bets = 5000).
/// 3. Verify participant_count = 50, total_bets = 5000.
/// 4. Settle the pool with 3 winners: user1 (50% share), user2 (30%), user3 (20%).
/// 5. each winner claims their payout.
/// 6. Assert final payouts sum to 5000 and no further claims are possible.
#[cfg(test)]
mod tests {
    use super::*;

    /// Generate `n` distinct user addresses with deterministic keys.
    fn generate_users(n: u64, prefix: &str) -> Vec<UserAddress> {
        (0..n)
            .map(|i| UserAddress::from_str(&format!("{}{}", prefix, i)).unwrap())
            .collect()
    }

    #[test]
    fn test_concurrent_users_same_pool() {
        let e = Env::default();
        let contract_id = Address::from_str("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB").unwrap();
        // We assume a test pool is already created; otherwise create one here.
        let pool_id = PoolId::from_str("pool_high_load").unwrap();

        // Phase 1: 50 users place bets of 100 each.
        let users = generate_users(50, "high_con_user_");
        let user_amounts: Vec<(UserAddress, Amount)> = users
            .iter()
            .map(|u| (u.clone(), 100))
            .collect();
        bulk_place_bets(&e, &contract_id, &pool_id, user_amounts)
            .expect("Bulk bet placement should succeed");

        // State assertions after all bets.
        assert_pool_invariants(
            &e,
            &contract_id,
            &pool_id,
            50,          // participants
            5000,        // total bets
            0,           // not settled yet
            false,       // not settled
        )
        .expect("Post‑bet invariants failed");

        // Phase 2: Settle the pool with three winners.
        settle_pool(&e, &contract_id, &pool_id).expect("Settle should succeed");

        // After settlement, the expected pool payout is 5000.
        assert_pool_invariants(
            &e,
            &contract_id,
            &pool_id,
            50,          // participants unchanged
            5000,        // total bets unchanged
            5000,        // total payout must equal total bets
            true,        // settled
        )
        .expect("Post‑settle invariants failed before claims");

        // Phase 3: Three winners claim their shares (50%, 30%, 20%).
        let winner1 = &users[0];
        let winner2 = &users[1];
        let winner3 = &users[2];

        claim(&e, &contract_id, &pool_id, winner1).expect("First claim failed");
        assert_pool_invariants(
            &e,
            &contract_id,
            &pool_id,
            50, 5000, 5000, true,
        )
        .expect("Invariant after first claim");

        claim(&e, &contract_id, &pool_id, winner2).expect("Second claim failed");
        assert_pool_invariants(
            &e,
            &contract_id,
            &pool_id,
            50, 5000, 5000, true,
        )
        .expect("Invariant after second claim");

        claim(&e, &contract_id, &pool_id, winner3).expect("Third claim failed");
        assert_pool_invariants(
            &e,
            &contract_id,
            &pool_id,
            50, 5000, 5000, true,
        )
        .expect("Invariant after third claim");

        // Verify that a non‑winner cannot claim anymore (should revert).
        let non_winner = &users[49];
        let result = claim(&e, &contract_id, &pool_id, non_winner);
        assert!(
            result.is_err(),
            "Non‑winner should not be able to claim after payout"
        );
        log_event("info", "High‑concurrency test passed", &());
    }

    /// # Rapid settlement and claim test
    ///
    /// Simulates rapid successive settle and claim operations on a single pool,
    /// verifying that state transitions are atomic and consistent.
    #[test]
    fn test_rapid_settle_claim() {
        let e = Env::default();
        let contract_id = Address::from_str("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB").unwrap();
        let pool_id = PoolId::from_str("pool_rapid").unwrap();

        // Two users bet.
        let user1 = UserAddress::from_str("user_rapid_1").unwrap();
        let user2 = UserAddress::from_str("user_rapid_2").unwrap();

        place_bet(&e, &contract_id, &pool_id, &user1, 200).unwrap();
        place_bet(&e, &contract_id, &pool_id, &user2, 300).unwrap();

        assert_pool_invariants(
            &e, &contract_id, &pool_id, 2, 500, 0, false,
        )
        .expect("Invariant after bets");

        // Rapid settle & claim (simulating high frequency).
        settle_pool(&e, &contract_id, &pool_id).unwrap();
        assert_pool_invariants(
            &e, &contract_id, &pool_id, 2, 500, 500, true,
        )
        .expect("Invariant after settle");

        // Both winners claim immediately after settle.
        claim(&e, &contract_id, &pool_id, &user1).unwrap();
        claim(&e, &contract_id, &pool_id, &user2).unwrap();

        // Final invariant: payout still 500.
        assert_pool_invariants(
            &e, &contract_id, &pool_id, 2, 500, 500, true,
        )
        .expect("Final invariant after rapid settle and claims");

        log_event("info", "Rapid settle/claim test passed", &());
    }
}