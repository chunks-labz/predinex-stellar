#[cfg(test)]
mod test {
    use soroban_sdk::{
        contract, contractimpl, testutils::*, Address, Env, IntoVal, Symbol, TryIntoVal, BytesN,
        Vec,
    };
    use crate::{PoolContract, PoolContractClient, PoolDataKey, PoolState, MAX_POOL_DURATION_SECS};

    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------
    const CREATION_TIMESTAMP: u64 = 1000;
    const INITIAL_DURATION: u64 = 100;
    const EXTENDED_DURATION: u64 = 200;
    const EXTENDED_EXPIRY: u64 = CREATION_TIMESTAMP + EXTENDED_DURATION;
    const MAX_BOUNDARY_EXPIRY: u64 = CREATION_TIMESTAMP + MAX_POOL_DURATION_SECS;
    const AFTER_EXPIRY_TIMESTAMP: u64 = CREATION_TIMESTAMP + INITIAL_DURATION + 100; // 1200

    /// Panic message constants – ensures consistency and avoids typos.
    const ERR_UNAUTHORIZED: &str = "unauthorized";
    const ERR_POOL_EXPIRED: &str = "pool expired";
    const ERR_NOT_OPEN: &str = "not open";
    const ERR_EXCEEDS_MAX: &str = "exceeds max duration";
    const ERR_DURATION_DECREASE: &str = "duration cannot decrease";

    // ---------------------------------------------------------------------------
    // Test helpers
    // ---------------------------------------------------------------------------

    /// Registers a new `PoolContract`, initializes a pool, and returns the pool ID.
    ///
    /// # Arguments
    /// * `env` - The test environment.
    /// * `creator` - The address that will own the pool.
    /// * `initial_duration_secs` - Initial pool duration in seconds.
    ///
    /// # Returns
    /// A `BytesN<32>` pool identifier.
    fn create_pool(
        env: &Env,
        creator: &Address,
        initial_duration_secs: u64,
    ) -> (BytesN<32>, Address) {
        let contract_id = env.register_contract(None, PoolContract);
        let client = PoolContractClient::new(env, &contract_id);
        env.mock_all_auths(); // creator is authenticated for init
        let pool_id: BytesN<32> = client.init(creator, &(initial_duration_secs as u64));
        (pool_id, contract_id)
    }

    /// Returns the current pool expiry timestamp from storage.
    fn get_pool_expiry(env: &Env, contract_id: &Address, pool_id: &BytesN<32>) -> u64 {
        let client = PoolContractClient::new(env, contract_id);
        client.get_pool_expiry(pool_id)
    }

    /// Sets the simulated ledger timestamp.
    fn set_ledger_timestamp(env: &Env, timestamp: u64) {
        env.ledger().set(Ledger::Timestamp, timestamp);
    }

    /// Sets the initial timestamp to `CREATION_TIMESTAMP` and creates a standard test pool.
    /// Returns a tuple of `(contract_id, pool_id)`.
    fn setup_pool(env: &Env, creator: &Address) -> (Address, BytesN<32>) {
        let contract_id = env.register_contract(None, PoolContract);
        let client = PoolContractClient::new(env, &contract_id);
        env.mock_all_auths();
        let pool_id = client.init(creator, &(INITIAL_DURATION as u64));
        set_ledger_timestamp(env, CREATION_TIMESTAMP);
        (contract_id, pool_id)
    }

    /// Calls `extend_duration` with all auths mocked (for the contract caller).
    /// # Panics
    /// Panics if the call fails (e.g., unauthorized, expired).
    fn extend_pool_duration(
        env: &Env,
        contract_id: &Address,
        pool_id: &BytesN<32>,
        new_expiry: u64,
    ) {
        env.mock_all_auths();
        let client = PoolContractClient::new(env, contract_id);
        client.extend_duration(pool_id, &new_expiry);
    }

    /// Sets the pool state to a given `PoolState` directly in storage.
    /// Used to simulate frozen/disputed pools without a dedicated state‑change function.
    fn set_pool_state(
        env: &Env,
        contract_id: &Address,
        pool_id: &BytesN<32>,
        state: PoolState,
    ) {
        env.as_contract(contract_id, || {
            let data_key = PoolDataKey::PoolState(pool_id.clone());
            env.storage().set(&data_key, &state);
        });
    }

    /// Extracts a single event by topic; panics if not exactly one.
    fn get_single_event(
        env: &Env,
        topic: &Symbol,
    ) -> (Symbol, BytesN<32>, u64) {
        let events: Vec<(Symbol, BytesN<32>, u64)> = env
            .events()
            .all()
            .into_iter()
            .filter(|e| e.0 == *topic)
            .collect();
        assert_eq!(
            events.len(),
            1,
            "Expected exactly one event with topic {:?}",
            topic
        );
        events.get(0).unwrap().clone()
    }

    // ---------------------------------------------------------------------------
    // Tests: successful extension
    // ---------------------------------------------------------------------------

    /// Verifies:
    /// - Pool creator can extend duration before expiry.
    /// - Expiry timestamp is updated correctly.
    /// - `pool_duration_extended` event is emitted with the new expiry.
    #[test]
    fn test_extend_duration_success() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Extend to CREATION_TIMESTAMP + 200 (still before initial expiry)
        extend_pool_duration(&env, &contract_id, &pool_id, EXTENDED_EXPIRY);

        let actual_expiry = get_pool_expiry(&env, &contract_id, &pool_id);
        assert_eq!(
            actual_expiry, EXTENDED_EXPIRY,
            "Pool expiry should be updated to the new value, but got {}",
            actual_expiry
        );

