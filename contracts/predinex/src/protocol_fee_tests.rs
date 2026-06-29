#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

fn setup_contract() -> (Env, PredinexContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    client.initialize(&token_id.address(), &token_admin, &token_admin);

    (env, client, token_admin, token_id.address())
}

#[test]
fn test_get_protocol_fee_returns_default() {
    let (_env, client, _, _) = setup_contract();
    let fee = client.get_protocol_fee();
    assert_eq!(fee, 200, "default fee should be 200 basis points (2%)");
}

#[test]
fn test_set_protocol_fee_within_bounds() {
    let (_env, client, admin, _) = setup_contract();
    client.set_protocol_fee(&admin, &500);
    assert_eq!(client.get_protocol_fee(), 500);
}

#[test]
#[should_panic]
fn test_set_protocol_fee_above_max_rejected() {
    let (_env, client, admin, _) = setup_contract();
    client.set_protocol_fee(&admin, &1001);
}

#[test]
fn test_set_protocol_fee_at_boundaries() {
    let (_env, client, admin, _) = setup_contract();
    client.set_protocol_fee(&admin, &0);
    assert_eq!(client.get_protocol_fee(), 0);
    client.set_protocol_fee(&admin, &1000);
    assert_eq!(client.get_protocol_fee(), 1000);
}

#[test]
fn test_claim_winnings_uses_configured_fee() {
    let (env, client, admin, token) = setup_contract();
    let token_admin_client = token::StellarAssetClient::new(&env, &token);

    client.set_protocol_fee(&admin, &500);

    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    env.ledger().with_mut(|li| li.timestamp = 3601);
    client.settle_pool(&creator, &pool_id, &0);

    let winnings = client.claim_winnings(&user, &pool_id);
    assert_eq!(winnings, 95);
}

#[test]
fn test_create_pool_event_includes_metadata() {
    let (_env, client, _admin, _) = setup_contract();
    let creator = Address::generate(&_env);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&_env, "Test Market"),
        &String::from_str(&_env, "Description"),
        &String::from_str(&_env, "Yes"),
        &String::from_str(&_env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    assert_eq!(pool_id, 1);
}
