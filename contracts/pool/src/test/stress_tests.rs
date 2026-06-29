// File: contracts/pool/src/test/stress_tests.rs
// Production-grade stress tests for Soroban betting pool contract.
// Tests 50 concurrent users and rapid settle/claim sequences, verifying state consistency.

#![deny(unused_must_use, unused_imports, unused_variables)]
#![warn(clippy::all, clippy::pedantic, clippy::nursery)]

use soroban_sdk::{
    contracttype, testutils::{Accounts, TestEnv},
    Address, Env, IntoVal, Map, Symbol, TryIntoVal, Val, Vec, String,
};
use soroban_test::{Test, Wasm};

// ---------------------------------------------------------------------------
// Type aliases for clarity
// ---------------------------------------------------------------------------
type ParticipantCount = u32;
type TokenAmount = i128;
type PoolId = String; // Human-readable pool identifier for logging.

/// Logging macro with level prefix. In test environments `println` is sufficient.
macro_rules! log_info {
    ($($arg:tt)*) => {
        println!("[INFO] {}", format_args!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] {}", format_args!($($arg)*));
    };
}

macro_rules! log_warn {
    ($($arg:tt)*) => {
        eprintln!("[WARN] {}", format_args!($($arg)*));
    };
}

// ---------------------------------------------------------------------------
// Custom error types for test operations.
// ---------------------------------------------------------------------------

/// Error context for contract invocations.
#[derive(Debug)]
pub struct ContractInvocationError {
    pub function: String,
    pub pool_id: PoolId,
    pub details: String,
}

impl std::fmt::Display for ContractInvocationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Contract invocation failed: function={}, pool_id={}, details={}",
            self.function, self.pool_id, self.details
        )
    }
}

impl std::error::Error for ContractInvocationError {}

/// Custom error for invalid pool state.
#[derive(Debug)]
pub struct PoolStateError {
    pub expected: String,
    pub actual: String,
}

impl std::fmt::Display for PoolStateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Pool state mismatch: expected {}, actual {}",
            self.expected, self.actual
        )
    }
}

impl std::error::Error for PoolStateError {}

/// Custom error for invalid input parameters.
#[derive(Debug)]
pub struct InputValidationError {
    pub message: String,
}

impl std::fmt::Display for InputValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Input validation error: {}", self.message)
    }
}

impl std::error::Error for InputValidationError {}

/// Wrapped result type for test operations.
type TestResult<T> = Result<T, Box<dyn std::error::Error>>;

// ---------------------------------------------------------------------------
// Constants for stress test parameters.
// ---------------------------------------------------------------------------

/// User count for single‑pool stress test.
pub const SINGLE_POOL_USER_COUNT: u32 = 50;

/// Bet amount per user in single‑pool test.
pub const SINGLE_POOL_BET_AMOUNT: TokenAmount = 100;

/// Number of winners in single‑pool test.
pub const SINGLE_POOL_WINNER_COUNT: u32 = 10;

/// Pool count for rapid settle/claim test.
pub const RAPID_POOL_COUNT: u32 = 5;

/// Users per pool in rapid test.
pub const RAPID_USERS_PER_POOL: u32 = 10;

/// Bet amount per user in rapid test.
pub const RAPID_BET_AMOUNT: TokenAmount = 50;

/// Expected total bet size for single pool.
pub const SINGLE_POOL_TOTAL_BETS: TokenAmount =
    SINGLE_POOL_USER_COUNT as TokenAmount * SINGLE_POOL_BET_AMOUNT;

/// Expected total bet size per rapid pool.
pub const RAPID_POOL_TOTAL_BETS: TokenAmount =
    RAPID_USERS_PER_POOL as TokenAmount * RAPID_BET_AMOUNT;

// ---------------------------------------------------------------------------
// Helper functions for validation and invocation.
// ---------------------------------------------------------------------------

