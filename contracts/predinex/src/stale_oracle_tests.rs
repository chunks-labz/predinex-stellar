#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    testutils::Ledger,
    Address, Env, String,
};

use crate::{
    PredinexContract, PredinexContractClient, ContractError, MIN_CREATOR_DEPOSIT,
};

/// Test environment for stale oracle circuit breaker tests.
struct OracleTestEnv {
    env: Env,
    client: PredinexContractClient<'static>,
    treasury: Address,
    creator: Address,
    bettor: Address,
}

fn oracle_setup() -> OracleTestEnv {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let creator = Address::generate(&env);
    let bettor = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> =
        PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token, &treasury, &treasury);

    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    token_admin.mint(&bettor, &100_000_000i128);
    token_admin.mint(&treasury, &(MIN_CREATOR_DEPOSIT * 10));

    OracleTestEnv {
        env,
        client,
        treasury,
        creator,
        bettor,
    }
}

/// Create a standard 2-outcome pool with a 2-hour duration.
fn make_pool(t: &OracleTestEnv) -> u32 {
    t.client.create_pool(
        &t.creator,
        &String::from_str(&t.env, "Oracle test pool"),
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &7_200u64, // 2 hours — leaves room for time advances in tests
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

// ─── Threshold config ─────────────────────────────────────────────────────

/// Treasury recipient can set and read the oracle staleness threshold.
#[test]
fn test_set_stale_oracle_threshold() {
    let t = oracle_setup();
    let threshold: u64 = 300; // 5 minutes

    t.client.set_stale_oracle_threshold(&t.treasury, &threshold);

    assert_eq!(t.client.get_stale_oracle_threshold(), threshold);
}

/// Non-treasury caller is rejected.
#[test]
#[should_panic]
fn test_set_stale_oracle_threshold_unauthorized() {
    let t = oracle_setup();
    let attacker = Address::generate(&t.env);
    t.client.set_stale_oracle_threshold(&attacker, &300u64);
}

/// Default threshold is 0 (disabled).
#[test]
fn test_default_threshold_is_zero() {
    let t = oracle_setup();
    assert_eq!(t.client.get_stale_oracle_threshold(), 0);
}

// ─── Fresh oracle: wagers and settlement succeed ──────────────────────────

/// When threshold is 0 (disabled), bets succeed even without any oracle
/// update — the check is a no-op.
#[test]
fn test_disabled_threshold_allows_bet_without_update() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    // Threshold is 0 (disabled) — no update_twap needed.
    assert_eq!(t.client.is_oracle_fresh(&pool_id), true);

    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);
}

/// When threshold is set and oracle was recently updated, bet succeeds.
#[test]
fn test_fresh_oracle_allows_bet() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);

    // Advance past MIN_UPDATE_INTERVAL (60 s) so update_twap is accepted.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), true);
    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);
}

/// When threshold is set and oracle was recently updated, settlement succeeds.
#[test]
fn test_fresh_oracle_allows_settlement() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    // Use a 2-hour threshold — wide enough to survive the time advances below.
    t.client.set_stale_oracle_threshold(&t.treasury, &7_200u64);

    // Advance past MIN_UPDATE_INTERVAL, place a bet.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);
    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);

    // Expire the pool (advance past the 2-hour pool duration).
    t.env.ledger().with_mut(|li| li.timestamp += 7_300);

    // Refresh the oracle just before settlement.
    t.client.update_twap(&pool_id);

    // Settle — oracle is fresh.
    t.client.settle_pool(&t.creator, &pool_id, &0u32);
}

// ─── Stale oracle: wagers and settlement rejected ─────────────────────────

/// When threshold is set and oracle update is stale, bet is rejected.
#[test]
fn test_stale_oracle_rejects_bet() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);

    // Record a fresh oracle update.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);

    // Advance 301 s past the last update — now stale.
    t.env.ledger().with_mut(|li| li.timestamp += 301);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), false);

    let result = t.client.try_place_bet(
        &t.bettor,
        &pool_id,
        &0u32,
        &1_000_000i128,
        &None::<Address>,
    );
    assert_eq!(result, Err(Ok(ContractError::StaleOraclePrice)));
}

/// When threshold is set and oracle update is stale, settlement is rejected.
#[test]
fn test_stale_oracle_rejects_settlement() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);

    // Record oracle, place a bet while fresh.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);
    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);

    // Expire the pool — 7300 s >> threshold of 300 s, so oracle is stale.
    t.env.ledger().with_mut(|li| li.timestamp += 7_300);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), false);

    let result = t.client.try_settle_pool(&t.creator, &pool_id, &0u32);
    assert_eq!(result, Err(Ok(ContractError::StaleOraclePrice)));
}

// ─── Boundary cases ────────────────────────────────────────────────────────

/// At exactly the threshold age, the oracle is still considered fresh
/// (stale means strictly older than the threshold).
#[test]
fn test_boundary_at_exactly_threshold_is_fresh() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);

    // Record oracle at t=60.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);

    // Advance exactly 300 s — age == threshold, still fresh.
    t.env.ledger().with_mut(|li| li.timestamp += 300);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), true);
    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);
}

/// One second past the threshold, the oracle is stale.
#[test]
fn test_boundary_one_past_threshold_is_stale() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);

    // Record oracle at t=60.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);

    // Advance 301 s — age == threshold + 1, stale.
    t.env.ledger().with_mut(|li| li.timestamp += 301);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), false);
}

/// Setting threshold back to 0 re-enables betting on a previously stale pool.
#[test]
fn test_disabling_threshold_unblocks_stale_pool() {
    let t = oracle_setup();
    let pool_id = make_pool(&t);

    t.client.set_stale_oracle_threshold(&t.treasury, &300u64);
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);

    // Advance past the staleness threshold but keep the pool alive (< 7200 s).
    t.env.ledger().with_mut(|li| li.timestamp += 1_000);

    assert_eq!(t.client.is_oracle_fresh(&pool_id), false);

    // Disable the staleness check.
    t.client.set_stale_oracle_threshold(&t.treasury, &0u64);

    // Check is disabled — pool is now "fresh".
    assert_eq!(t.client.is_oracle_fresh(&pool_id), true);

    // Bet succeeds.
    t.client.place_bet(&t.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);
}
