#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, String, Symbol, Val,
};

fn setup() -> (Env, PredinexContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_id.address(), &admin, &admin);
    token::StellarAssetClient::new(&env, &token_id.address())
        .mint(&admin, &(MIN_CREATOR_DEPOSIT * 100));
    (env, client, admin, token_id.address())
}

fn xdr_topic_val(env: &Env, event: &soroban_sdk::xdr::ContractEvent, i: usize) -> Val {
    match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => <Val as soroban_sdk::TryFromVal<
            Env,
            soroban_sdk::xdr::ScVal,
        >>::try_from_val(env, &v0.topics[i])
        .unwrap(),
    }
}

fn lifecycle_payload(env: &Env, event: &soroban_sdk::xdr::ContractEvent) -> MarketLifecycleEvent {
    let data_val: Val = match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => <Val as soroban_sdk::TryFromVal<
            Env,
            soroban_sdk::xdr::ScVal,
        >>::try_from_val(env, &v0.data)
        .unwrap(),
    };
    soroban_sdk::TryFromVal::try_from_val(env, &data_val).unwrap()
}

fn create_test_pool(
    env: &Env,
    client: &PredinexContractClient<'static>,
    token_address: &Address,
    creator: &Address,
) -> u32 {
    token::StellarAssetClient::new(env, token_address)
        .mint(creator, &(MIN_CREATOR_DEPOSIT * 10));
    client.create_pool(
        creator,
        &String::from_str(env, "Lifecycle test market"),
        &String::from_str(env, "Structured event regression"),
        &String::from_str(env, "Yes"),
        &String::from_str(env, "No"),
        &3_600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

#[test]
fn market_creation_and_settlement_emit_structured_lifecycle_events() {
    let (env, client, _admin, token_address) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &token_address, &creator);

    let events = env.events().all();
    let creation = events.events().last().expect("market creation event");
    let event_name: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, creation, 0)).unwrap();
    let version: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, creation, 1)).unwrap();
    let event_pool_id: u32 =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, creation, 2)).unwrap();
    let action: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, creation, 3)).unwrap();
    assert_eq!(event_name, Symbol::new(&env, "market_lifecycle"));
    assert_eq!(version, Symbol::new(&env, EVENT_SCHEMA_VERSION));
    assert_eq!(event_pool_id, pool_id);
    assert_eq!(action, Symbol::new(&env, "created"));
    let creation_payload = lifecycle_payload(&env, creation);
    assert_eq!(creation_payload.action, action);
    assert_eq!(creation_payload.previous_status, None);
    assert_eq!(creation_payload.current_status, PoolStatus::Open);
    assert_eq!(creation_payload.actor, Some(creator.clone()));

    let bettor_a = Address::generate(&env);
    let bettor_b = Address::generate(&env);
    let token_admin = token::StellarAssetClient::new(&env, &token_address);
    token_admin.mint(&bettor_a, &1_000);
    token_admin.mint(&bettor_b, &1_000);
    client.place_bet(&bettor_a, &pool_id, &0, &500, &None::<Address>);
    client.place_bet(&bettor_b, &pool_id, &1, &500, &None::<Address>);
    env.ledger().with_mut(|ledger| ledger.timestamp = 3_601);
    client.settle_pool(&creator, &pool_id, &0);

    let events = env.events().all();
    let settlement = events.events().last().expect("settlement lifecycle event");
    let settlement_name: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, settlement, 0)).unwrap();
    let settlement_action: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, settlement, 3)).unwrap();
    assert_eq!(settlement_name, Symbol::new(&env, "market_lifecycle"));
    assert_eq!(settlement_action, Symbol::new(&env, "settled"));
    let settlement_payload = lifecycle_payload(&env, settlement);
    assert_eq!(settlement_payload.previous_status, Some(PoolStatus::Open));
    assert_eq!(settlement_payload.current_status, PoolStatus::Settled(0));
    assert_eq!(settlement_payload.actor, Some(creator));
}

#[test]
fn multi_asset_pool_rejects_unbounded_token_lists() {
    let (env, client, admin, _token_address) = setup();
    let mut allowed_tokens = soroban_sdk::Vec::new(&env);
    for _ in 0..=MAX_ALLOWED_TOKENS {
        allowed_tokens.push_back(Address::generate(&env));
    }
    let outcomes = soroban_sdk::vec![
        &env,
        String::from_str(&env, "Yes"),
        String::from_str(&env, "No")
    ];
    let result = client.try_create_multi_asset_pool(
        &admin,
        &String::from_str(&env, "Multi asset"),
        &String::from_str(&env, "Bounded assets"),
        &outcomes,
        &3_600,
        &allowed_tokens,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );
    assert_eq!(result, Err(Ok(ContractError::TooManyAllowedTokens)));
}

#[test]
fn webhook_event_filters_are_bounded_and_unique() {
    let (env, client, admin, _token_address) = setup();
    let url = String::from_str(&env, "https://example.com/webhook");

    let mut oversized = soroban_sdk::Vec::new(&env);
    for _ in 0..=MAX_WEBHOOK_EVENT_TYPES {
        oversized.push_back(WebhookEventType::PoolCreated);
    }
    let too_many = client.try_register_webhook(&admin, &url, &oversized);
    assert_eq!(too_many, Err(Ok(ContractError::TooManyWebhookEventTypes)));

    let duplicated = soroban_sdk::vec![
        &env,
        WebhookEventType::PoolCreated,
        WebhookEventType::PoolCreated
    ];
    let duplicate = client.try_register_webhook(&admin, &url, &duplicated);
    assert_eq!(duplicate, Err(Ok(ContractError::DuplicateWebhookEventType)));
}

#[test]
fn batch_settlement_and_claim_calls_are_truncated_to_the_shared_cap() {
    let (env, client, admin, _token_address) = setup();
    let mut settlement_requests = soroban_sdk::Vec::new(&env);
    let mut pool_ids = soroban_sdk::Vec::new(&env);
    for id in 0..(MAX_BATCH_OPERATIONS + 1) {
        settlement_requests.push_back(PoolSettleRequest {
            pool_id: 50_000 + id,
            winning_outcome: 0,
        });
        pool_ids.push_back(50_000 + id);
    }

    let settlement = client.settle_pools(&admin, &settlement_requests);
    assert_eq!(settlement.results.len(), MAX_BATCH_OPERATIONS);
    assert!(settlement.truncated);

    let claims = client.claim_all_winnings(&admin, &pool_ids);
    assert_eq!(claims.results.len(), MAX_BATCH_OPERATIONS);
    assert!(claims.truncated);
}

#[test]
fn shared_predinex_error_codes_remain_stable() {
    assert_eq!(ContractError::Unauthorized as u32, 3);
    assert_eq!(ContractError::PoolExpired as u32, 7);
    assert_eq!(ContractError::PoolNotFound as u32, 9);
    assert_eq!(ContractError::PoolNotOpen as u32, 10);
    assert_eq!(ContractError::DurationTooLong as u32, 37);
    assert_eq!(ContractError::ExpiryMustIncrease as u32, 96);
    assert_eq!(ContractError::ExpiryMustBeFuture as u32, 97);
    assert_eq!(ContractError::PoolLocked as u32, 98);
    assert_eq!(ContractError::TooManyAllowedTokens as u32, 99);
    assert_eq!(ContractError::TooManyWebhookEventTypes as u32, 100);
    assert_eq!(ContractError::DuplicateWebhookEventType as u32, 101);
}
