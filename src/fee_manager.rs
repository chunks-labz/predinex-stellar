//! Fee Manager Contract — stores, validates, and calculates tiered fee discounts.
//!
//! This contract implements a volume-based fee discount system for pool operations.
//! It accepts up to 5 volume/feeBPS pairs, storing them in a sorted list. When
//! calculating fees, the highest tier whose threshold is met or exceeded is applied.
//! If no tier matches, a default flat fee is used.
//!
//! # Backward Compatibility
//!
//! Unconfigured contracts (no tiers set) fall back to the default flat fee, ensuring
//! seamless integration with existing pool contracts.
//!
//! # Events
//!
//! - `fee_tiers_updated`: emitted when fee tiers are successfully set.

use soroban_sdk::{
    contract, contracterror, contractimpl, log, panic_with_error, vec, Env, Error, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// Errors that can occur during fee manager operations.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum FeeManagerError {
    /// More than the maximum allowed number of tiers was provided.
    TooManyTiers = 1,
    /// Volume thresholds are not strictly increasing.
    InvalidThresholdOrder = 2,
    /// Fee in basis points is out of valid range (0–10000).
    InvalidFeeBps = 3,
    /// No tiers supplied (empty vector).
    EmptyTiers = 4,
}

impl From<FeeManagerError> for Error {
    fn from(e: FeeManagerError) -> Self {
        Error::from_contract_error(e as u32)
    }
}

// ---------------------------------------------------------------------------
// Contract definition
// ---------------------------------------------------------------------------

#[contract]
pub struct FeeManagerContract;

#[contractimpl]
impl FeeManagerContract {
    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// Maximum number of fee tiers allowed.
    const MAX_TIERS: u32 = 5;

    /// Maximum fee value in basis points (100%).
    const MAX_BPS: u32 = 10_000;

    /// Storage key for the fee tiers vector.
    const TIERS_KEY: Symbol = Symbol::short("tiers");

    // -----------------------------------------------------------------------
    // Storage helpers
    // -----------------------------------------------------------------------

    /// Reads the stored fee tiers. Returns an empty vector if none are stored.
    #[inline(always)]
    fn read_tiers(env: &Env) -> Vec<(u128, u32)> {
        env.storage()
            .instance()
            .get(&Self::TIERS_KEY)
            .unwrap_or_else(|| vec![env])
    }

    /// Writes the fee tiers vector to persistent storage.
    #[inline(always)]
    fn write_tiers(env: &Env, tiers: &Vec<(u128, u32)>) {
        env.storage().instance().set(&Self::TIERS_KEY, tiers);
    }

    // -----------------------------------------------------------------------
    // Internal validation
    // -----------------------------------------------------------------------

    /// Validates and returns the provided tiers, or panics with an appropriate error.
    /// Ensures tiers are non-empty, ≤ MAX_TIERS, thresholds strictly increasing,
    /// and each fee is within 0..MAX_BPS.
    fn validate_tiers(env: &Env, tiers: &Vec<(u128, u32)>) {
        if tiers.is_empty() {
            panic_with_error!(env, FeeManagerError::EmptyTiers);
        }
        if tiers.len() > Self::MAX_TIERS {
            panic_with_error!(env, FeeManagerError::TooManyTiers);
        }

        let mut prev_threshold: Option<u128> = None;
        for (threshold, fee_bps) in tiers.iter() {
            if fee_bps > Self::MAX_BPS {
                panic_with_error!(env, FeeManagerError::InvalidFeeBps);
            }

            if let Some(prev) = prev_threshold {
                if threshold <= prev {
                    panic_with_error!(env, FeeManagerError::InvalidThresholdOrder);
                }
            }
            prev_threshold = Some(threshold);
        }
    }

    // -----------------------------------------------------------------------
    // Public interface
    // -----------------------------------------------------------------------

