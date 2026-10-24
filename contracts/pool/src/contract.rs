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

// missing_docs is a warn, not a deny: soroban-sdk's #[contract]/#[contracttype]/
// #[contracterror] macros generate associated items (constructors, client
// methods) that carry no doc comments of their own, which trips missing_docs
// on code this crate doesn't author. unsafe_code stays denied.
#![warn(missing_docs)]
#![deny(unsafe_code)]
#![deny(clippy::all, clippy::pedantic)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Symbol,
};

/// Maximum total duration of a pool since creation (365 days).
const MAX_POOL_DURATION_SECS: u64 = 31_536_000;

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
        pool.creator.require_auth();

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
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, BytesN as _, Ledger, Events},
        xdr, Address, Env, IntoVal, Symbol, TryFromVal,
    };

    /// Converts a contract value to the XDR form used inside emitted events.
    fn sc_val<T>(env: &Env, value: T) -> xdr::ScVal
    where
        T: IntoVal<Env, soroban_sdk::Val>,
    {
        xdr::ScVal::try_from_val(env, &value.into_val(env)).unwrap()
    }

    /// Sets the simulated ledger timestamp, leaving the rest of the ledger
    /// info at the host's defaults.
    ///
    /// #1305 — these tests each built a `LedgerInfo` literal with
    /// `protocol_version: 20`, below the host minimum of 22, so the whole
    /// module failed with "ledger protocol version too old for host" and never
    /// ran. Deriving from the current ledger keeps the protocol version valid
    /// across SDK upgrades instead of pinning a number that silently rots.
    fn set_ledger_timestamp(env: &Env, timestamp: u64) {
        let mut info = env.ledger().get();
        info.timestamp = timestamp;
        env.ledger().set(info);
    }

    /// Registers a fresh `PoolContract` and seeds one pool fixture for it.
    ///
    /// Returns `(contract_id, pool_id, pool)`.
    ///
    /// #1305 — the pool is written inside `env.as_contract` and the contract is
    /// registered, because `env.storage()` is inaccessible outside a contract
    /// frame and because the tests below invoke through a client. Previously
    /// the fixture was written bare, so every test in this module trapped at
    /// setup and none of them ever ran.
    fn setup_pool(
        env: &Env,
        created_at_offset: u64,
        expiry_offset: u64,
        state: PoolState,
    ) -> (Address, BytesN<32>, PoolData) {
        let contract_id = env.register(PoolContract, ());
        let creator = Address::generate(env);
        let pool_id = BytesN::<32>::random(env);
        let created_at = env.ledger().timestamp() + created_at_offset;
        let expiry = env.ledger().timestamp() + expiry_offset;

        let pool = PoolData {
            creator,
            created_at,
            expiry,
            state,
        };

        let key = DataKey::Pool(pool_id.clone());
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(&key, &pool);
        });

        (contract_id, pool_id, pool)
    }

    /// Calls `extend_duration` through the generated client for `contract_id`.
    ///
    /// Uses `try_extend_duration` because the plain client method panics on
    /// error, whereas these tests assert on the returned `PoolError`. The client
    /// returns a nested `Result` (conversion error inside, contract error
    /// outside), which is flattened here so every assertion below reads the same
    /// as it did when the contract was called statically.
    fn extend(
        env: &Env,
        contract_id: &Address,
        pool_id: &BytesN<32>,
        new_expiry: u64,
    ) -> Result<(), PoolError> {
        match PoolContractClient::new(env, contract_id).try_extend_duration(pool_id, &new_expiry) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(conversion)) => panic!("conversion error: {conversion:?}"),
            Err(Ok(contract_error)) => Err(contract_error),
            Err(Err(invoke)) => panic!("invoke error: {invoke:?}"),
        }
    }

    /// Calls `get_pool` through the generated client for `contract_id`.
    fn get_pool(env: &Env, contract_id: &Address, pool_id: &BytesN<32>) -> Option<PoolData> {
        PoolContractClient::new(env, contract_id).get_pool(pool_id)
    }

    #[test]
    fn test_successful_extension() {
        let env = Env::default();
        env.mock_all_auths();
        // Set current ledger time to 1000
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // Current time = 1000, created_at = 1000, expiry = 6000
        let new_expiry = 7000_u64;

        // Extend as creator
        let result = extend(&env, &contract_id, &pool_id, new_expiry);
        assert!(result.is_ok());

        // Verify the event first: in soroban-sdk 27 `env.events().all()` reports
        // only the most recent invocation, so the `get_pool` call below would
        // clear it. #1305 — `ContractEvents` is also neither indexable nor
        // destructurable, so the previous `let (contract_id, topics, data) =
        // &events[0]` could not compile, which is why this whole module, and
        // with it every test in the crate, never ran. Read the XDR body.
        let all_events = env.events().all();
        let events = all_events.events();
        assert_eq!(events.len(), 1);
        let xdr::ContractEventBody::V0(body) = &events[0].body else {
            panic!("expected a V0 contract event body");
        };
        assert_eq!(body.topics.len(), 2);
        assert_eq!(
            body.topics.get(0).cloned(),
            Some(sc_val(&env, Symbol::new(&env, "dur_ext")))
        );
        assert_eq!(
            body.topics.get(1).cloned(),
            Some(sc_val(&env, pool_id.clone()))
        );
        assert_eq!(body.data, sc_val(&env, new_expiry));

        // Verify updated pool
        let updated = get_pool(&env, &contract_id, &pool_id).unwrap();
        assert_eq!(updated.expiry, new_expiry);
    }

    #[test]
    #[should_panic]
    fn test_authorization_fails() {
        // extend_duration takes no explicit caller argument — it authorizes
        // via `pool.creator.require_auth()`. Without mock_all_auths() (or a
        // matching set_auths() entry), the host has no authorization for
        // that address and require_auth() traps.
        let env = Env::default();
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let _ = extend(&env, &contract_id, &pool_id, 7000);
    }

    #[test]
    fn test_pool_not_found() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        let contract_id = env.register(PoolContract, ());
        let pool_id = BytesN::<32>::random(&env);
        let result = extend(&env, &contract_id, &pool_id, 2000);
        assert_eq!(result, Err(PoolError::PoolNotFound));
    }

    #[test]
    fn test_expired_pool_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        // Create pool with expiry at 1500 (offsets are relative to the
        // current ledger timestamp of 1000, and are u64 so must be
        // non-negative — advance the ledger past expiry afterwards instead
        // of trying to create an already-past expiry directly).
        let (contract_id, pool_id, _) = setup_pool(&env, 0, 500, PoolState::Open);
        set_ledger_timestamp(&env, 2000);
        // current time = 2000, expiry = 1500 (so expired)
        let result = extend(&env, &contract_id, &pool_id, 3000);
        assert_eq!(result, Err(PoolError::PoolExpired));
    }

    #[test]
    fn test_expiry_must_increase() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // current expiry = 6000, try to set same or lower
        let result = extend(&env, &contract_id, &pool_id, 6000);
        assert_eq!(result, Err(PoolError::ExpiryMustIncrease));
    }

    #[test]
    fn test_max_duration_exceeded() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        // #1305 — this test pinned the literal 1_001_001, which was derived from
        // a long-removed 1,000,000-second cap. The cap is now
        // MAX_POOL_DURATION_SECS (365 days), so derive the boundary from the
        // constant instead of a magic number that silently stops testing
        // anything.
        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let too_big = 1_000 + MAX_POOL_DURATION_SECS + 1;
        let result = extend(&env, &contract_id, &pool_id, too_big);
        assert_eq!(result, Err(PoolError::MaxDurationExceeded));
    }

    /// #1305 — this test previously asserted `PoolError::ExpiryMustBeFuture`,
    /// which is unreachable: step 4 rejects when `current_time >= pool.expiry`
    /// (so `pool.expiry > current_time`) and step 5 rejects when
    /// `new_expiry <= pool.expiry` (so `new_expiry > pool.expiry`), which
    /// together make step 6's `new_expiry <= current_time` condition
    /// impossible. A past `new_expiry` is therefore caught one step earlier, as
    /// a decrease. The contract keeps the step 6 check as defence in depth; this
    /// test pins the behaviour that is actually reachable.
    #[test]
    fn test_past_expiry_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 2000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        // current time = 2000, expiry = 7000, try to set new_expiry = 1500 (past)
        let result = extend(&env, &contract_id, &pool_id, 1500);
        assert_eq!(result, Err(PoolError::ExpiryMustIncrease));
    }

    #[test]
    fn test_frozen_pool_locked() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Frozen);
        let result = extend(&env, &contract_id, &pool_id, 7000);
        assert_eq!(result, Err(PoolError::PoolLocked));
    }

    #[test]
    fn test_disputed_pool_locked() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Disputed);
        let result = extend(&env, &contract_id, &pool_id, 7000);
        assert_eq!(result, Err(PoolError::PoolLocked));
    }

    #[test]
    fn test_non_open_state_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        for state in &[PoolState::Settled, PoolState::Voided] {
            let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, *state);
            let result = extend(&env, &contract_id, &pool_id, 7000);
            assert_eq!(result, Err(PoolError::PoolNotOpen));
        }
    }

    #[test]
    fn test_boundary_max_duration_allowed() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        // Pool created at 1000, so the cap is 1000 + MAX_POOL_DURATION_SECS.
        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let max_allowed = 1_000 + MAX_POOL_DURATION_SECS;
        let result = extend(&env, &contract_id, &pool_id, max_allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_boundary_max_duration_exceeded_by_one() {
        let env = Env::default();
        env.mock_all_auths();
        set_ledger_timestamp(&env, 1000);

        let (contract_id, pool_id, _) = setup_pool(&env, 0, 5000, PoolState::Open);
        let too_big = 1_000 + MAX_POOL_DURATION_SECS + 1;
        let result = extend(&env, &contract_id, &pool_id, too_big);
        assert_eq!(result, Err(PoolError::MaxDurationExceeded));
    }
}
