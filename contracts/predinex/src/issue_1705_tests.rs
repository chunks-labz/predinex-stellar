//! Issue #1705 — Validate oracle price freshness before settlement.
//!
//! The settlement path already calls `check_oracle_freshness`, and
//! `stale_oracle_tests.rs` covers the happy and unhappy paths at a general
//! level. These tests nail down the three acceptance criteria from #1705 as
//! a self-contained regression:
//!   - Fresh prices settle normally.
//!   - Stale prices block settlement with the explicit `StaleOraclePrice`
//!     error (clear, not a panic or a generic failure).
//!   - The maximum age is an explicit, queryable configuration value and is
//!     covered end-to-end (set → read-back → settlement honours it).

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::{ContractError, PredinexContract, PredinexContractClient, MIN_CREATOR_DEPOSIT};

const MAX_AGE_SECS: u64 = 600; // 10 minutes — the explicit max age under test.

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    treasury: Address,
    creator: Address,
    bettor: Address,
}

fn setup() -> Ctx {
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

    let sac = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    sac.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    sac.mint(&bettor, &100_000_000i128);

    Ctx {
        env,
        client,
        treasury,
        creator,
        bettor,
    }
}

fn make_pool(c: &Ctx) -> u32 {
    c.client.create_pool(
        &c.creator,
        &String::from_str(&c.env, "Freshness test pool"),
        &String::from_str(&c.env, "#1705 pool"),
        &String::from_str(&c.env, "Yes"),
        &String::from_str(&c.env, "No"),
        &7_200u64,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

/// The max age is explicit: set it and read it back through the public getter.
#[test]
fn configured_max_age_is_readable() {
    let c = setup();
    assert_eq!(c.client.get_stale_oracle_threshold(), 0);

    c.client
        .set_stale_oracle_threshold(&c.treasury, &MAX_AGE_SECS);

    assert_eq!(c.client.get_stale_oracle_threshold(), MAX_AGE_SECS);
}

/// With the max age configured, a settlement whose oracle update sits within
/// the window succeeds normally.
#[test]
fn settlement_with_fresh_price_succeeds() {
    let c = setup();
    let pool_id = make_pool(&c);

    c.client
        .set_stale_oracle_threshold(&c.treasury, &MAX_AGE_SECS);

    c.env.ledger().with_mut(|li| li.timestamp += 60);
    c.client.update_twap(&pool_id);
    c.client
        .place_bet(&c.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);

    // Let the pool expire, then refresh the oracle right before settlement so
    // the age is well within the configured max.
    c.env.ledger().with_mut(|li| li.timestamp += 7_300);
    c.client.update_twap(&pool_id);

    c.client.settle_pool(&c.creator, &pool_id, &0u32);
}

/// With the max age configured, a settlement whose last oracle update predates
/// the window is blocked with the explicit `StaleOraclePrice` error — not a
/// panic, not a generic settlement error.
#[test]
fn settlement_with_stale_price_is_blocked_with_clear_error() {
    let c = setup();
    let pool_id = make_pool(&c);

    c.client
        .set_stale_oracle_threshold(&c.treasury, &MAX_AGE_SECS);

    c.env.ledger().with_mut(|li| li.timestamp += 60);
    c.client.update_twap(&pool_id);
    c.client
        .place_bet(&c.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);

    // Advance past the pool expiry and *past* the max age with no further
    // oracle update — the settlement path must reject.
    c.env.ledger().with_mut(|li| li.timestamp += 7_300);

    let result = c.client.try_settle_pool(&c.creator, &pool_id, &0u32);
    assert_eq!(result, Err(Ok(ContractError::StaleOraclePrice)));
}

/// End-to-end coverage of the explicit max age: raising the threshold at
/// runtime takes effect immediately and allows a previously stale pool to
/// settle again.
#[test]
fn raising_max_age_unblocks_previously_stale_settlement() {
    let c = setup();
    let pool_id = make_pool(&c);

    c.client
        .set_stale_oracle_threshold(&c.treasury, &MAX_AGE_SECS);

    c.env.ledger().with_mut(|li| li.timestamp += 60);
    c.client.update_twap(&pool_id);
    c.client
        .place_bet(&c.bettor, &pool_id, &0u32, &1_000_000i128, &None::<Address>);

    c.env.ledger().with_mut(|li| li.timestamp += 7_300);

    // Stale at 600 s max age.
    let stale = c.client.try_settle_pool(&c.creator, &pool_id, &0u32);
    assert_eq!(stale, Err(Ok(ContractError::StaleOraclePrice)));

    // Widen the max age past the actual age — now the same settlement
    // succeeds without any additional oracle update.
    c.client
        .set_stale_oracle_threshold(&c.treasury, &86_400u64);
    assert_eq!(c.client.get_stale_oracle_threshold(), 86_400u64);
    c.client.settle_pool(&c.creator, &pool_id, &0u32);
}