    /// Sets the volume fee tiers.
    ///
    /// Accepts up to `MAX_TIERS` (5) pairs of `(volume_threshold, fee_bps)`.
    /// Thresholds must be **strictly increasing** and each fee must be in the
    /// valid basis points range (0–10 000).
    ///
    /// # Arguments
    ///
    /// * `tiers` - A vector of `(u128, u32)` tuples representing volume thresholds
    ///   and their corresponding fees in basis points.
    ///
    /// # Panics
    ///
    /// * [`FeeManagerError::TooManyTiers`] if more than 5 tiers are provided.
    /// * [`FeeManagerError::InvalidThresholdOrder`] if thresholds are not strictly increasing.
    /// * [`FeeManagerError::InvalidFeeBps`] if any fee is outside the valid range.
    /// * [`FeeManagerError::EmptyTiers`] if the vector is empty.
    ///
    /// # Events
    ///
    /// Emits `fee_tiers_updated` with the new tiers as the event value.
    pub fn set_volume_fee_tiers(env: Env, tiers: Vec<(u128, u32)>) {
        Self::validate_tiers(&env, &tiers);

        // Persist (tiers is moved, no clone needed)
        let tiers_clone = tiers.clone(); // keep for event emission before write? we can write then emit
        Self::write_tiers(&env, &tiers);

        // Log and emit event
        log!(&env, "Fee tiers updated: {} tiers set", tiers.len());
        env.events().publish(
            Symbol::new(&env, "fee_tiers_updated"),
            tiers_clone.into_val(&env),
        );
    }

    /// Calculates the fee in basis points for a given volume and default fee.
    ///
    /// The matching logic works as follows:
    /// - If no tiers are configured, the default fee is returned.
    /// - If the volume is **below** the first tier threshold → default fee.
    /// - If the volume **meets or exceeds** a tier threshold → that tier’s fee.
    /// - If the volume **exceeds** the highest threshold → the highest tier’s fee.
    ///
    /// # Arguments
    ///
    /// * `volume` - The pool volume to evaluate.
    /// * `default_fee_bps` - The default fee in basis points (fallback).
    ///
    /// # Returns
    ///
    /// The applicable fee in basis points.
    #[must_use]
    pub fn calculate_fee(env: Env, volume: u128, default_fee_bps: u32) -> u32 {
        let tiers = Self::read_tiers(&env);
        if tiers.is_empty() {
            log!(
                &env,
                "No tiers configured, using default fee_bps={}",
                default_fee_bps
            );
            return default_fee_bps;
        }

        // Since tiers are stored in ascending order, iterate in reverse to find
        // the highest applicable tier.
        for (threshold, fee_bps) in tiers.iter().rev() {
            if volume >= threshold {
                log!(
                    &env,
                    "Fee matched: tier threshold={}, fee_bps={}",
                    threshold,
                    fee_bps
                );
                return fee_bps;
            }
        }

        log!(
            &env,
            "Volume {} below first tier ({}), using default fee_bps={}",
            volume,
            tiers.get(0).unwrap().0,
            default_fee_bps
        );
        default_fee_bps
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{vec, Env, IntoVal};

    /// Helper to set up a contract instance with the given tiers.
    fn setup_tiers(env: &Env, tiers: Vec<(u128, u32)>) -> FeeManagerContractClient {
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(env, &contract_id);
        client.set_volume_fee_tiers(&tiers);
        client
    }

    #[test]
    fn test_set_and_read_tiers() {
        let env = Env::default();
        let tiers = vec![&env, (100u128, 500u32), (500u128, 300u32), (1000u128, 100u32)];
        let _client = setup_tiers(&env, tiers.clone());

        // Verify stored tiers by reading storage directly
        let stored: Vec<(u128, u32)> = env
            .storage()
            .instance()
            .get(&Symbol::short("tiers"))
            .unwrap();
        assert_eq!(stored, tiers);
    }

    #[test]
    fn test_calculate_fee_below_first_tier() {
        let env = Env::default();
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        let fee = client.calculate_fee(&500u128, &200u32);
        assert_eq!(fee, 200u32); // below first tier => default
    }

    #[test]
    fn test_calculate_fee_exact_first_tier() {
        let env = Env::default();
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        let fee = client.calculate_fee(&1000u128, &200u32);
        assert_eq!(fee, 500u32);
    }

    #[test]
    fn test_calculate_fee_above_first_below_second() {
        let env = Env::default();
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        let fee = client.calculate_fee(&2000u128, &200u32);
        assert_eq!(fee, 500u32); // still first tier
    }

    #[test]
    fn test_calculate_fee_exact_second_tier() {
        let env = Env::default();
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        let fee = client.calculate_fee(&5000u128, &200u32);
        assert_eq!(fee, 300u32);
    }

    #[test]
    fn test_calculate_fee_above_highest_tier() {
        let env = Env::default();
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        let fee = client.calculate_fee(&10000u128, &200u32);
        assert_eq!(fee, 300u32); // highest tier
    }

    #[test]
    fn test_calculate_fee_no_tiers() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        // No tiers set, should always return default
        let fee = client.calculate_fee(&100000u128, &50u32);
        assert_eq!(fee, 50u32);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #4)")] // EmptyTiers
    fn test_set_empty_tiers() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        client.set_volume_fee_tiers(&vec![&env]); // empty
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")] // TooManyTiers
    fn test_set_too_many_tiers() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        let tiers = vec![
            &env,
            (100u128, 100u32),
            (200u128, 200u32),
            (300u128, 300u32),
            (400u128, 400u32),
            (500u128, 500u32),
            (600u128, 600u32), // 6th tier -> error
        ];
        client.set_volume_fee_tiers(&tiers);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")] // InvalidThresholdOrder
    fn test_set_non_increasing_thresholds() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        let tiers = vec![&env, (1000u128, 500u32), (500u128, 300u32)]; // 500 < 1000 => wrong
        client.set_volume_fee_tiers(&tiers);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")] // equal thresholds are not strictly increasing
    fn test_set_equal_thresholds() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        let tiers = vec![&env, (1000u128, 500u32), (1000u128, 300u32)]; // equal => wrong
        client.set_volume_fee_tiers(&tiers);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")] // InvalidFeeBps
    fn test_set_fee_above_max() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        let tiers = vec![&env, (1000u128, 10001u32)]; // above MAX_BPS
        client.set_volume_fee_tiers(&tiers);
    }

