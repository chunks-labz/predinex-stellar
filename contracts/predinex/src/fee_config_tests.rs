#![cfg(test)]
//! Tests for the contract-wide bet fee model (#591).
//!
//! These cover the `set_fee_config` / `get_fee_config` admin surface, the
//! `FeeConfigUpdated` event, and the fee deduction performed inside
//! `place_bet`. The separate per-pool protocol fee charged at claim time is
//! exercised in `protocol_fee_tests.rs`.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, vec, Address, Env, IntoVal, String, Symbol,
};

/// Register the contract + a Stellar Asset token. The token admin doubles as
/// the treasury recipient / admin, mirroring `protocol_fee_tests::setup_contract`.
fn setup() -> (
    Env,
    PredinexContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_sac = env.register_stellar_asset_contract_v2(token_admin.clone());

    client.initialize(&token_sac.address(), &token_admin, &token_admin);

    (env, client, contract_id, token_admin, token_sac.address())
}

fn make_pool(
    env: &Env,
    client: &PredinexContractClient<'static>,
    token: &Address,
    creator: &Address,
) -> u32 {
    token::StellarAssetClient::new(env, token).mint(creator, &MIN_CREATOR_DEPOSIT);
    client.create_pool(
        creator,
        &String::from_str(env, "Market"),
        &String::from_str(env, "Desc"),
        &String::from_str(env, "Yes"),
        &String::from_str(env, "No"),
        &3_600,
        &MIN_CREATOR_DEPOSIT,
    )
}

// ── set_fee_config / get_fee_config ─────────────────────────────────────────

/// After `initialize`, the bet fee rate defaults to 0 and the recipient
/// defaults to the treasury recipient.
#[test]
fn fee_config_defaults_to_zero_rate_and_treasury_recipient() {
    let (_env, client, _cid, admin, _token) = setup();
    let (rate, recipient) = client.get_fee_config();
    assert_eq!(rate, 0);
    assert_eq!(recipient, admin);
}

/// The treasury recipient can update both the rate and the recipient.
#[test]
fn set_fee_config_updates_rate_and_recipient() {
    let (env, client, _cid, admin, _token) = setup();
    let recipient = Address::generate(&env);

    client.set_fee_config(&admin, &200, &recipient);

    let (rate, got) = client.get_fee_config();
    assert_eq!(rate, 200);
    assert_eq!(got, recipient);
}

/// The maximum (100% = 10_000 bps) is accepted at the boundary.
#[test]
fn set_fee_config_accepts_max_boundary() {
    let (env, client, _cid, admin, _token) = setup();
    let recipient = Address::generate(&env);

    client.set_fee_config(&admin, &10_000, &recipient);

    assert_eq!(client.get_fee_config().0, 10_000);
}

/// A rate above 10_000 bps is rejected.
#[test]
#[should_panic]
fn set_fee_config_rejects_rate_above_max() {
    let (env, client, _cid, admin, _token) = setup();
    let recipient = Address::generate(&env);
    client.set_fee_config(&admin, &10_001, &recipient);
}

/// Only the treasury recipient may change the fee config.
#[test]
#[should_panic]
fn set_fee_config_rejects_non_admin_caller() {
    let (env, client, _cid, _admin, _token) = setup();
    let stranger = Address::generate(&env);
    let recipient = Address::generate(&env);
    client.set_fee_config(&stranger, &200, &recipient);
}

/// `set_fee_config` emits a single `FeeConfigUpdated` event carrying the new
/// rate and recipient.
#[test]
fn set_fee_config_emits_event() {
    let (env, client, cid, admin, _token) = setup();
    let recipient = Address::generate(&env);

    client.set_fee_config(&admin, &150, &recipient);

    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                cid,
                (
                    Symbol::new(&env, "FeeConfigUpdated"),
                    Symbol::new(&env, EVENT_SCHEMA_VERSION),
                )
                    .into_val(&env),
                (150u32, recipient).into_val(&env),
            ),
        ]
    );
}

// ── place_bet fee deduction ─────────────────────────────────────────────────

/// With a configured fee, `place_bet` pulls the full amount from the bettor,
/// forwards `amount * rate / 10_000` to the recipient, and keeps the net in
/// the contract.
#[test]
fn place_bet_deducts_fee_and_forwards_to_recipient() {
    let (env, client, cid, admin, token) = setup();
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    let fee_recipient = Address::generate(&env);
    client.set_fee_config(&admin, &200, &fee_recipient); // 2%

    let creator = Address::generate(&env);
    let pool_id = make_pool(&env, &client, &token, &creator);

    let user = Address::generate(&env);
    let bet: i128 = 5_000_000;
    token_admin.mint(&user, &bet);

    let recipient_before = token_client.balance(&fee_recipient);
    let contract_before = token_client.balance(&cid);

    client.place_bet(&user, &pool_id, &0, &bet, &None::<Address>);

    let expected_fee = bet * 200 / 10_000; // 100_000
    assert_eq!(
        token_client.balance(&fee_recipient) - recipient_before,
        expected_fee,
        "recipient should receive the fee"
    );
    assert_eq!(
        token_client.balance(&user),
        0,
        "bettor pays the full amount"
    );
    assert_eq!(
        token_client.balance(&cid) - contract_before,
        bet - expected_fee,
        "contract keeps the net stake"
    );
}

/// The deducted fee scales linearly with the bet size for a fixed rate, using
/// floor division (matching the contract's integer arithmetic).
#[test]
fn place_bet_fee_scales_with_bet_size() {
    let (env, client, _cid, admin, token) = setup();
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    let fee_recipient = Address::generate(&env);
    client.set_fee_config(&admin, &250, &fee_recipient); // 2.5%

    let creator = Address::generate(&env);
    let pool_id = make_pool(&env, &client, &token, &creator);

    // (bet, expected_fee = floor(bet * 250 / 10_000))
    let cases: [(i128, i128); 3] = [
        (1_000_000, 25_000),
        (2_000_000, 50_000),
        (4_000_001, 100_000), // floor: 100_000.025 -> 100_000
    ];

    for (bet, expected_fee) in cases {
        let user = Address::generate(&env);
        token_admin.mint(&user, &bet);

        let before = token_client.balance(&fee_recipient);
        client.place_bet(&user, &pool_id, &0, &bet, &None::<Address>);
        assert_eq!(
            token_client.balance(&fee_recipient) - before,
            expected_fee,
            "fee for bet of {} should be {}",
            bet,
            expected_fee
        );
    }
}

/// With the default zero rate, no fee is taken: the recipient balance is
/// untouched and the full stake stays in the contract.
#[test]
fn place_bet_with_zero_fee_takes_nothing() {
    let (env, client, cid, _admin, token) = setup();
    let token_admin = token::StellarAssetClient::new(&env, &token);
    let token_client = token::Client::new(&env, &token);

    // No set_fee_config call -> rate stays at the initialized default of 0.
    let (rate, recipient) = client.get_fee_config();
    assert_eq!(rate, 0);

    let creator = Address::generate(&env);
    let pool_id = make_pool(&env, &client, &token, &creator);

    let user = Address::generate(&env);
    let bet: i128 = 3_000_000;
    token_admin.mint(&user, &bet);

    let recipient_before = token_client.balance(&recipient);
    let contract_before = token_client.balance(&cid);

    client.place_bet(&user, &pool_id, &0, &bet, &None::<Address>);

    assert_eq!(
        token_client.balance(&recipient),
        recipient_before,
        "no fee should be forwarded when rate is 0"
    );
    assert_eq!(
        token_client.balance(&cid) - contract_before,
        bet,
        "contract keeps the full stake when there is no fee"
    );
}
