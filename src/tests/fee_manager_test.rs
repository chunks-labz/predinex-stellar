// src/tests/fee_manager_test.rs

//! # FeeManager Test Suite
//!
//! This module provides comprehensive testing for the `FeeManager` contract.
//!
//! ## Coverage
//! - Tier configuration validation (count, ordering, duplicates, fee bounds)
//! - Fee calculation with tiered logic, fallback to default, and edge cases
//! - Event emission (`fee_tiers_updated`) and backward compatibility
//!
//! All tests use a fresh environment and clear, isolated scenarios.
//! Constants are defined for readability and maintainability.

use soroban_sdk::{
    testutils::Logs,
    vec,
    Env,
    IntoVal,
    TryIntoVal,
};
use crate::fee_manager::{FeeManager, FeeManagerClient};
use crate::fee_manager::error::FeeManagerError;

// ---------------------------------------------------------------------------
// Constants – single source of truth for test values
// ---------------------------------------------------------------------------
const DEFAULT_FEE_BPS: i128 = 30;
const MAX_FEE_BPS: i128 = 10_000; // 100% in basis points
const MAX_TIER_COUNT: usize = 5;
const VALID_THRESHOLD: i128 = 1000;
const VALID_FEE: i128 = 20;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Creates a fresh `Env` and registers a `FeeManager` contract, returning
/// both the environment and a client bound to the contract.
///
/// Every test begins with a clean state; no pre‑configured tiers.
fn setup_env() -> (Env, FeeManagerClient) {
    let env = Env::default();
    let contract_id = env.register_contract(None, FeeManager);
    let client = FeeManagerClient::new(&env, &contract_id);
    (env, client)
}

/// Asserts that the most recent log entry contains `expected` text.
///
/// # Panics
/// Panics if no event was emitted or if the last log does not contain the string.
fn assert_fee_tiers_event_emitted(env: &Env, expected: &str) {
    let events = env.logs().all();
    let last = events.last().expect("No events emitted – expected fee_tiers_updated");
    assert!(
        last.contains(expected),
        "Expected event containing '{}' but got: {}",
        expected,
        last
    );
}

/// Counts the number of log entries that contain `fee_tiers_updated`.
/// Useful when multiple calls are made and event count must be verified.
fn count_fee_tiers_events(env: &Env) -> usize {
    env.logs()
        .all()
        .iter()
        .filter(|log| log.contains("fee_tiers_updated"))
        .count()
}

// ---------------------------------------------------------------------------
// set_volume_fee_tiers – success cases
// ---------------------------------------------------------------------------

/// **Single tier pair** – Verifies that a valid pair is accepted and the
/// corresponding event is emitted exactly once.
#[test]
fn test_set_tiers_single_pair() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (VALID_THRESHOLD, VALID_FEE)];
    client.set_volume_fee_tiers(&tiers);
    assert_fee_tiers_event_emitted(&env, "fee_tiers_updated");
    assert_eq!(count_fee_tiers_events(&env), 1);
}

/// **Maximum of five tier pairs** – Verifies that the contract accepts
/// exactly the maximum allowed number of tiers.
#[test]
fn test_set_tiers_max_five_pairs() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 50i128),
        (5_000i128, 40i128),
        (10_000i128, 30i128),
        (50_000i128, 20i128),
        (100_000i128, 10i128),
    ];
    client.set_volume_fee_tiers(&tiers);
    assert_eq!(count_fee_tiers_events(&env), 1);
}

/// **Replacing previous tiers** – Calling `set_volume_fee_tiers` twice should
/// emit two events and only the second configuration should be active.
/// (Fee calculation tests confirm the latter.)
#[test]
fn test_set_tiers_replaces_previous() {
    let (env, client) = setup_env();
    let first = vec![&env, (1000i128, 30i128)];
    let second = vec![&env, (2000i128, 25i128)];

    client.set_volume_fee_tiers(&first);
    client.set_volume_fee_tiers(&second);

    assert_eq!(count_fee_tiers_events(&env), 2);
}

/// **Default fee unchanged** – After setting tiers, the default fee (flat rate)
/// must remain at its initial value.
#[test]
fn test_set_tiers_preserves_default_fee() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 20i128)];
    client.set_volume_fee_tiers(&tiers);
    assert_eq!(
        client.get_default_fee_bps(),
        DEFAULT_FEE_BPS,
        "Default fee should be 30 bps regardless of configured tiers"
    );
}

// ---------------------------------------------------------------------------
// set_volume_fee_tiers – validation / error cases
// ---------------------------------------------------------------------------