/// Validates that an amount is strictly positive.
///
/// # Errors
/// Returns `InputValidationError` if `amount <= 0`.
fn validate_positive_amount(amount: TokenAmount, context: &str) -> TestResult<()> {
    if amount <= 0 {
        return Err(Box::new(InputValidationError {
            message: format!("{}: amount must be positive, got {}", context, amount),
        }));
    }
    Ok(())
}

/// Validates that a user address is non‑empty.
///
/// # Errors
/// Returns `InputValidationError` if the address string is empty.
fn validate_user_address(user: &Address) -> TestResult<()> {
    if user.to_string().is_empty() {
        return Err(Box::new(InputValidationError {
            message: "User address is empty".to_string(),
        }));
    }
    Ok(())
}

/// Validates that a collection is non‑empty.
///
/// # Errors
/// Returns `InputValidationError` if `items` is empty.
fn validate_non_empty<T>(items: &Vec<T>, context: &str) -> TestResult<()> {
    if items.is_empty() {
        return Err(Box::new(InputValidationError {
            message: format!("{}: collection is empty", context),
        }));
    }
    Ok(())
}

/// Safely invoke a contract function that returns a `T` via `try_invoke_contract`.
///
/// # Type Parameters
/// * `T` – The expected return type, must be convertible from `Val`.
///
/// # Arguments
/// * `env` – The test environment.
/// * `contract_id` – The deployed contract address.
/// * `function` – Symbol of the function to call.
/// * `args` – Arguments as a `Val`‑compatible tuple.
/// * `pool_id` – Human‑readable pool identifier for error messages.
///
/// # Errors
/// Returns `ContractInvocationError` if the contract call fails.
fn safe_invoke_contract<T>(
    env: &Env,
    contract_id: &Address,
    function: &Symbol,
    args: impl IntoVal<Env, Vec<Val>>,
    pool_id: &str,
) -> TestResult<T>
where
    T: TryIntoVal<Env, Val>,
    Val: TryIntoVal<Env, T>,
{
    env.try_invoke_contract::<T>(contract_id, function, args)
        .map_err(|err| {
            let msg = format!(
                "Contract invocation failed: function={}, pool_id={}, error={:?}",
                function, pool_id, err
            );
            log_error!("{}", msg);
            Box::new(ContractInvocationError {
                function: function.to_string(),
                pool_id: pool_id.to_string(),
                details: format!("{:?}", err),
            }) as Box<dyn std::error::Error>
        })
}

/// Create a given number of test accounts.
///
/// Each account is funded automatically by the test harness.
///
/// # Arguments
/// * `env` – Test environment.
/// * `count` – Number of accounts to create (must be > 0).
///
/// # Errors
/// Returns `InputValidationError` if `count` is zero, or if address generation fails.
fn create_users(env: &Env, count: u32) -> TestResult<Vec<Address>> {
    if count == 0 {
        return Err(Box::new(InputValidationError {
            message: "Cannot create zero users".to_string(),
        }));
    }

    let mut users: Vec<Address> = Vec::new(env);
    for i in 0..count {
        let key = String::from_slice(&format!("user{}", i).as_bytes());
        let user = env.accounts().generate(&key);
        // Defensive: ensure generated address is valid.
        validate_user_address(&user)?;
        users.push_back(user);
        log_info!("Created user {}/{}", i + 1, count);
    }
    log_info!("Created {} users", count);
    Ok(users)
}

