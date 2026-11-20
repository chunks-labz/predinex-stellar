#![cfg(test)]
//! Regression tests for:
//! * #1617 — market resolution payload validation (`settle_pools`).
//! * #1618 — stale oracle price reads (`get_twap`, `place_multi_asset_bet`).
//! * #1619 — market end timestamp cap on creation.
//! * #1620 — pause checks in administrative flows.

extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

struct GuardEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    treasury: Address,
    creator: Address,
    bettor: Address,
    token: Address,
    alt_token: Address,
}

fn setup() -> GuardEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = 1_000);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let creator = Address::generate(&env);
    let bettor = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(treasury.clone())
        .address();
    let alt_token = env
        .register_stellar_asset_contract_v2(treasury.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token, &treasury, &admin);

    let base = token::StellarAssetClient::new(&env, &token);
    base.mint(&creator, &(MIN_CREATOR_DEPOSIT * 100));
    base.mint(&bettor, &100_000_000i128);
    let alt = token::StellarAssetClient::new(&env, &alt_token);
    alt.mint(&bettor, &100_000_000i128);

    GuardEnv {
        env,
        client,
        admin,
        treasury,
        creator,
        bettor,
        token,
        alt_token,
    }
}

fn make_pool(t: &GuardEnv, duration: u64) -> u32 {
    t.client.create_pool(
        &t.creator,
        &String::from_str(&t.env, "Guard pool"),
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &duration,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

fn settle_request(pool_id: u32, winning_outcome: u32) -> PoolSettleRequest {
    PoolSettleRequest {
        pool_id,
        winning_outcome,
    }
}

// ─── #1617 — resolution payload validation ───────────────────────────────

#[test]
fn test_settle_pools_rejects_duplicate_pool_requests() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    t.client
        .place_bet(&t.bettor, &pool_id, &0, &1_000, &None::<Address>);
    t.client
        .place_bet(&t.bettor, &pool_id, &1, &1_000, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp += 3_601);

    let mut reqs: Vec<PoolSettleRequest> = Vec::new(&t.env);
    reqs.push_back(settle_request(pool_id, 0));
    reqs.push_back(settle_request(pool_id, 1));

    let batch = t.client.settle_pools(&t.admin, &reqs);
    assert_eq!(batch.results.len(), 2);
    assert!(batch.results.get(0).unwrap().success);

    let dup = batch.results.get(1).unwrap();
    assert_eq!(dup.pool_id, pool_id);
    assert!(!dup.success);
    assert_eq!(
        dup.error_code,
        ContractError::DuplicateSettlementRequest as u32
    );

    // The first request's outcome is the one that sticks.
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Settled(0)
    );
}

#[test]
fn test_settle_pools_duplicate_rejected_even_when_first_request_fails() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    t.client
        .place_bet(&t.bettor, &pool_id, &0, &1_000, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp += 3_601);

    // First request is invalid (out-of-range outcome); the duplicate must not
    // get a second attempt within the same batch.
    let mut reqs: Vec<PoolSettleRequest> = Vec::new(&t.env);
    reqs.push_back(settle_request(pool_id, 7));
    reqs.push_back(settle_request(pool_id, 0));

    let batch = t.client.settle_pools(&t.admin, &reqs);
    assert_eq!(
        batch.results.get(0).unwrap().error_code,
        ContractError::InvalidOutcome as u32
    );
    assert_eq!(
        batch.results.get(1).unwrap().error_code,
        ContractError::DuplicateSettlementRequest as u32
    );
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Open
    );
}

#[test]
fn test_settle_pools_distinct_pools_unchanged() {
    let t = setup();
    let pool_a = make_pool(&t, 3_600);
    let pool_b = make_pool(&t, 3_600);
    t.client
        .place_bet(&t.bettor, &pool_a, &0, &1_000, &None::<Address>);
    t.client
        .place_bet(&t.bettor, &pool_b, &1, &1_000, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp += 3_601);

    let mut reqs: Vec<PoolSettleRequest> = Vec::new(&t.env);
    reqs.push_back(settle_request(pool_a, 0));
    reqs.push_back(settle_request(pool_b, 1));

    let batch = t.client.settle_pools(&t.admin, &reqs);
    assert!(batch.results.get(0).unwrap().success);
    assert!(batch.results.get(1).unwrap().success);
}

// ─── #1618 — stale oracle price reads ────────────────────────────────────

#[test]
fn test_get_twap_rejects_stale_oracle() {
    let t = setup();
    let pool_id = make_pool(&t, 7_200);
    t.client
        .place_bet(&t.bettor, &pool_id, &0, &1_000, &None::<Address>);
    t.client.set_stale_oracle_threshold(&t.treasury, &300);

    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);
    // Fresh: within the window.
    assert!(t.client.try_get_twap(&pool_id, &0, &0).is_ok());

    t.env.ledger().with_mut(|li| li.timestamp += 301);
    assert_eq!(
        t.client.try_get_twap(&pool_id, &0, &0),
        Err(Ok(ContractError::StaleOraclePrice))
    );
}

#[test]
fn test_get_twap_unchanged_when_staleness_check_disabled() {
    let t = setup();
    let pool_id = make_pool(&t, 7_200);
    t.client
        .place_bet(&t.bettor, &pool_id, &0, &1_000, &None::<Address>);
    // Threshold 0 (default): no update_twap needed.
    assert!(t.client.try_get_twap(&pool_id, &0, &0).is_ok());
}

