// contracts/wave_pool/src/storage.rs
// Storage read/write functions for pool and total volume tracking.
// Implements overflow protection, input validation, event emission,
// and persistent storage with TTL management for production readiness.

use soroban_sdk::{symbol_short, Address, Env, IntoVal, Val};
use crate::{DataKey, Error};

/// The default TTL (in ledgers) for persistent storage entries.
/// Chosen to balance data longevity with state bloat; can be adjusted
/// based on network parameters and expected contract activity.
const EXTEND_TTL_THRESHOLD: u32 = 10_000;
const EXTEND_TTL_TO: u32 = 50_000;

// Event symbols for volume operations and error logging
const EVENT_WRITE_VOLUME: soroban_sdk::Symbol = symbol_short!("wr_volume");
const EVENT_ADD_VOLUME: soroban_sdk::Symbol = symbol_short!("add_volume");
const EVENT_ERROR: soroban_sdk::Symbol = symbol_short!("volume_err");

/// Read the cumulative volume for a specific pool.
/// Returns 0 if no volume has been recorded.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `pool_id` - The Address identifying the pool.
///
/// # Returns
/// The cumulative volume for the pool (non-negative).
///
/// # Panics
/// Panics if storage read fails (rare, indicates environment corruption).
#[inline]
pub fn read_pool_volume(env: &Env, pool_id: &Address) -> i128 {
    let key = DataKey::PoolVolume(pool_id.clone());
    env.storage()
        .persistent()
        .get::<_, i128>(&key)
        .unwrap_or(0)
}

/// Write the cumulative volume for a specific pool directly.
/// Intended for initialization or migration; prefer `add_volume` during gameplay.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `pool_id` - The Address identifying the pool.
/// * `volume` - The new cumulative volume (must be non-negative).
///
/// # Errors
/// Returns `Error::NegativeVolume` if `volume` is negative.
///
/// # Events
/// Emits `wr_volume` event with `pool_id` and new `volume`.
/// Emits `volume_err` event with details on error.
#[must_use]
pub fn write_pool_volume(env: &Env, pool_id: &Address, volume: i128) -> Result<(), Error> {
    if volume < 0 {
        env.events().publish(
            EVENT_ERROR,
            (pool_id.clone(), symbol_short!("neg_vol"), volume),
        );
        return Err(Error::NegativeVolume);
    }

    let key = DataKey::PoolVolume(pool_id.clone());
    set_and_extend(env, &key, &volume);

    // Event emission for off-chain tracking and audit
    env.events().publish(EVENT_WRITE_VOLUME, (pool_id.clone(), volume));

    Ok(())
}

/// Read the total cumulative volume across all pools.
/// Returns 0 if no volume has been recorded.
///
/// # Arguments
/// * `env` - The Soroban environment.
///
/// # Returns
/// The total cumulative volume across all pools (non-negative).
///
/// # Panics
/// Panics if storage read fails.
#[inline]
pub fn read_total_volume(env: &Env) -> i128 {
    let key = DataKey::TotalVolume;
    env.storage()
        .persistent()
        .get::<_, i128>(&key)
        .unwrap_or(0)
}

/// Safely add volume to both per-pool and total cumulative volume using checked arithmetic.
/// Returns `Ok(())` on success, or an `Error` on overflow or invalid input.
///
/// # Arguments
/// * `env` - The Soroban environment.
/// * `pool_id` - The Address identifying the pool.
/// * `amount` - The amount to add (must be positive).
///
/// # Errors
/// Returns `Error::NegativeVolume` if `amount <= 0`.
/// Returns `Error::Overflow` if the addition would overflow `i128`.
///
/// # Events
/// Emits `add_volume` event with `pool_id` and `amount`.
/// Emits `volume_err` event with details on error.
#[must_use]
pub fn add_volume(env: &Env, pool_id: &Address, amount: i128) -> Result<(), Error> {
    // Input validation
    if amount <= 0 {
        env.events().publish(
            EVENT_ERROR,
            (pool_id.clone(), symbol_short!("neg_amt"), amount),
        );
        return Err(Error::NegativeVolume);
    }

    // Per-pool volume update with overflow check
    let pool_current = read_pool_volume(env, pool_id);
    let pool_new = pool_current
        .checked_add(amount)
        .ok_or_else(|| {
            env.events().publish(
                EVENT_ERROR,
                (pool_id.clone(), symbol_short!("pool_ovf"), pool_current),
            );
            Error::Overflow
        })?;

    let pool_key = DataKey::PoolVolume(pool_id.clone());
    set_and_extend(env, &pool_key, &pool_new);

    // Total volume update with overflow check
    let total_current = read_total_volume(env);
    let total_new = total_current
        .checked_add(amount)
        .ok_or_else(|| {
            env.events().publish(
                EVENT_ERROR,
                (pool_id.clone(), symbol_short!("total_ovf"), total_current),
            );
            Error::Overflow
        })?;

    let total_key = DataKey::TotalVolume;
    set_and_extend(env, &total_key, &total_new);

    // Event emission for off-chain tracking and audit
    env.events().publish(EVENT_ADD_VOLUME, (pool_id.clone(), amount));

    Ok(())
}

