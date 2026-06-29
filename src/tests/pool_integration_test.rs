#![cfg(test)]

use soroban_sdk::{
    contracttype,
    log,
    testutils::{Address as AddressTestTrait, Events},
    vec, Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum number of volume fee tiers allowed.
const MAX_FEE_TIERS: usize = 5;

/// Default protocol fee in basis points (bps).  30 bps = 0.3%.
const DEFAULT_FEE_BPS: u64 = 30;

/// Maximum fee in basis points (100%).
const MAX_FEE_BPS: u64 = 10_000;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors that can occur during fee tier validation.
#[derive(Debug, Clone, PartialEq)]
pub enum FeeTierError {
    /// Number of tiers exceeds the maximum allowed.
    TooManyTiers(usize, usize),
    /// Fee basis points exceed the maximum allowed.
    FeeBpsOverflow(usize, u64),
    /// Volume thresholds are not strictly ascending.
    ThresholdsNotAscending(usize),
}

impl FeeTierError {
    fn as_str(&self) -> &'static str {
        match self {
            FeeTierError::TooManyTiers(_, _) => "too many fee tiers",
            FeeTierError::FeeBpsOverflow(_, _) => "fee bps exceeds maximum",
            FeeTierError::ThresholdsNotAscending(_) => "thresholds not strictly ascending",
        }
    }
}

impl core::fmt::Display for FeeTierError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            FeeTierError::TooManyTiers(given, max) => {
                write!(f, "cannot exceed {} fee tiers; got {}", max, given)
            }
            FeeTierError::FeeBpsOverflow(index, fee) => {
                write!(
                    f,
                    "fee {} bps at index {} exceeds max {} bps",
                    fee, index, MAX_FEE_BPS
                )
            }
            FeeTierError::ThresholdsNotAscending(index) => {
                write!(f, "volume thresholds must be strictly ascending; index {} violates", index)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// A volume‑based fee tier.
///
/// Each tier defines a minimum volume threshold (inclusive) and the
/// corresponding fee in basis points (1/100 of 1%).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeTier {
    /// Minimum volume required for this tier to be active.
    pub volume_threshold: u64,
    /// Fee in basis points applied when this tier is active.
    /// Must be between 0 and `MAX_FEE_BPS`.
    pub fee_bps: u64,
}

impl FeeTier {
    /// Create a new fee tier.
    ///
    /// # Errors
    /// Returns `FeeTierError::FeeBpsOverflow` if `fee_bps > MAX_FEE_BPS`.
    pub fn new(volume_threshold: u64, fee_bps: u64) -> Result<Self, FeeTierError> {
        if fee_bps > MAX_FEE_BPS {
            return Err(FeeTierError::FeeBpsOverflow(0, fee_bps));
        }
        Ok(FeeTier {
            volume_threshold,
            fee_bps,
        })
    }
}

// ---------------------------------------------------------------------------
// External contract interfaces (assumed to be compiled from .wasm files)
// ---------------------------------------------------------------------------
mod pool_contract {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/pool_contract.wasm"
    );
}

mod fee_manager_contract {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/fee_manager_contract.wasm"
    );
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Deploy the fee manager contract and return its `(contract_id, address)`.
///
/// # Panics
/// - If the WASM bytecode cannot be registered.
fn deploy_fee_manager(e: &Env) -> (BytesN<32>, Address) {
    let contract_id = e.register_contract_wasm(None, fee_manager_contract::WASM);
    let address = Address::from_contract_id(&contract_id);
    log!(
        e,
        "Deployed fee manager contract: id={:?}, address={:?}",
        contract_id,
        address
    );
    (contract_id, address)
}

/// Deploy the pool contract and return its `(contract_id, address)`.
///
/// # Panics
/// - If the WASM bytecode cannot be registered.
fn deploy_pool(e: &Env) -> (BytesN<32>, Address) {
    let contract_id = e.register_contract_wasm(None, pool_contract::WASM);
    let address = Address::from_contract_id(&contract_id);
    log!(
        e,
        "Deployed pool contract: id={:?}, address={:?}",
        contract_id,
        address
    );
    (contract_id, address)
}

