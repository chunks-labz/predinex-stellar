// contracts/pool/src/contract.rs
//! Pool contract implementation with duration extension capability.
//!
//! This contract manages a pool lifecycle, allowing the creator to extend
//! the pool's expiry before it ends, up to a maximum total duration.
//!
//! # Events
//!
//! * `pool_duration_extended` – emitted when the pool expiry is extended.
//!   Topics: `(Symbol("dur_ext"), BytesN<32> pool_id)`
//!   Data: `u64 new_expiry`
//!
//! # Logging
//!
//! Optional logging is available via the `logging` feature. When enabled,
//! informational and error messages are recorded using `env.log()`.
//! This should be used only during development due to cost implications.

#![deny(missing_docs, unsafe_code)]
#![deny(clippy::all, clippy::pedantic)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Symbol,
};

/// Maximum total duration of a pool since creation (1,000,000 seconds).
const MAX_POOL_DURATION_SECS: u64 = 1_000_000;

/// Event topic for pool duration extension.
const POOL_DURATION_EXTENDED: Symbol = symbol_short!("dur_ext");

/// Errors returned by pool functions.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PoolError {
    /// The pool does not exist.
    PoolNotFound = 1,
    /// Only the pool creator can perform this action.
    Unauthorized = 2,
    /// The pool is not in Open state.
    PoolNotOpen = 3,
    /// The pool has already expired.
    PoolExpired = 4,
    /// The new expiry must be greater than the current expiry.
    ExpiryMustIncrease = 5,
    /// The new expiry exceeds the maximum allowed duration.
    MaxDurationExceeded = 6,
    /// The new expiry must be in the future (after current ledger time).
    ExpiryMustBeFuture = 7,
    /// The pool is frozen or disputed and cannot be modified.
    PoolLocked = 8,
}

/// Possible states of a pool.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PoolState {
    /// Pool is open and can be interacted with.
    Open,
    /// Pool is frozen due to an ongoing investigation.
    Frozen,
    /// Pool is under dispute resolution.
    Disputed,
    /// Pool has been settled.
    Settled,
    /// Pool has been voided.
    Voided,
}

/// Core data stored for each pool.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolData {
    /// Address of the pool creator.
    pub creator: Address,
    /// Timestamp of pool creation (Unix epoch seconds).
    pub created_at: u64,
    /// Current expiry timestamp (Unix epoch seconds).
    pub expiry: u64,
    /// Current state of the pool.
    pub state: PoolState,
}

/// Storage keys.
#[contracttype]
pub enum DataKey {
    /// Key for pool data by its 32-byte identifier.
    Pool(BytesN<32>),
}

/// Pool contract.
#[contract]
pub struct PoolContract;