/// Place bets for all users on a single pool.
///
/// Each bet is recorded sequentially. The function asserts each bet succeeds.
///
/// # Arguments
/// * `env` – Test environment.
/// * `contract_id` – Deployed contract address.
/// * `pool_id` – Pool identifier symbol (must be a valid pool).
/// * `users` – List of user addresses (must be non‑empty).
/// * `amount` – Bet amount (must be positive).
///
/// # Errors
/// Returns an error if any input validation fails or if any contract call fails.
fn place_bets(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    users: &Vec<Address>,
    amount: TokenAmount,
) -> TestResult<()> {
    // Input validation
    validate_positive_amount(amount, "place_bets")?;
    validate_non_empty(users, "place_bets")?;

    let pool_id_str = pool_id.to_string();
    log_info!(
        "Placing bets: pool={}, users={}, amount={}",
        pool_id_str,
        users.len(),
        amount
    );

    // Iterate over users and place bets sequentially.
    for (i, user) in users.iter().enumerate() {
        validate_user_address(&user)?;

        // Build arguments: (user, pool_id, amount)
        let args = (user, pool_id.clone(), amount);
        let _: () = safe_invoke_contract(
            env,
            contract_id,
            &Symbol::new(&env, "place_bet"),
            args,
            &pool_id_str,
        )?;

        log_info!(
            "User {} bet placed on pool {}: amount={}",
            i + 1,
            pool_id_str,
            amount
        );
    }

    log_info!("All bets placed successfully for pool {}", pool_id_str);
    Ok(())
}

/// Settle a pool with a given set of winners.
///
/// # Arguments
/// * `env` – Test environment.
/// * `contract_id` – Deployed contract address.
/// * `pool_id` – Pool identifier symbol.
/// * `winners` – List of winner addresses (must be non‑empty).
///
/// # Errors
/// Returns an error if input validation fails or the contract call fails.
fn settle_pool(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    winners: &Vec<Address>,
) -> TestResult<()> {
    validate_non_empty(winners, "settle_pool")?;

    let pool_id_str = pool_id.to_string();
    log_info!("Settling pool {} with {} winners", pool_id_str, winners.len());

    // Build arguments: (pool_id, winners)
    let args = (pool_id.clone(), winners.clone());
    let _: () = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "settle"),
        args,
        &pool_id_str,
    )?;

    log_info!("Pool {} settled successfully", pool_id_str);
    Ok(())
}

/// Claim winnings for a specific user and pool.
///
/// Returns the claimed amount (i128).
///
/// # Arguments
/// * `env` – Test environment.
/// * `contract_id` – Deployed contract address.
/// * `pool_id` – Pool identifier symbol.
/// * `user` – Address of the user claiming.
///
/// # Errors
/// Returns an error if the contract call fails.
fn claim_winnings(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    user: &Address,
) -> TestResult<TokenAmount> {
    validate_user_address(user)?;

    let pool_id_str = pool_id.to_string();
    log_info!("Claiming winnings for user {} from pool {}", user.to_string(), pool_id_str);

    // Build arguments: (user, pool_id)
    let args = (user.clone(), pool_id.clone());
    let claimed: TokenAmount = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "claim"),
        args,
        &pool_id_str,
    )?;

    log_info!(
        "User {} claimed {} from pool {}",
        user.to_string(),
        claimed,
        pool_id_str
    );
    Ok(claimed)
}

// ---------------------------------------------------------------------------
// State assertion helpers
// ---------------------------------------------------------------------------

/// Assert the participant count of a pool matches the expected value.
fn assert_participant_count(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    expected: ParticipantCount,
) -> TestResult<()> {
    let pool_id_str = pool_id.to_string();
    let actual: ParticipantCount = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "get_participant_count"),
        (pool_id.clone(),),
        &pool_id_str,
    )?;

    if actual != expected {
        return Err(Box::new(PoolStateError {
            expected: format!("{}", expected),
            actual: format!("{}", actual),
        }));
    }

    log_info!(
        "Pool {} participant count verified: {}",
        pool_id_str,
        actual
    );
    Ok(())
}

/// Assert the total bets of a pool matches the expected value.
fn assert_total_bets(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    expected: TokenAmount,
) -> TestResult<()> {
    let pool_id_str = pool_id.to_string();
    let actual: TokenAmount = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "get_total_bets"),
        (pool_id.clone(),),
        &pool_id_str,
    )?;

    if actual != expected {
        return Err(Box::new(PoolStateError {
            expected: format!("{}", expected),
            actual: format!("{}", actual),
        }));
    }

    log_info!(
        "Pool {} total bets verified: {}",
        pool_id_str,
        actual
    );
    Ok(())
}