/// Convert a slice of `FeeTier` into a `Vec<Val>` suitable for Soroban calls.
///
/// Each tier is converted to a two-element vector `[volume_threshold, fee_bps]`,
/// and all such vectors are collected into one outer vector.
///
/// # Errors
/// Returns `FeeTierError` if:
/// - The number of tiers exceeds `MAX_FEE_TIERS`.
/// - Any fee_bps exceeds `MAX_FEE_BPS`.
/// - Volume thresholds are not strictly ascending.
fn fee_tiers_to_vec(e: &Env, tiers: &[FeeTier]) -> Result<Vec<Val>, FeeTierError> {
    // Validate constraints.
    if tiers.len() > MAX_FEE_TIERS {
        return Err(FeeTierError::TooManyTiers(tiers.len(), MAX_FEE_TIERS));
    }

    for (i, tier) in tiers.iter().enumerate() {
        if tier.fee_bps > MAX_FEE_BPS {
            return Err(FeeTierError::FeeBpsOverflow(i, tier.fee_bps));
        }

        if i > 0 && tier.volume_threshold <= tiers[i - 1].volume_threshold {
            return Err(FeeTierError::ThresholdsNotAscending(i));
        }
    }

    // Convert to Soroban vector representation.
    let mut outer = vec![e];
    for tier in tiers {
        let inner: Vec<Val> = vec![
            e,
            tier.volume_threshold.into_val(e),
            tier.fee_bps.into_val(e),
        ];
        outer.push_back(inner.into_val(e));
    }
    Ok(outer)
}