fn make_multi_asset_pool(t: &GuardEnv) -> u32 {
    t.client
        .set_token_exchange_rate(&t.treasury, &t.token, &10_000);
    t.client
        .set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000);
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.token.clone());
    allowed.push_back(t.alt_token.clone());
    let mut outcomes = Vec::new(&t.env);
    outcomes.push_back(String::from_str(&t.env, "Yes"));
    outcomes.push_back(String::from_str(&t.env, "No"));
    t.client.create_multi_asset_pool(
        &t.creator,
        &String::from_str(&t.env, "MA guard pool"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &7_200u64,
        &allowed,
        &None,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

#[test]
fn test_multi_asset_bet_rejects_stale_oracle() {
    let t = setup();
    let pool_id = make_multi_asset_pool(&t);
    t.client.set_stale_oracle_threshold(&t.treasury, &300);

    // Never updated → stale.
    assert_eq!(
        t.client.try_place_multi_asset_bet(
            &t.bettor,
            &pool_id,
            &0,
            &1_000,
            &t.alt_token,
            &None::<Address>
        ),
        Err(Ok(ContractError::StaleOraclePrice))
    );

    // Fresh update → bet accepted.
    t.env.ledger().with_mut(|li| li.timestamp += 60);
    t.client.update_twap(&pool_id);
    t.client.place_multi_asset_bet(
        &t.bettor,
        &pool_id,
        &0,
        &1_000,
        &t.alt_token,
        &None::<Address>,
    );
}

// ─── #1619 — market end timestamp cap ────────────────────────────────────

#[test]
fn test_create_pool_max_duration_still_allowed() {
    let t = setup();
    let pool_id = make_pool(&t, MAX_POOL_DURATION_SECS);
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().expiry,
        1_000 + MAX_POOL_DURATION_SECS
    );
}

#[test]
fn test_scheduled_pool_end_timestamp_capped_from_creation() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let open_at = now + 10 * 24 * 3600;

    // open_at + MAX duration would end beyond now + MAX_POOL_DURATION_SECS.
    let result = t.client.try_schedule_pool(
        &t.creator,
        &String::from_str(&t.env, "Scheduled"),
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &MAX_POOL_DURATION_SECS,
        &MIN_CREATOR_DEPOSIT,
        &open_at,
    );
    assert_eq!(result, Err(Ok(ContractError::DurationTooLong)));

    // Ending exactly at the cap is accepted.
    let pool_id = t.client.schedule_pool(
        &t.creator,
        &String::from_str(&t.env, "Scheduled"),
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &(now + MAX_POOL_DURATION_SECS - open_at),
        &MIN_CREATOR_DEPOSIT,
        &open_at,
    );
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().expiry,
        now + MAX_POOL_DURATION_SECS
    );
}

// ─── #1620 — pause checks in admin flows ─────────────────────────────────

#[test]
fn test_assign_settler_blocked_while_paused() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    let settler = Address::generate(&t.env);

    t.client.pause_contract(&t.admin);
    assert_eq!(
        t.client.try_assign_settler(&t.creator, &pool_id, &settler),
        Err(Ok(ContractError::ContractPaused))
    );
    assert_eq!(t.client.get_delegated_settler(&pool_id), None);

    t.client.unpause_contract(&t.admin);
    t.client.assign_settler(&t.creator, &pool_id, &settler);
    assert_eq!(t.client.get_delegated_settler(&pool_id), Some(settler));
}

#[test]
fn test_override_pool_cooling_blocked_while_paused() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    t.client.pause_contract(&t.admin);
    assert_eq!(
        t.client.try_override_pool_cooling(&t.treasury, &pool_id),
        Err(Ok(ContractError::ContractPaused))
    );
}

#[test]
fn test_distribute_lp_rewards_blocked_while_paused() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    t.client.pause_contract(&t.admin);
    assert_eq!(
        t.client
            .try_distribute_lp_rewards(&t.treasury, &pool_id, &1_000),
        Err(Ok(ContractError::ContractPaused))
    );
}

#[test]
fn test_pool_mirror_admin_flows_blocked_while_paused() {
    let t = setup();
    let pool_id = make_pool(&t, 3_600);
    t.client
        .place_bet(&t.bettor, &pool_id, &0, &1_000, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp += 3_601);
    t.client.settle_pool(&t.creator, &pool_id, &0);
    let bridge = Address::generate(&t.env);

    t.client.pause_contract(&t.admin);
    assert_eq!(
        t.client.try_create_pool_mirror(
            &t.treasury,
            &pool_id,
            &ChainId::Stellar,
            &ChainId::Ethereum,
            &bridge
        ),
        Err(Ok(ContractError::ContractPaused))
    );

    t.client.unpause_contract(&t.admin);
    t.client.create_pool_mirror(
        &t.treasury,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Ethereum,
        &bridge,
    );

    t.client.pause_contract(&t.admin);
    assert_eq!(
        t.client.try_cancel_pool_mirror(&t.treasury, &pool_id),
        Err(Ok(ContractError::ContractPaused))
    );
    assert!(t.client.get_pool_mirror(&pool_id).is_some());

    t.client.unpause_contract(&t.admin);
    t.client.cancel_pool_mirror(&t.treasury, &pool_id);
    assert!(t.client.get_pool_mirror(&pool_id).is_none());
}

#[test]
fn test_key_rotation_still_allowed_while_paused() {
    // Documented recovery path: config and key rotation stay operational.
    let t = setup();
    t.client.pause_contract(&t.admin);
    let new_admin = Address::generate(&t.env);
    t.client.propose_admin(&t.admin, &new_admin);
    t.client.accept_admin(&new_admin);
    assert_eq!(t.client.get_admin(), Some(new_admin));
}