/// **Empty tier list** – Must be rejected with `FeeManagerError::EmptyTiers`.
#[test]
#[should_panic(expected = "FeeManagerError::EmptyTiers")]
fn test_set_tiers_empty_should_fail() {
    let (env, client) = setup_env();
    let empty_tiers = vec![&env]; // zero pairs
    client.set_volume_fee_tiers(&empty_tiers);
}

/// **More than five tier pairs** – Must be rejected with
/// `FeeManagerError::TierCountExceedsMax`.
#[test]
#[should_panic(expected = "FeeManagerError::TierCountExceedsMax")]
fn test_set_tiers_six_pairs_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 50i128),
        (5_000i128, 40i128),
        (10_000i128, 30i128),
        (50_000i128, 20i128),
        (100_000i128, 10i128),
        (500_000i128, 5i128), // sixth pair – must be rejected
    ];
    client.set_volume_fee_tiers(&tiers);
}

/// **Non‑increasing thresholds** – Thresholds must be strictly ascending.
#[test]
#[should_panic(expected = "FeeManagerError::TiersNotAscending")]
fn test_set_tiers_non_increasing_threshold_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (2000i128, 30i128),
        (1000i128, 25i128), // threshold lower than previous
    ];
    client.set_volume_fee_tiers(&tiers);
}

/// **Duplicate thresholds** – Two tiers with the same volume threshold are
/// not allowed.
#[test]
#[should_panic(expected = "FeeManagerError::DuplicateThreshold")]
fn test_set_tiers_duplicate_threshold_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 30i128),
        (1000i128, 25i128), // same volume threshold
    ];
    client.set_volume_fee_tiers(&tiers);
}

/// **Negative fee in basis points** – Fee bps must be non‑negative.
#[test]
#[should_panic(expected = "FeeManagerError::InvalidFeeBps")]
fn test_set_tiers_negative_fee_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, -5i128)];
    client.set_volume_fee_tiers(&tiers);
}

/// **Fee exceeding maximum allowed (10,000 bps)** – Must be rejected.
#[test]
#[should_panic(expected = "FeeManagerError::InvalidFeeBps")]
fn test_set_tiers_fee_above_max_bps_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, MAX_FEE_BPS + 1)];
    client.set_volume_fee_tiers(&tiers);
}

/// **Zero threshold** – Volume thresholds must be positive.
#[test]
#[should_panic(expected = "FeeManagerError::InvalidThreshold")]
fn test_set_tiers_zero_threshold_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (0i128, 30i128)]; // threshold = 0 → rejected
    client.set_volume_fee_tiers(&tiers);
}

/// **Negative threshold** – Volume thresholds must be positive.
#[test]
#[should_panic(expected = "FeeManagerError::InvalidThreshold")]
fn test_set_tiers_negative_threshold_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (-100i128, 30i128)];
    client.set_volume_fee_tiers(&tiers);
}

// ---------------------------------------------------------------------------
// calculate_applicable_fee – volume tier matching
// ---------------------------------------------------------------------------

/// **No tiers configured** – Fee must fall back to the default flat fee.
#[test]
fn test_fee_falls_back_to_default_when_no_tiers_set() {
    let (env, client) = setup_env();
    let fee_bps = client.get_applicable_fee_bps(&1000i128);
    assert_eq!(
        fee_bps,
        DEFAULT_FEE_BPS,
        "Without tiers configured, any volume should yield default fee"
    );
}

/// **Volume below first tier** – When volume is less than the first tier's
/// threshold, the default fee should be used.
#[test]
fn test_fee_below_first_tier_uses_default() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 20i128)];
    client.set_volume_fee_tiers(&tiers);

    let fee_bps = client.get_applicable_fee_bps(&500i128); // below threshold
    assert_eq!(
        fee_bps,
        DEFAULT_FEE_BPS,
        "Volume below the first tier threshold should fall back to default fee"
    );
}

/// **Volume within a tier** – When volume is exactly within a tier's range,
/// the tier's fee should be applied.
#[test]
fn test_fee_within_tier_uses_correct_bps() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 25i128),
        (5000i128, 20i128),
    ];
    client.set_volume_fee_tiers(&tiers);

    // Volume exactly at the threshold of the first tier
    let fee_bps = client.get_applicable_fee_bps(&1000i128);
    assert_eq!(fee_bps, 25, "Volume equal to first tier threshold should use first tier fee");

    // Volume within second tier
    let fee_bps = client.get_applicable_fee_bps(&3000i128);
    assert_eq!(fee_bps, 20, "Volume within second tier range should use second tier fee");
}