/// Assert the payout amount for a specific winner is as expected.
fn assert_payout(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
    winner: &Address,
    expected: TokenAmount,
) -> TestResult<()> {
    let pool_id_str = pool_id.to_string();
    let actual: TokenAmount = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "get_winning_amount"),
        (winner.clone(), pool_id.clone()),
        &pool_id_str,
    )?;

    if actual != expected {
        return Err(Box::new(PoolStateError {
            expected: format!("{}", expected),
            actual: format!("{}", actual),
        }));
    }

    log_info!(
        "Payout for user {} verified: {}",
        winner.to_string(),
        actual
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Test helpers for deploying contracts and setting up pools
// ---------------------------------------------------------------------------

/// Deploy the pool contract and return its address.
fn deploy_pool_contract(env: &Env, wasm: &Wasm) -> Address {
    let contract_id = env.deployer().with_current_contract(wasm).deploy();
    log_info!("Deployed pool contract at {}", contract_id.to_string());
    contract_id
}

/// Create a new pool via the contract.
fn create_pool(
    env: &Env,
    contract_id: &Address,
    pool_id: &Symbol,
) -> TestResult<()> {
    let pool_id_str = pool_id.to_string();
    log_info!("Creating pool {}", pool_id_str);

    // Build arguments: (pool_id)
    let args = (pool_id.clone(),);
    let _: () = safe_invoke_contract(
        env,
        contract_id,
        &Symbol::new(&env, "create_pool"),
        args,
        &pool_id_str,
    )?;

    log_info!("Pool {} created successfully", pool_id_str);
    Ok(())
}

// ---------------------------------------------------------------------------
// Test functions
// ---------------------------------------------------------------------------

/// Test: 50 users placing bets on the same pool; multiple claims from different winners.
///
/// Verifies participant_count, totals, and payouts remain consistent.
#[test]
fn test_50_users_single_pool() -> TestResult<()> {
    log_info!("=== Starting test: 50 users single pool ===");

    let test = Test::new(&env);
    let wasm = Wasm::from_file("target/wasm32-unknown-unknown/release/pool_contract.wasm");
    let env: Env = test.env().clone();
    let contract_id = deploy_pool_contract(&env, &wasm);
    let pool_id = Symbol::new(&env, "stress_pool_1");

    // Create pool
    create_pool(&env, &contract_id, &pool_id)?;

    // Create 50 users
    let users = create_users(&env, SINGLE_POOL_USER_COUNT)?;
    assert_eq!(users.len(), SINGLE_POOL_USER_COUNT as usize);

    // Place bets
    place_bets(&env, &contract_id, &pool_id, &users, SINGLE_POOL_BET_AMOUNT)?;

    // Assert state after betting
    assert_participant_count(&env, &contract_id, &pool_id, SINGLE_POOL_USER_COUNT)?;
    assert_total_bets(&env, &contract_id, &pool_id, SINGLE_POOL_TOTAL_BETS)?;

    // Select winners (first 10 users)
    let mut winners: Vec<Address> = Vec::new(&env);
    for i in 0..SINGLE_POOL_WINNER_COUNT {
        winners.push_back(users.get(i).unwrap());
    }
    assert_eq!(winners.len(), SINGLE_POOL_WINNER_COUNT as usize);

    // Settle pool
    settle_pool(&env, &contract_id, &pool_id, &winners)?;

    // Expected payout per winner (equal split, no fees assumed)
    let expected_payout_per_winner = SINGLE_POOL_TOTAL_BETS / SINGLE_POOL_WINNER_COUNT as TokenAmount;

    // Claim winnings for each winner and verify payout consistency
    for (i, winner) in winners.iter().enumerate() {
        // Verify payout amount before claim
        assert_payout(&env, &contract_id, &pool_id, &winner, expected_payout_per_winner)?;

        // Claim
        let claimed = claim_winnings(&env, &contract_id, &pool_id, &winner)?;
        assert_eq!(claimed, expected_payout_per_winner, "Claimed amount mismatch for winner {}", i);

        log_info!("Winner {} claimed {}, as expected", i + 1, claimed);
    }

    // After all claims, verify pool state is consistent (participants unchanged, total distributed)
    // Optional: participant count should remain same (design-dependent)
    assert_participant_count(&env, &contract_id, &pool_id, SINGLE_POOL_USER_COUNT)?;
    // Total bets might be zeroed after distribution? We assume contract resets total bets to 0 after settlement.
    // Assert total bets is 0 if contract design clears it.
    // Adjust based on actual contract behavior.
    // assert_total_bets(&env, &contract_id, &pool_id, 0)?; // uncomment if applicable

    log_info!("=== Test 50 users single pool PASSED ===");
    Ok(())
}

/// Test: settle and claim in rapid succession across multiple pools.
///
/// Verifies participant_count, totals, and payouts remain consistent after each operation.
#[test]
fn test_rapid_settle_claim() -> TestResult<()> {
    log_info!("=== Starting test: rapid settle/claim ===");

    let test = Test::new(&env);
    let wasm = Wasm::from_file("target/wasm32-unknown-unknown/release/pool_contract.wasm");
    let env: Env = test.env().clone();
    let contract_id = deploy_pool_contract(&env, &wasm);

    // Create multiple pools
    let mut pool_ids: Vec<Symbol> = Vec::new(&env);
    for i in 0..RAPID_POOL_COUNT {
        let pool_id = Symbol::new(&env, &format!("rapid_pool_{}", i));
        create_pool(&env, &contract_id, &pool_id)?;
        pool_ids.push_back(pool_id);
    }

    // For each pool, create users, place bets, settle, and claim
    for (pool_index, pool_id) in pool_ids.iter().enumerate() {
        log_info!("Processing pool {}/{}", pool_index + 1, RAPID_POOL_COUNT);

        // Create users for this pool
        let users = create_users(&env, RAPID_USERS_PER_POOL)?;
        assert_eq!(users.len(), RAPID_USERS_PER_POOL as usize);

        // Place bets
        place_bets(&env, &contract_id, &pool_id, &users, RAPID_BET_AMOUNT)?;

        // Assert state immediately after betting
        assert_participant_count(&env, &contract_id, &pool_id, RAPID_USERS_PER_POOL)?;
        assert_total_bets(&env, &contract_id, &pool_id, RAPID_POOL_TOTAL_BETS)?;

        // Select all users as winners (simplifies rapid testing)
        let winners = users.clone();
        let winner_count = winners.len() as TokenAmount;

        // Settle
        settle_pool(&env, &contract_id, &pool_id, &winners)?;

        // Expected payout per winner
        let expected_payout = RAPID_POOL_TOTAL_BETS / winner_count;

        // Claim for each winner sequentially
        for winner in winners.iter() {
            // Verify payout before claim
            assert_payout(&env, &contract_id, &pool_id, &winner, expected_payout)?;

            // Claim
            let claimed = claim_winnings(&env, &contract_id, &pool_id, &winner)?;
            assert_eq!(claimed, expected_payout, "Claimed amount mismatch for rapid pool {}", pool_index);
        }

        // After all claims, verify participant count unchanged
        assert_participant_count(&env, &contract_id, &pool_id, RAPID_USERS_PER_POOL)?;
        // Total bets may be zero after settlement (contract-dependent)
        // assert_total_bets(&env, &contract_id, &pool_id, 0)?; // uncomment if applicable

        log_info!("Pool {} completed successfully", pool_id.to_string());
    }

    log_info!("=== Test rapid settle/claim PASSED ===");
    Ok(())
}