/// Set up a common test harness: deploy pool and fee manager, initialize pool.
///
/// # Returns
/// A triple `(admin, pool_client, fee_manager_client)`.
fn setup(e: &Env) -> (Address, pool_contract::Client, fee_manager_contract::Client) {
    e.mock_all_auths();

    let admin = Address::random(e);
    let (_, pool) = deploy_pool(e);
    let (_, fee_manager) = deploy_fee_manager(e);

    let pool_client = pool_contract::Client::new(e, &pool);
    let fee_manager_client = fee_manager_contract::Client::new(e, &fee_manager);

    pool_client.init(&admin, &DEFAULT_FEE_BPS, &fee_manager);

    log!(
        e,
        "[INFO] Test harness initialized: admin={:?}, pool={:?}, fee_manager={:?}",
        admin,
        pool,
        fee_manager
    );

    (admin, pool_client, fee_manager_client)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// # Test: Volume below the first tier threshold uses the default fee.
///
/// When the settlement volume is less than the first tier's volume threshold,
/// the protocol must fall back to the default flat fee (`DEFAULT_FEE_BPS`).
///
/// # Setup
/// - Configure a single tier with threshold 1000 and fee 20 bps.
/// - Settle with volume 500 (below threshold).
///
/// # Expected
/// - The fee returned equals `DEFAULT_FEE_BPS` (30 bps).
#[test]
fn test_volume_below_first_tier_uses_default() {
    let e = Env::default();
    let (admin, pool, fee_manager) = setup(&e);

    // Create tier and convert to Soroban representation.
    let tier = FeeTier::new(1000, 20).expect("Invalid fee tier");
    let tiers = fee_tiers_to_vec(&e, &[tier]).expect("Failed to convert fee tiers");

    fee_manager.set_volume_fee_tiers(&admin, &tiers);

    // Volume 500 < 1000 → the default fee should be applied.
    let fee = pool.settle(&1000u64, &500u64);
    assert_eq!(
        fee, DEFAULT_FEE_BPS,
        "Volume {} below first tier threshold {} should return default fee {} bps; got {}",
        500, 1000, DEFAULT_FEE_BPS, fee
    );

    log!(
        &e,
        "[INFO] test_volume_below_first_tier_uses_default: fee = {}",
        fee
    );
}

/// # Test: Volume within a tier uses the corresponding tier fee.
///
/// When the settlement volume falls inside a tier (≥ threshold and < next
/// threshold), the fee for that tier must be applied.
///
/// # Setup
/// - Configure two tiers: [1000, 20] and [5000, 15].
/// - Settle with volume 3000 (within first tier).
///
/// # Expected
/// - The fee returned is 15 bps (the second tier's fee).
#[test]
fn test_volume_within_tier_uses_tiered_fee() {
    let e = Env::default();
    let (admin, pool, fee_manager) = setup(&e);

    let tiers = [
        FeeTier::new(1000, 20).expect("Invalid fee tier"),
        FeeTier::new(5000, 15).expect("Invalid fee tier"),
    ];
    let tiers_val = fee_tiers_to_vec(&e, &tiers).expect("Failed to convert fee tiers");

    fee_manager.set_volume_fee_tiers(&admin, &tiers_val);

    // Volume 3000 is ≥ 1000 and < 5000 → should use the second tier fee (15 bps).
    let fee = pool.settle(&10000u64, &3000u64);
    assert_eq!(
        fee, 15,
        "Volume {} within tier [1000, 5000) should use fee {} bps; got {}",
        3000, 15, fee
    );

    log!(
        &e,
        "[INFO] test_volume_within_tier_uses_tiered_fee: fee = {}",
        fee
    );
}

/// # Test: Volume above the highest tier threshold uses the highest tier fee.
///
/// When the settlement volume exceeds the highest configured threshold, the
/// fee of the highest tier must be applied.
///
/// # Setup
/// - Configure two tiers: [1000, 20] and [5000, 15].
/// - Settle with volume 10000 (above highest threshold).
///
/// # Expected
/// - The fee returned is 15 bps (the highest tier's fee).
#[test]
fn test_volume_above_highest_tier_uses_highest() {
    let e = Env::default();
    let (admin, pool, fee_manager) = setup(&e);

    let tiers = [
        FeeTier::new(1000, 20).expect("Invalid fee tier"),
        FeeTier::new(5000, 15).expect("Invalid fee tier"),
    ];
    let tiers_val = fee_tiers_to_vec(&e, &tiers).expect("Failed to convert fee tiers");

    fee_manager.set_volume_fee_tiers(&admin, &tiers_val);

    // Volume 10000 > 5000 → should use the highest tier fee (15 bps).
    let fee = pool.settle(&20000u64, &10000u64);
    assert_eq!(
        fee, 15,
        "Volume {} above highest threshold {} should use highest tier fee {} bps; got {}",
        10000, 5000, 15, fee
    );

    log!(
        &e,
        "[INFO] test_volume_above_highest_tier_uses_highest: fee = {}",
        fee
    );
}

/// # Test: Invalid configuration (too many tiers) is rejected.
///
/// When more than `MAX_FEE_TIERS` tiers are provided, the helper function
/// should return an error.
///
/// # Expected
/// - `fee_tiers_to_vec` returns `Err(FeeTierError::TooManyTiers(...))`.
#[test]
fn test_too_many_tiers_rejected() {
    let e = Env::default();
    let tiers: Vec<FeeTier> = (0..=MAX_FEE_TIERS)
        .map(|i| FeeTier::new(i as u64 * 1000, 20).unwrap())
        .collect();

    let result = fee_tiers_to_vec(&e, &tiers);
    assert!(
        result.is_err(),
        "Expected error for {} tiers (max {})",
        tiers.len(),
        MAX_FEE_TIERS
    );
    if let Err(FeeTierError::TooManyTires(given, max)) = result {
        assert_eq!(given, MAX_FEE_TIERS + 1);
        assert_eq!(max, MAX_FEE_TIERS);
    } else {
        panic!("Unexpected error type");
    }
}

/// # Test: Invalid configuration (fee bps overflow) is rejected.
///
/// When a fee tier with fee_bps > MAX_FEE_BPS is provided, the helper
/// function should return an error.
///
/// # Expected
/// - `FeeTier::new` returns `Err(FeeTierError::FeeBpsOverflow)`.
#[test]
fn test_fee_bps_overflow_rejected() {
    let result = FeeTier::new(1000, MAX_FEE_BPS + 1);
    assert!(result.is_err(), "Expected error for fee > {} bps", MAX_FEE_BPS);
    if let Err(FeeTierError::FeeBpsOverflow(index, fee)) = result {
        assert_eq!(index, 0);
        assert_eq!(fee, MAX_FEE_BPS + 1);
    } else {
        panic!("Unexpected error type");
    }
}

/// # Test: Invalid configuration (non-ascending thresholds) is rejected.
///
/// When thresholds are not strictly increasing, the helper should error.
///
/// # Setup
/// - Create tiers with thresholds [2000, 1000].
///
/// # Expected
/// - `fee_tiers_to_vec` returns `Err(FeeTierError::ThresholdsNotAscending)`.
#[test]
fn test_non_ascending_thresholds_rejected() {
    let e = Env::default();
    let tiers = [
        FeeTier::new(2000, 20).unwrap(),
        FeeTier::new(1000, 15).unwrap(), // lower than previous
    ];
    let result = fee_tiers_to_vec(&e, &tiers);
    assert!(result.is_err(), "Expected error for non-ascending thresholds");
    if let Err(FeeTierError::ThresholdsNotAscending(index)) = result {
        assert_eq!(index, 1);
    } else {
        panic!("Unexpected error type");
    }
}

/// # Test: `fee_tiers_updated` event is emitted when tiers are set.
///
/// The fee manager should emit a `fee_tiers_updated` event after successfully
/// setting the tiers.
///
/// # Setup
/// - Set a single tier.
///
/// # Expected
/// - Contract events contain a topic `Symbol::new(&e, "fee_tiers_updated")`.
#[test]
fn test_fee_tiers_updated_event_emitted() {
    let e = Env::default();
    let (admin, _, fee_manager) = setup(&e);

    let tier = FeeTier::new(500, 10).expect("Invalid fee tier");
    let tiers_val = fee_tiers_to_vec(&e, &[tier]).expect("Failed to convert fee tiers");

    fee_manager.set_volume_fee_tiers(&admin, &tiers_val);

    // Check events
    let events = e.events();
    let expected_topic = Symbol::new(&e, "fee_tiers_updated");
    let found = events.all().iter().any(|evt| {
        matches!(&evt.topics, soroban_sdk::testutils::Topics::None if true) && {
            // Event structure: (admin, Vec<Val>). We just check topic presence.
            // The topic is the first element of the event.
            evt.topics
                .first()
                .map(|t| t == expected_topic.into_val(&e))
                .unwrap_or(false)
        }
    });
    assert!(found, "Expected event 'fee_tiers_updated' not found in emitted events");

    log!(&e, "[INFO] test_fee_tiers_updated_event_emitted: event verified");
}

/// # Test: Backward compatibility – unconfigured fee uses default flat fee.
///
/// When no volume fee tiers are configured, the settlement should fall back
/// to the flat default fee (DEFAULT_FEE_BPS).
///
/// # Setup
/// - Do not call `set_volume_fee_tiers`.
/// - Settle with any volume.
///
/// # Expected
/// - The fee returned is `DEFAULT_FEE_BPS`.
#[test]
fn test_unconfigured_uses_default_fee() {
    let e = Env::default();
    let (_, pool, _) = setup(&e);

    let fee = pool.settle(&5000u64, &2000u64);
    assert_eq!(
        fee, DEFAULT_FEE_BPS,
        "Unconfigured fee should return default {} bps; got {}",
        DEFAULT_FEE_BPS, fee
    );

    log!(&e, "[INFO] test_unconfigured_uses_default_fee: fee = {}", fee);
}