/// Helper function: set a persistent storage value and extend its TTL.
/// Reduces code duplication and centralizes TTL policy.
#[inline]
fn set_and_extend<V: IntoVal<Env, Val>>(env: &Env, key: &DataKey, val: &V) {
    env.storage().persistent().set(key, val);
    env.storage()
        .persistent()
        .extend_ttl(key, EXTEND_TTL_THRESHOLD, EXTEND_TTL_TO);
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as TestAddress, BytesN};

    #[test]
    fn test_read_pool_volume_default() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        assert_eq!(read_pool_volume(&env, &pool_id), 0);
    }

    #[test]
    fn test_write_and_read_pool_volume() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        assert!(write_pool_volume(&env, &pool_id, 100).is_ok());
        assert_eq!(read_pool_volume(&env, &pool_id), 100);
    }

    #[test]
    fn test_write_pool_volume_negative() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        let result = write_pool_volume(&env, &pool_id, -10);
        assert!(result.is_err());
        match result {
            Err(Error::NegativeVolume) => {}
            _ => panic!("Expected NegativeVolume error"),
        }
    }

    #[test]
    fn test_add_volume_basic() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        assert!(write_pool_volume(&env, &pool_id, 50).is_ok());
        assert_eq!(read_total_volume(&env), 0);

        let result = add_volume(&env, &pool_id, 30);
        assert!(result.is_ok());
        assert_eq!(read_pool_volume(&env, &pool_id), 80);
        assert_eq!(read_total_volume(&env), 30);
    }

    #[test]
    fn test_add_volume_multiple_pools() {
        let env = Env::default();
        let pool1 = Address::from_contract_id(&BytesN::from_array(&[1; 32]));
        let pool2 = Address::from_contract_id(&BytesN::from_array(&[2; 32]));

        assert!(add_volume(&env, &pool1, 100).is_ok());
        assert_eq!(read_pool_volume(&env, &pool1), 100);
        assert_eq!(read_total_volume(&env), 100);

        assert!(add_volume(&env, &pool2, 200).is_ok());
        assert_eq!(read_pool_volume(&env, &pool2), 200);
        assert_eq!(read_total_volume(&env), 300);
    }

    #[test]
    fn test_negative_amount_error() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        let result = add_volume(&env, &pool_id, -10);
        assert!(result.is_err());
        match result {
            Err(Error::NegativeVolume) => {}
            _ => panic!("Expected NegativeVolume error"),
        }
    }

    #[test]
    fn test_zero_amount_error() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        let result = add_volume(&env, &pool_id, 0);
        assert!(result.is_err());
        match result {
            Err(Error::NegativeVolume) => {}
            _ => panic!("Expected NegativeVolume error"),
        }
    }

    #[test]
    fn test_overflow_pool_volume() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        assert!(write_pool_volume(&env, &pool_id, i128::MAX).is_ok());
        let result = add_volume(&env, &pool_id, 1);
        assert!(result.is_err());
        match result {
            Err(Error::Overflow) => {}
            _ => panic!("Expected Overflow error"),
        }
    }

    #[test]
    fn test_overflow_total_volume() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        // Set total volume to near max by using two pools
        let pool1 = Address::from_contract_id(&BytesN::from_array(&[1; 32]));
        let pool2 = Address::from_contract_id(&BytesN::from_array(&[2; 32]));
        assert!(write_pool_volume(&env, &pool1, i128::MAX / 2).is_ok());
        assert!(write_pool_volume(&env, &pool2, i128::MAX / 2).is_ok());
        // Manually set total to near max (bypass add_volume to avoid overflow)
        let total_key = DataKey::TotalVolume;
        env.storage().persistent().set(&total_key, &(i128::MAX - 1));
        // Now try to add volume that would overflow total
        let result = add_volume(&env, &pool1, 100);
        assert!(result.is_err());
        match result {
            Err(Error::Overflow) => {}
            _ => panic!("Expected Overflow error"),
        }
    }

    #[test]
    fn test_volume_persists_after_operations() {
        let env = Env::default();
        let pool_id = Address::from_contract_id(&BytesN::from_array(&[0; 32]));
        assert!(add_volume(&env, &pool_id, 500).is_ok());
        assert!(add_volume(&env, &pool_id, 200).is_ok());
        // Simulate settlement: write a new volume directly (mimicking migration)
        assert!(write_pool_volume(&env, &pool_id, 1000).is_ok());
        assert_eq!(read_pool_volume(&env, &pool_id), 1000);
        assert_eq!(read_total_volume(&env), 500 + 200); // total unchanged by write
    }

    #[test]
    fn test_concurrent_multiple_pools_no_interference() {
        let env = Env::default();
        let pools: Vec<Address> = (0..10)
            .map(|i| Address::from_contract_id(&BytesN::from_array(&[i as u8; 32])))
            .collect();
        for (idx, pool) in pools.iter().enumerate() {
            let amount = (idx as i128 + 1) * 100;
            assert!(add_volume(&env, pool, amount).is_ok());
        }
        for (idx, pool) in pools.iter().enumerate() {
            let expected = (idx as i128 + 1) * 100;
            assert_eq!(read_pool_volume(&env, pool), expected);
        }
        let total_expected: i128 = (1..=10).map(|i| i * 100).sum();
        assert_eq!(read_total_volume(&env), total_expected);
    }
}