/// **Volume above highest tier** – When volume exceeds the highest tier's
/// threshold, the highest tier's fee should be applied.
#[test]
fn test_fee_above_highest_tier_uses_highest_fee() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 30i128),
        (5000i128, 20i128),
        (10_000i128, 10i128),
    ];
    client.set_volume_fee_tiers(&tiers);

    let fee_bps = client.get_applicable_fee_bps(&20_000i128); // above all thresholds
    assert_eq!(
        fee_bps,
        10,
        "Volume above the highest tier threshold should use the highest tier fee"
    );
}

/// **Multiple volumes** – Verifies correct fee for various volumes with
/// multiple tiers configured.
#[test]
fn test_fee_multiple_volumes_correct_matching() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 40i128),
        (5000i128, 30i128),
        (10_000i128, 20i128),
    ];
    client.set_volume_fee_tiers(&tiers);

    // volume < first tier -> default
    assert_eq!(client.get_applicable_fee_bps(&500i128), DEFAULT_FEE_BPS);
    // volume == first tier -> first tier
    assert_eq!(client.get_applicable_fee_bps(&1000i128), 40);
    // volume between first and second -> second tier
    assert_eq!(client.get_applicable_fee_bps(&3000i128), 30);
    // volume == second tier -> second tier
    assert_eq!(client.get_applicable_fee_bps(&5000i128), 30);
    // volume == third tier -> third tier
    assert_eq!(client.get_applicable_fee_bps(&10_000i128), 20);
    // volume above highest -> highest
    assert_eq!(client.get_applicable_fee_bps(&100_000i128), 20);
}

// ---------------------------------------------------------------------------
// Edge cases and backward compatibility
// ---------------------------------------------------------------------------

/// **Zero volume** – Volume zero should be below the smallest threshold,
/// thus fall back to default fee.
#[test]
fn test_fee_zero_volume_uses_default() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 20i128)];
    client.set_volume_fee_tiers(&tiers);

    let fee_bps = client.get_applicable_fee_bps(&0i128);
    assert_eq!(fee_bps, DEFAULT_FEE_BPS, "Zero volume should fall back to default fee");
}

/// **Negative volume** – Negative volume is invalid; contract should panic
/// (or handle gracefully). We expect a panic from the fee calculation.
#[test]
#[should_panic(expected = "FeeManagerError::InvalidVolume")]
fn test_fee_negative_volume_should_fail() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 20i128)];
    client.set_volume_fee_tiers(&tiers);

    client.get_applicable_fee_bps(&(-100i128));
}

/// **Backward compatibility** – When no tiers are set, `get_applicable_fee_bps`
/// should always return the default fee (flat fee behavior).
#[test]
fn test_backward_compatibility_no_tiers() {
    let (env, client) = setup_env();
    // never set tiers
    for volume in &[0i128, 1, 100, 10_000, 1_000_000] {
        assert_eq!(
            client.get_applicable_fee_bps(volume),
            DEFAULT_FEE_BPS,
            "Without tiers, default fee must be returned for volume {}",
            volume
        );
    }
}

/// **Multiple tiers with same fee** – Duplicate fee bps are allowed as long
/// as thresholds are distinct and ascending.
#[test]
fn test_multiple_tiers_same_fee() {
    let (env, client) = setup_env();
    let tiers = vec![
        &env,
        (1000i128, 20i128),
        (5000i128, 20i128), // same fee bps
        (10_000i128, 10i128),
    ];
    client.set_volume_fee_tiers(&tiers);
    assert_eq!(count_fee_tiers_events(&env), 1);
    // Verification: volume within both first and second tier gets 20 bps
    assert_eq!(client.get_applicable_fee_bps(&3000i128), 20);
}

/// **Single tier edge** – Exactly one tier, volume exactly at threshold.
#[test]
fn test_fee_single_tier_exact_threshold() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 15i128)];
    client.set_volume_fee_tiers(&tiers);

    assert_eq!(client.get_applicable_fee_bps(&1000i128), 15);
}

/// **Tiers updated event content** – Checks that the event contains the
/// serialized tier data (can be extended based on actual event format).
#[test]
fn test_event_contains_tier_data() {
    let (env, client) = setup_env();
    let tiers = vec![&env, (1000i128, 20i128)];
    client.set_volume_fee_tiers(&tiers);

    let events = env.logs().all();
    let last = events.last().unwrap();
    // The event should contain both the threshold and fee values
    assert!(last.contains("1000"), "Event should contain threshold 1000");
    assert!(last.contains("20"), "Event should contain fee 20 bps");
}