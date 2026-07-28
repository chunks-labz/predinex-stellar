//! #718 — Tests for pool categories and discovery tags.

#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn setup() -> (Env, Address, PredinexContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury, &admin);
    (env, admin, client)
}

fn create_test_pool(env: &Env, client: &PredinexContractClient<'_>, creator: &Address) -> u32 {
    client.create_pool(
        creator,
        &String::from_str(env, "Will BTC hit 100k?"),
        &String::from_str(env, "Bitcoin price prediction"),
        &String::from_str(env, "Yes"),
        &String::from_str(env, "No"),
        &3600u64,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    )
}

// ── set_pool_category / get_pool_category ────────────────────────────────────

#[test]
fn test_set_and_get_pool_category() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    // Category is absent before being set.
    assert!(client.get_pool_category(&pool_id).is_none());

    client.set_pool_category(&creator, &pool_id, &PoolCategory::Crypto);

    assert_eq!(
        client.get_pool_category(&pool_id),
        Some(PoolCategory::Crypto)
    );
}

#[test]
fn test_set_pool_category_admin_allowed() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    client.set_pool_category(&admin, &pool_id, &PoolCategory::Finance);

    assert_eq!(
        client.get_pool_category(&pool_id),
        Some(PoolCategory::Finance)
    );
}

#[test]
fn test_set_pool_category_unauthorized() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);
    let stranger = Address::generate(&env);

    let result = client.try_set_pool_category(&stranger, &pool_id, &PoolCategory::Sports);
    assert!(result.is_err());
}

#[test]
fn test_set_pool_category_pool_not_found() {
    let (env, _admin, client) = setup();
    let caller = Address::generate(&env);

    let result = client.try_set_pool_category(&caller, &999u32, &PoolCategory::General);
    assert!(result.is_err());
}

#[test]
fn test_set_pool_category_overwrite() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    client.set_pool_category(&creator, &pool_id, &PoolCategory::Sports);
    client.set_pool_category(&creator, &pool_id, &PoolCategory::Politics);

    assert_eq!(
        client.get_pool_category(&pool_id),
        Some(PoolCategory::Politics)
    );
}

// ── set_pool_tags / get_pool_tags ─────────────────────────────────────────────

#[test]
fn test_set_and_get_pool_tags() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    // Tags are empty before being set.
    assert_eq!(client.get_pool_tags(&pool_id).len(), 0);

    let mut tags: Vec<String> = Vec::new(&env);
    tags.push_back(String::from_str(&env, "bitcoin"));
    tags.push_back(String::from_str(&env, "defi"));

    client.set_pool_tags(&creator, &pool_id, &tags);

    let stored = client.get_pool_tags(&pool_id);
    assert_eq!(stored.len(), 2);
    assert_eq!(stored.get(0).unwrap(), String::from_str(&env, "bitcoin"));
    assert_eq!(stored.get(1).unwrap(), String::from_str(&env, "defi"));
}

#[test]
fn test_set_pool_tags_admin_allowed() {
    let (env, admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    let mut tags: Vec<String> = Vec::new(&env);
    tags.push_back(String::from_str(&env, "admin-tag"));

    client.set_pool_tags(&admin, &pool_id, &tags);

    assert_eq!(client.get_pool_tags(&pool_id).len(), 1);
}

#[test]
fn test_set_pool_tags_unauthorized() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);
    let stranger = Address::generate(&env);

    let tags: Vec<String> = Vec::new(&env);
    let result = client.try_set_pool_tags(&stranger, &pool_id, &tags);
    assert!(result.is_err());
}

#[test]
fn test_set_pool_tags_too_many() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    let mut tags: Vec<String> = Vec::new(&env);
    // 11 tags — exceeds MAX_POOL_TAGS (10)
    for i in 0..11u32 {
        tags.push_back(String::from_str(&env, &std::format!("tag{}", i)));
    }

    let result = client.try_set_pool_tags(&creator, &pool_id, &tags);
    assert!(result.is_err());
}

#[test]
fn test_set_pool_tags_tag_too_long() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    let mut tags: Vec<String> = Vec::new(&env);
    // 33-character tag — exceeds MAX_TAG_LENGTH (32)
    tags.push_back(String::from_str(&env, "a-tag-that-is-way-too-long-for-me"));

    let result = client.try_set_pool_tags(&creator, &pool_id, &tags);
    assert!(result.is_err());
}

#[test]
fn test_set_pool_tags_clears_with_empty_vec() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);
    let pool_id = create_test_pool(&env, &client, &creator);

    let mut tags: Vec<String> = Vec::new(&env);
    tags.push_back(String::from_str(&env, "crypto"));
    client.set_pool_tags(&creator, &pool_id, &tags);
    assert_eq!(client.get_pool_tags(&pool_id).len(), 1);

    let empty: Vec<String> = Vec::new(&env);
    client.set_pool_tags(&creator, &pool_id, &empty);
    assert_eq!(client.get_pool_tags(&pool_id).len(), 0);
}

#[test]
fn test_set_pool_tags_pool_not_found() {
    let (env, _admin, client) = setup();
    let caller = Address::generate(&env);
    let tags: Vec<String> = Vec::new(&env);

    let result = client.try_set_pool_tags(&caller, &999u32, &tags);
    assert!(result.is_err());
}

// ── Independent category and tags per pool ───────────────────────────────────

#[test]
fn test_category_and_tags_independent_across_pools() {
    let (env, _admin, client) = setup();
    let creator = Address::generate(&env);

    let pool_a = create_test_pool(&env, &client, &creator);
    let pool_b = create_test_pool(&env, &client, &creator);

    client.set_pool_category(&creator, &pool_a, &PoolCategory::Crypto);
    client.set_pool_category(&creator, &pool_b, &PoolCategory::Sports);

    let mut tags_a: Vec<String> = Vec::new(&env);
    tags_a.push_back(String::from_str(&env, "btc"));
    let mut tags_b: Vec<String> = Vec::new(&env);
    tags_b.push_back(String::from_str(&env, "nba"));
    client.set_pool_tags(&creator, &pool_a, &tags_a);
    client.set_pool_tags(&creator, &pool_b, &tags_b);

    assert_eq!(
        client.get_pool_category(&pool_a),
        Some(PoolCategory::Crypto)
    );
    assert_eq!(
        client.get_pool_category(&pool_b),
        Some(PoolCategory::Sports)
    );
    assert_eq!(
        client.get_pool_tags(&pool_a).get(0).unwrap(),
        String::from_str(&env, "btc")
    );
    assert_eq!(
        client.get_pool_tags(&pool_b).get(0).unwrap(),
        String::from_str(&env, "nba")
    );
}