#[contractimpl]
impl PoolContract {
    /// Extends the expiry of a pool.
    ///
    /// # Arguments
    ///
    /// * `env` – Soroban environment.
    /// * `pool_id` – Unique identifier of the pool (32-byte hash).
    /// * `new_expiry` – New expiry timestamp in seconds since Unix epoch.
    ///
    /// # Errors
    ///
    /// * [`PoolError::PoolNotFound`] – The pool does not exist.
    /// * [`PoolError::Unauthorized`] – Caller is not the pool creator.
    /// * [`PoolError::PoolNotOpen`] – Pool is not in Open state.
    /// * [`PoolError::PoolExpired`] – Pool expiry is already in the past.
    /// * [`PoolError::ExpiryMustIncrease`] – `new_expiry` is not greater than current expiry.
    /// * [`PoolError::MaxDurationExceeded`] – `new_expiry` > creation + `MAX_POOL_DURATION_SECS`.
    /// * [`PoolError::ExpiryMustBeFuture`] – `new_expiry` is not after the current ledger timestamp.
    /// * [`PoolError::PoolLocked`] – Pool is frozen or disputed.
    ///
    /// # Panics
    ///
    /// This function does not panic under normal error conditions. All errors are
    /// returned as `Result`.
    ///
    /// # Performance
    ///
    /// Performs a single storage read and write. Uses `checked_add` to avoid
    /// arithmetic overflow.
    pub fn extend_duration(
        env: Env,
        pool_id: BytesN<32>,
        new_expiry: u64,
    ) -> Result<(), PoolError> {
        // --------------------------------------------------------------------
        // 1. Load pool data or return PoolNotFound
        // --------------------------------------------------------------------
        let key = DataKey::Pool(pool_id.clone());
        let mut pool: PoolData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(PoolError::PoolNotFound)?;

        // --------------------------------------------------------------------
        // 2. Authorization: only the pool creator may extend duration
        // --------------------------------------------------------------------
        let caller = env.invoker();
        if caller != pool.creator {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Unauthorized caller",
                    &caller,
                    "expected",
                    &pool.creator,
                ),
            );
            return Err(PoolError::Unauthorized);
        }

        // --------------------------------------------------------------------
        // 3. State check – must be Open (Frozen/Disputed cannot be modified)
        // --------------------------------------------------------------------
        if matches!(pool.state, PoolState::Frozen | PoolState::Disputed) {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Pool locked",
                    &pool_id,
                    "state",
                    &pool.state,
                ),
            );
            return Err(PoolError::PoolLocked);
        }
        if pool.state != PoolState::Open {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Pool not open",
                    &pool_id,
                    "state",
                    &pool.state,
                ),
            );
            return Err(PoolError::PoolNotOpen);
        }

        // --------------------------------------------------------------------
        // 4. Check current pool expiry is not already expired
        //    (ledger timestamp must be strictly less than current expiry)
        // --------------------------------------------------------------------
        let current_time = env.ledger().timestamp();
        if current_time >= pool.expiry {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Pool already expired",
                    &pool_id,
                    "current_time",
                    &current_time,
                    "expiry",
                    &pool.expiry,
                ),
            );
            return Err(PoolError::PoolExpired);
        }

        // --------------------------------------------------------------------
        // 5. New expiry must be strictly greater than current expiry
        // --------------------------------------------------------------------
        if new_expiry <= pool.expiry {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Expiry must increase",
                    "new_expiry",
                    &new_expiry,
                    "current_expiry",
                    &pool.expiry,
                ),
            );
            return Err(PoolError::ExpiryMustIncrease);
        }

        // --------------------------------------------------------------------
        // 6. New expiry must be in the future (after current ledger time)
        // --------------------------------------------------------------------
        if new_expiry <= current_time {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Expiry must be in the future",
                    "new_expiry",
                    &new_expiry,
                    "current_time",
                    &current_time,
                ),
            );
            return Err(PoolError::ExpiryMustBeFuture);
        }

        // --------------------------------------------------------------------
        // 7. Enforce maximum total duration cap (from creation time)
        // --------------------------------------------------------------------
        let max_allowed = pool
            .created_at
            .checked_add(MAX_POOL_DURATION_SECS)
            .ok_or(PoolError::MaxDurationExceeded)?; // overflow means we definitely exceeded

        if new_expiry > max_allowed {
            #[cfg(feature = "logging")]
            env.log(
                &(
                    "Max duration exceeded",
                    "new_expiry",
                    &new_expiry,
                    "max_allowed",
                    &max_allowed,
                ),
            );
            return Err(PoolError::MaxDurationExceeded);
        }

        // --------------------------------------------------------------------
        // 8. Update pool expiry and persist
        // --------------------------------------------------------------------
        pool.expiry = new_expiry;
        env.storage().persistent().set(&key, &pool);

        // --------------------------------------------------------------------
        // 9. Emit event for external observers
        // --------------------------------------------------------------------
        env.events().publish(
            (POOL_DURATION_EXTENDED, pool_id.clone()),
            new_expiry,
        );

        // --------------------------------------------------------------------
        // 10. Optional success logging
        // --------------------------------------------------------------------
        #[cfg(feature = "logging")]
        env.log(
            &(
                "Pool duration extended",
                &pool_id,
                "new_expiry",
                &new_expiry,
            ),
        );

        Ok(())
    }

    /// Retrieves the pool data for a given pool ID.
    ///
    /// # Arguments
    ///
    /// * `env` – Soroban environment.
    /// * `pool_id` – Unique identifier of the pool (32-byte hash).
    ///
    /// # Returns
    ///
    /// * `Option<PoolData>` – The pool data if found, `None` otherwise.
    ///
    /// # Performance
    ///
    /// Single storage read.
    pub fn get_pool(env: Env, pool_id: BytesN<32>) -> Option<PoolData> {
        let key = DataKey::Pool(pool_id);
        env.storage().persistent().get(&key)
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, BytesN as _, Ledger, LedgerInfo},
        Address, Env, IntoVal, Symbol,
    };
    use soroban_sdk::xdr::ContractEvent;
    use soroban_sdk::testutils::Events;

    /// Helper to create a minimal test environment with a pool.
    fn setup_pool(env: &Env, created_at_offset: u64, expiry_offset: u64, state: PoolState) -> (Address, BytesN<32>, PoolData) {
        let creator = Address::generate(env);
        let pool_id = BytesN::<32>::random(env);
        let created_at = env.ledger().timestamp() + created_at_offset;
        let expiry = env.ledger().timestamp() + expiry_offset;

        let pool = PoolData {
            creator: creator.clone(),
            created_at,
            expiry,
            state,
        };

        let key = DataKey::Pool(pool_id.clone());
        env.storage().persistent().set(&key, &pool);

        (creator, pool_id, pool)
    }

    #[test]
    fn test_successful_extension() {
        let env = Env::default();
        // Set current ledger time to 1000
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // Current time = 1000, created_at = 1000, expiry = 6000
        let new_expiry = 7000_u64;

        // Extend as creator
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), new_expiry);
        assert!(result.is_ok());

        // Verify updated pool
        let updated = PoolContract::get_pool(env.clone(), pool_id.clone()).unwrap();
        assert_eq!(updated.expiry, new_expiry);

        // Verify event
        let events = env.events().all();
        assert_eq!(events.len(), 1);
        let (contract_id, topics, data) = &events[0];
        assert_eq!(topics.len(), 2);
        assert_eq!(topics[0], Symbol::new(&env, "dur_ext").into_val(&env));
        assert_eq!(topics[1], pool_id.into_val(&env));
        assert_eq!(data, new_expiry.into_val(&env));
    }

    #[test]
    fn test_authorization_fails() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let other = Address::generate(&env);

        // Switch invoker to other
        env.invoker().set(&other);
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 7000);
        assert_eq!(result, Err(PoolError::Unauthorized));
    }

    #[test]
    fn test_pool_not_found() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let pool_id = BytesN::<32>::random(&env);
        let result = PoolContract::extend_duration(env, pool_id, 2000);
        assert_eq!(result, Err(PoolError::PoolNotFound));
    }

    #[test]
    fn test_expired_pool_rejected() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 2000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        // Create pool with expiry at 1500 (already expired at ledger time 2000)
        let (creator, pool_id, _) = setup_pool(&env, 0, -500, PoolState::Open);
        // current time = 2000, expiry = 1500 (so expired)
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 3000);
        assert_eq!(result, Err(PoolError::PoolExpired));
    }

    #[test]
    fn test_expiry_must_increase() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // current expiry = 6000, try to set same or lower
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 6000);
        assert_eq!(result, Err(PoolError::ExpiryMustIncrease));
    }

    #[test]
    fn test_max_duration_exceeded() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        // Pool created at time 1000, so max allowed = 1000 + 1_000_000 = 1_001_000
        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let too_big = 1_001_001;
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), too_big);
        assert_eq!(result, Err(PoolError::MaxDurationExceeded));
    }

    #[test]
    fn test_expiry_must_be_future() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 2000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // current time = 2000, expiry = 7000, try to set new_expiry = 1500 (past)
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 1500);
        assert_eq!(result, Err(PoolError::ExpiryMustBeFuture));
    }

    #[test]
    fn test_frozen_pool_locked() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Frozen);
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 7000);
        assert_eq!(result, Err(PoolError::PoolLocked));
    }

    #[test]
    fn test_disputed_pool_locked() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Disputed);
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 7000);
        assert_eq!(result, Err(PoolError::PoolLocked));
    }

    #[test]
    fn test_non_open_state_rejected() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        for state in &[PoolState::Settled, PoolState::Voided] {
            let (creator, pool_id, _) = setup_pool(&env, 0, 5000, *state);
            let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), 7000);
            assert_eq!(result, Err(PoolError::PoolNotOpen));
        }
    }

    #[test]
    fn test_boundary_max_duration_allowed() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        // Pool created at 1000, max allowed = 1_001_000
        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let max_allowed = 1_001_000;
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), max_allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_boundary_max_duration_exceeded_by_one() {
        let env = Env::default();
        env.ledger().set(LedgerInfo {
            timestamp: 1000,
            protocol_version: 20,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 10,
            min_temp_entry_ttl: 1000,
            min_persistent_entry_ttl: 1000,
            max_entry_ttl: 2000000,
        });

        let (creator, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let too_big = 1_001_001;
        let result = PoolContract::extend_duration(env.clone(), pool_id.clone(), too_big);
        assert_eq!(result, Err(PoolError::MaxDurationExceeded));
    }
}