        // Verify the `pool_duration_extended` event was emitted with correct data
        let (_, _, data) = get_single_event(
            &env,
            &Symbol::new(&env, "pool_duration_extended"),
        );
        assert_eq!(
            data, EXTENDED_EXPIRY,
            "Event data should contain the new expiry, but got {}",
            data
        );
    }

    /// Tests extension to the maximum allowed duration.
    #[test]
    fn test_extend_duration_max_boundary() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Extend to exactly MAX_POOL_DURATION_SECS from creation
        extend_pool_duration(&env, &contract_id, &pool_id, MAX_BOUNDARY_EXPIRY);

        let actual_expiry = get_pool_expiry(&env, &contract_id, &pool_id);
        assert_eq!(
            actual_expiry, MAX_BOUNDARY_EXPIRY,
            "Pool expiry should be exactly the maximum allowed, but got {}",
            actual_expiry
        );

        // Verify event
        let (_, _, data) = get_single_event(
            &env,
            &Symbol::new(&env, "pool_duration_extended"),
        );
        assert_eq!(
            data, MAX_BOUNDARY_EXPIRY,
            "Event data should contain boundary expiry, but got {}",
            data
        );
    }

    // ---------------------------------------------------------------------------
    // Tests: authorization failure
    // ---------------------------------------------------------------------------

    /// Verifies that an address which is not the pool creator cannot extend the duration.
    /// The test relies on `mock_all_auths` not being called for the caller,
    /// so the contract will reject the operation with `ERR_UNAUTHORIZED`.
    #[test]
    #[should_panic(expected = "unauthorized")]
    fn test_extend_duration_not_creator() {
        let env = Env::default();
        let creator = Address::random(&env);
        let other = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Do NOT mock auths – the `other` address lacks authorization.
        let client = PoolContractClient::new(&env, &contract_id);
        client.extend_duration(&pool_id, &EXTENDED_EXPIRY);
    }

    // ---------------------------------------------------------------------------
    // Tests: pool already expired
    // ---------------------------------------------------------------------------

    /// Verifies that extending an expired pool is rejected.
    #[test]
    #[should_panic(expected = "pool expired")]
    fn test_extend_duration_expired() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Advance ledger timestamp past the initial expiry
        set_ledger_timestamp(&env, AFTER_EXPIRY_TIMESTAMP);

        // Attempt to extend; should panic because pool is expired
        extend_pool_duration(&env, &contract_id, &pool_id, EXTENDED_EXPIRY);
    }

    // ---------------------------------------------------------------------------
    // Tests: pool not open (frozen)
    // ---------------------------------------------------------------------------

    /// Verifies that extending a frozen pool is rejected.
    #[test]
    #[should_panic(expected = "not open")]
    fn test_extend_duration_frozen() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Set pool state to Frozen
        set_pool_state(&env, &contract_id, &pool_id, PoolState::Frozen);

        // Attempt to extend; should panic because pool is not Open
        extend_pool_duration(&env, &contract_id, &pool_id, EXTENDED_EXPIRY);
    }

    // ---------------------------------------------------------------------------
    // Tests: pool not open (disputed)
    // ---------------------------------------------------------------------------

    /// Verifies that extending a disputed pool is rejected.
    #[test]
    #[should_panic(expected = "not open")]
    fn test_extend_duration_disputed() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Set pool state to Disputed
        set_pool_state(&env, &contract_id, &pool_id, PoolState::Disputed);

        // Attempt to extend; should panic because pool is not Open
        extend_pool_duration(&env, &contract_id, &pool_id, EXTENDED_EXPIRY);
    }

    // ---------------------------------------------------------------------------
    // Tests: duration cannot decrease
    // ---------------------------------------------------------------------------

    /// Verifies that extending to a smaller expiry than current is rejected.
    #[test]
    #[should_panic(expected = "duration cannot decrease")]
    fn test_extend_duration_decrease() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Try to extend to a value less than current expiry (CREATION_TIMESTAMP + INITIAL_DURATION = 1100)
        // Current expiry = CREATION_TIMESTAMP + INITIAL_DURATION = 1100.
        // Attempt to set expiry to 1050 (decrease)
        extend_pool_duration(&env, &contract_id, &pool_id, CREATION_TIMESTAMP + 50);
    }

    // ---------------------------------------------------------------------------
    // Tests: exceeds maximum total duration
    // ---------------------------------------------------------------------------

    /// Verifies that extending beyond MAX_POOL_DURATION_SECS from creation is rejected.
    #[test]
    #[should_panic(expected = "exceeds max duration")]
    fn test_extend_duration_exceeds_max() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        // Attempt to extend to one second over the maximum
        let over_max = MAX_BOUNDARY_EXPIRY + 1;
        extend_pool_duration(&env, &contract_id, &pool_id, over_max);
    }

    // ---------------------------------------------------------------------------
    // Additional edge case: zero extension (no change)
    // ---------------------------------------------------------------------------

    /// Verifies that extending to the same expiry is allowed (no decrease).
    #[test]
    fn test_extend_duration_same_expiry() {
        let env = Env::default();
        let creator = Address::random(&env);
        let (contract_id, pool_id) = setup_pool(&env, &creator);

        let current_expiry = CREATION_TIMESTAMP + INITIAL_DURATION; // 1100
        extend_pool_duration(&env, &contract_id, &pool_id, current_expiry);

        let actual_expiry = get_pool_expiry(&env, &contract_id, &pool_id);
        assert_eq!(
            actual_expiry, current_expiry,
            "Pool expiry should remain the same"
        );

        // Event should still be emitted
        let (_, _, data) = get_single_event(
            &env,
            &Symbol::new(&env, "pool_duration_extended"),
        );
        assert_eq!(data, current_expiry, "Event data should equal current expiry");
    }
}