    #[test]
    fn test_event_emitted_on_set_tiers() {
        let env = Env::default();
        let contract_id = env.register_contract(None, FeeManagerContract);
        let client = FeeManagerContractClient::new(&env, &contract_id);
        let tiers = vec![&env, (100u128, 500u32), (500u128, 300u32)];

        client.set_volume_fee_tiers(&tiers);

        // Check that event was emitted with the correct topic and data
        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let (contract, topic, data) = &events.get(0).unwrap();
        assert_eq!(contract, &contract_id);
        assert_eq!(topic, &Symbol::new(&env, "fee_tiers_updated"));
        assert_eq!(
            data.clone().try_into_val::<Vec<(u128, u32)>>().unwrap(),
            tiers
        );
    }

    #[test]
    fn test_calculate_fee_multiple_tiers_full_coverage() {
        let env = Env::default();
        let tiers = vec![
            &env,
            (0u128, 1000u32),    // any volume >=0 => 1000 bps (but typical use: volume must be >0)
            (1000u128, 500u32),
            (10000u128, 100u32),
        ];
        let client = setup_tiers(&env, tiers);

        // volume = 0 => >=0? 0>=0 true => first tier fee 1000 bps
        assert_eq!(client.calculate_fee(&0u128, &200u32), 1000u32);

        // volume = 500 => >=0? 500>=0 true => 1000 bps
        assert_eq!(client.calculate_fee(&500u128, &200u32), 1000u32);

        // volume = 1000 => >=1000 true => 500 bps (first match)
        assert_eq!(client.calculate_fee(&1000u128, &200u32), 500u32);

        // volume = 5000 => >=10000? no, >=1000? yes => 500 bps
        assert_eq!(client.calculate_fee(&5000u128, &200u32), 500u32);

        // volume = 10000 => >=10000 true => 100 bps
        assert_eq!(client.calculate_fee(&10000u128, &200u32), 100u32);

        // volume > 10000 => highest tier => 100 bps
        assert_eq!(client.calculate_fee(&20000u128, &200u32), 100u32);
    }

    #[test]
    fn test_calculate_fee_volume_zero_with_tiers() {
        let env = Env::default();
        // Tiers starting from >0
        let tiers = vec![&env, (1000u128, 500u32), (5000u128, 300u32)];
        let client = setup_tiers(&env, tiers);
        // volume 0 < 1000 => default
        assert_eq!(client.calculate_fee(&0u128, &100u32), 100u32);
    }

    #[test]
    fn test_storage_isolation() {
        let env = Env::default();
        let tiers1 = vec![&env, (100u128, 10u32)];
        let tiers2 = vec![&env, (200u128, 20u32)];

        let contract_id1 = env.register_contract(None, FeeManagerContract);
        let client1 = FeeManagerContractClient::new(&env, &contract_id1);
        client1.set_volume_fee_tiers(&tiers1);

        let contract_id2 = env.register_contract(None, FeeManagerContract);
        let client2 = FeeManagerContractClient::new(&env, &contract_id2);
        client2.set_volume_fee_tiers(&tiers2);

        // Both contracts should have independent storage
        let fee1 = client1.calculate_fee(&100u128, &5u32);
        let fee2 = client2.calculate_fee(&100u128, &5u32);

        assert_eq!(fee1, 10u32); // tiers1 matches volume=100
        assert_eq!(fee2, 5u32);  // tiers2 threshold=200, volume=100 < 200 => default
    }
}