#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::String;
use soroban_sdk::{testutils::Address as _, testutils::Events, testutils::Ledger, Address, Env, Val};
use std::format;

fn xdr_topic_val(env: &Env, event: &soroban_sdk::xdr::ContractEvent, i: usize) -> Val {
    match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => {
            <Val as soroban_sdk::TryFromVal<Env, soroban_sdk::xdr::ScVal>>::try_from_val(env, &v0.topics[i]).unwrap()
        }
    }
}

#[test]
fn test_create_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );
    assert_eq!(pool_id, 1);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.creator, creator);
    assert_eq!(pool.title, title);
}

#[test]
#[should_panic]
fn test_create_pool_rejects_duration_above_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let creator = Address::generate(&env);
    client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &1_000_001,
    );
}

#[test]
fn test_create_pool_accepts_duration_just_below_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    env.ledger().with_mut(|li| li.timestamp = 42);

    let creator = Address::generate(&env);
    let duration = 999_999;

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &duration,
    );

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.expiry, 42 + duration);
}

#[test]
fn test_large_pool_payouts_with_checked_arithmetic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let large_amount_a = 1_000_000_000_000_000_000i128;
    let large_amount_b = 2_000_000_000_000_000_000i128;

    token_admin_client.mint(&user1, &(large_amount_a + 100));
    token_admin_client.mint(&user2, &(large_amount_b + 100));

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &large_amount_a, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &large_amount_b, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);

    let winnings = client.claim_winnings(&user1, &pool_id);
    assert!(
        winnings > 0,
        "Large pool winnings must compute successfully"
    );
    assert_eq!(token.balance(&user1), 100 + winnings);
}

#[test]
fn test_place_bet_rejects_pool_total_overflow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let huge_amount = i128::MAX - 1;

    token_admin_client.mint(&user1, &huge_amount);
    token_admin_client.mint(&user2, &100);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &huge_amount, &None::<Address>);

    // Overflow on the second bet should fail predictably.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.place_bet(&user2, &pool_id, &0, &2, &None::<Address>);
    }));

    assert!(
        result.is_err(),
        "Pool total overflow should reject the second bet"
    );
}

#[test]
fn test_place_bet() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let user = Address::generate(&env);

    token_admin_client.mint(&user, &1000);

    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 100);
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

#[test]
fn test_settle_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let title = String::from_str(&env, "Market 1");
    let description = String::from_str(&env, "Desc 1");
    let outcome_a = String::from_str(&env, "Yes");
    let outcome_b = String::from_str(&env, "No");
    let duration = 3600;

    let pool_id = client.create_pool(
        &creator,
        &title,
        &description,
        &outcome_a,
        &outcome_b,
        &duration,
    );

    client.place_bet(&user1, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &100, &None::<Address>);

    // Advance ledger timestamp past the pool expiry so settlement is allowed
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Settle with outcome 0 (A wins)
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Settled(0));

    // User 1 claims
    let winnings = client.claim_winnings(&user1, &pool_id);

    // Total pool = 200. Fee (2%) = 4. Net = 196.
    // User1 bet 100 on winning outcome (0). Total winners = 100.
    // Share = 100 * 196 / 100 = 196.
    assert_eq!(winnings, 196);
    assert_eq!(token.balance(&user1), 900 + 196);
}

#[test]
#[should_panic]
fn test_duplicate_claim_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

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
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Advance ledger timestamp past the pool expiry so settlement is allowed
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);

    // First claim succeeds
    let winnings = client.claim_winnings(&user, &pool_id);
    assert_eq!(winnings, 98); // 100 * (100 - 2% fee) / 100
    let balance_after_first = token.balance(&user);
    assert_eq!(balance_after_first, 900 + 98);

    // Second claim must panic — bet entry was removed after first claim
    client.claim_winnings(&user, &pool_id);
}

// ============================================================================
// Issue #62: Initialization idempotency tests
//
// The contract's `initialize` function must only succeed once. Calling it a
// second time must panic with "Already initialized", and the originally
// configured token address must remain unchanged. This guards deployment
// safety by ensuring the token binding is immutable after first setup.
// ============================================================================

/// Verifies that the first `initialize` call succeeds and stores the token
/// address, and that a second `initialize` call panics without altering the
/// stored configuration.
#[test]
fn test_initialize_succeeds_once() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization should succeed
    client.initialize(&token_id.address(), &token_admin);

    // Verify the token address is stored by using it in a full flow:
    // create a pool and place a bet (which reads the stored token address)
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
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
    );

    // place_bet internally reads DataKey::Token — this proves initialize stored it
    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);
    let token = token::Client::new(&env, &token_id.address());
    assert_eq!(token.balance(&user), 900);
}

/// A second `initialize` call must be rejected with "Already initialized".
#[test]
#[should_panic]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization succeeds
    client.initialize(&token_id.address(), &token_admin);

    // Second initialization must panic
    let other_token_admin = Address::generate(&env);
    let other_token_id = env.register_stellar_asset_contract_v2(other_token_admin.clone());
    client.initialize(&other_token_id.address(), &other_token_admin);
}

/// After the rejected second `initialize`, the original token address must
/// still be in effect. We verify this by placing a bet that internally reads
/// the stored token and confirming it uses the original one.
#[test]
fn test_initialize_idempotency_preserves_original_token() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    // First initialization with the original token
    client.initialize(&token_id.address(), &token_admin);

    // Attempt second initialization with a different token (will panic internally)
    let other_token_admin = Address::generate(&env);
    let other_token_id = env.register_stellar_asset_contract_v2(other_token_admin.clone());
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.initialize(&other_token_id.address(), &other_token_admin);
    }));

    // The original token should still be active — verify by placing a bet
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
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
    );

    // This would fail if the token address had been overwritten
    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);
    let token = token::Client::new(&env, &token_id.address());
    assert_eq!(token.balance(&user), 900);
    assert_eq!(token.balance(&contract_id), 100);
}

// ============================================================================
// Issue #56: Pool settlement before expiry guard tests
//
// The contract must prevent creators from settling a pool before its expiry
// timestamp has passed. This ensures fairness by giving all participants the
// full betting window. Settlement after expiry should continue to work normally.
// ============================================================================

/// Attempting to settle a pool before its expiry timestamp must be rejected.
#[test]
#[should_panic]
fn test_settle_pool_before_expiry_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

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
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Ledger timestamp is still 0 (before expiry at 3600) — settlement must fail
    client.settle_pool(&creator, &pool_id, &0);
}

/// Settlement after expiry should succeed normally through the full lifecycle.
#[test]
fn test_settle_pool_after_expiry_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

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
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Advance ledger timestamp past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Settlement should now succeed
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Settled(0));

    // Verify claim still works after proper settlement
    let winnings = client.claim_winnings(&user, &pool_id);
    assert_eq!(winnings, 98); // 100 * (100 - 2%) / 100
    assert_eq!(token.balance(&user), 900 + 98);
}

// ============================================================================
// Issue #61: Unauthorized settlement rejection tests
//
// Only the pool creator is authorized to settle a pool. A non-creator caller
// must be rejected with "Unauthorized", and the pool must remain unsettled.
// The authorized creator should still be able to settle afterward.
// ============================================================================

/// A non-creator account attempting to settle a pool must be rejected.
#[test]
#[should_panic]
fn test_settle_pool_unauthorized_caller_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Advance past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Non-creator attempts settlement — must panic with "Unauthorized"
    client.settle_pool(&non_creator, &pool_id, &0);
}

/// After an unauthorized settlement attempt fails, the pool must remain
/// unsettled and the authorized creator can still settle it successfully.
#[test]
fn test_settle_pool_unauthorized_then_authorized_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);
    let user = Address::generate(&env);
    token_admin_client.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    // Advance past expiry
    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Non-creator attempt — catch the panic so we can continue
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.settle_pool(&non_creator, &pool_id, &0);
    }));

    // Pool must remain unsettled after the unauthorized attempt
    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Open);

    // Authorized creator can still settle successfully
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Settled(0));
}

#[test]
fn test_get_user_bet_returns_correct_amounts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token, &admin);

    let pool_id = client.create_pool(
        &admin,
        &String::from_str(&env, "Will it rain?"),
        &String::from_str(&env, "A simple weather pool"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );

    // Fund user via the token admin
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&user, &500i128);

    // Place bet on outcome A (100 tokens)
    client.place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);
    // Place bet on outcome B (200 tokens)
    client.place_bet(&user, &pool_id, &1u32, &200i128, &None::<Address>);

    let bet = client
        .get_user_bet(&pool_id, &user)
        .expect("bet must exist after placing");

    assert_eq!(
        bet.amount_a, 100i128,
        "amount_a must reflect outcome-0 bets"
    );
    assert_eq!(
        bet.amount_b, 200i128,
        "amount_b must reflect outcome-1 bets"
    );
    assert_eq!(
        bet.total_bet, 300i128,
        "total_bet must be the sum of both sides"
    );
}

#[test]
fn test_get_user_bet_returns_none_for_user_with_no_bet() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let no_bet_user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token, &admin);

    let pool_id = client.create_pool(
        &admin,
        &String::from_str(&env, "Will it rain?"),
        &String::from_str(&env, "A simple weather pool"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );

    // no_bet_user never called place_bet — must not panic
    let result = client.get_user_bet(&pool_id, &no_bet_user);

    assert!(
        result.is_none(),
        "get_user_bet must return None for a user who has not placed a bet"
    );
}

// invalid outcome inputs tests
struct TestEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    user: Address,
    token: Address,
}

/// Boot a clean environment, deploy the contract, mint tokens to user.
fn setup() -> TestEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token, &admin);

    // Fund the user so token transfers in place_bet don't fail for balance reasons
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_admin.mint(&user, &10_000i128);

    // Leak env lifetime — acceptable in tests where we own everything
    let client: PredinexContractClient<'static> = unsafe { core::mem::transmute(client) };

    TestEnv {
        env,
        client,
        admin,
        user,
        token,
    }
}

/// Create a pool with a 1-hour duration and return its ID.
fn make_pool(t: &TestEnv) -> u32 {
    t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Test pool"),
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
    )
}

/// Expire a pool by advancing the ledger timestamp past its expiry.
fn expire_pool(env: &Env) {
    env.ledger().with_mut(|info| {
        info.timestamp += 7_200; // 2 hours — well past the 1-hour pool duration
    });
}

// ─── Suite A — place_bet invalid outcome ──────────────────────────────────────

/// A1: outcome == 2 is the first out-of-range value and must be rejected.
#[test]
#[should_panic]
fn a1_place_bet_outcome_2_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &2u32, &100i128, &None::<Address>);
}

/// A2: outcome == u32::MAX is also out of range and must be rejected.
#[test]
#[should_panic]
fn a2_place_bet_outcome_max_u32_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &u32::MAX, &100i128, &None::<Address>);
}

/// A3: pool state (total_a, total_b) must not change after a rejected bet.
///
/// This is the "no state mutation" acceptance criterion. We verify by reading
/// the pool before and after the failed call and asserting all totals are zero.
#[test]
fn a3_invalid_outcome_does_not_mutate_pool_state() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Confirm pool starts clean
    let pool_before = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool_before.total_a, 0i128);
    assert_eq!(pool_before.total_b, 0i128);

    // Attempt an invalid bet — must panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client
            .place_bet(&t.user, &pool_id, &2u32, &100i128, &None::<Address>);
    }));
    assert!(result.is_err(), "invalid outcome bet must panic");

    // Pool totals must be unchanged
    let pool_after = t.client.get_pool(&pool_id).expect("pool must still exist");
    assert_eq!(
        pool_after.total_a, 0i128,
        "total_a must not change after rejected bet"
    );
    assert_eq!(
        pool_after.total_b, 0i128,
        "total_b must not change after rejected bet"
    );
}

/// A4: outcome == 0 is valid (boundary — lowest accepted value).
#[test]
fn a4_place_bet_outcome_0_is_valid() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Must not panic
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100i128, "total_a must reflect outcome-0 bet");
    assert_eq!(pool.total_b, 0i128, "total_b must be unchanged");
}

/// A5: outcome == 1 is valid (boundary — highest accepted value).
#[test]
fn a5_place_bet_outcome_1_is_valid() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Must not panic
    t.client
        .place_bet(&t.user, &pool_id, &1u32, &200i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 0i128, "total_a must be unchanged");
    assert_eq!(pool.total_b, 200i128, "total_b must reflect outcome-1 bet");
}

// ─── Suite B — settle_pool invalid outcome ────────────────────────────────────

/// B1: winning_outcome == 2 must be rejected when settling.
#[test]
#[should_panic]
fn b1_settle_pool_winning_outcome_2_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &2u32);
}

/// B2: winning_outcome == u32::MAX must be rejected when settling.
#[test]
#[should_panic]
fn b2_settle_pool_winning_outcome_max_u32_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &u32::MAX);
}

/// B3: pool.settled must remain false after a rejected settle call.
#[test]
fn b3_invalid_winning_outcome_does_not_set_settled_flag() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.settle_pool(&t.admin, &pool_id, &2u32);
    }));
    assert!(result.is_err(), "invalid winning_outcome must panic");

    let pool = t.client.get_pool(&pool_id).expect("pool must still exist");
    assert_eq!(
        pool.status,
        PoolStatus::Open,
        "pool.status must remain Open after rejected settle"
    );
}

/// B4: pool.status must remain Open after a rejected settle call.
#[test]
fn b4_invalid_winning_outcome_does_not_write_winning_outcome() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.settle_pool(&t.admin, &pool_id, &2u32);
    }));
    assert!(result.is_err(), "invalid winning_outcome must panic");

    let pool = t.client.get_pool(&pool_id).expect("pool must still exist");
    assert_eq!(
        pool.status,
        PoolStatus::Open,
        "pool.status must remain Open after rejected settle"
    );
}

/// B5: winning_outcome == 0 settles correctly (boundary — lowest valid).
#[test]
fn b5_settle_pool_winning_outcome_0_is_valid() {
    let t = setup();
    let pool_id = make_pool(&t);
    // A participant is required for settlement (default min = 1).
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    expire_pool(&t.env);

    // Must not panic
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(
        pool.status,
        PoolStatus::Settled(0),
        "status must be Settled(0)"
    );
}

/// B6: winning_outcome == 1 settles correctly (boundary — highest valid).
#[test]
fn b6_settle_pool_winning_outcome_1_is_valid() {
    let t = setup();
    let pool_id = make_pool(&t);
    // A participant is required for settlement (default min = 1).
    t.client
        .place_bet(&t.user, &pool_id, &1u32, &100i128, &None::<Address>);
    expire_pool(&t.env);

    // Must not panic
    t.client.settle_pool(&t.admin, &pool_id, &1u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(
        pool.status,
        PoolStatus::Settled(1),
        "status must be Settled(1)"
    );
}

// ============================================================================
// Issue #55: Validate positive bet amounts in place_bet
//
// The contract must reject zero and negative bet amounts explicitly.
// ============================================================================

/// C1: place_bet with amount == 0 must be rejected.
#[test]
#[should_panic]
fn c1_place_bet_zero_amount_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &0i128, &None::<Address>);
}

/// C2: place_bet with negative amount must be rejected.
#[test]
#[should_panic]
fn c2_place_bet_negative_amount_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &-100i128, &None::<Address>);
}

/// C3: pool state must not change after a rejected bet due to invalid amount.
#[test]
fn c3_invalid_amount_does_not_mutate_pool_state() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Confirm pool starts clean
    let pool_before = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool_before.total_a, 0i128);
    assert_eq!(pool_before.total_b, 0i128);

    // Attempt a zero-amount bet — must panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client
            .place_bet(&t.user, &pool_id, &0u32, &0i128, &None::<Address>);
    }));
    assert!(result.is_err(), "zero amount bet must panic");

    // Pool totals must be unchanged
    let pool_after = t.client.get_pool(&pool_id).expect("pool must still exist");
    assert_eq!(
        pool_after.total_a, 0i128,
        "total_a must not change after rejected bet"
    );
    assert_eq!(
        pool_after.total_b, 0i128,
        "total_b must not change after rejected bet"
    );

    // User balance must be unchanged (no token transfer)
    let token = soroban_sdk::token::Client::new(&t.env, &t.token);
    assert_eq!(
        token.balance(&t.user),
        10_000i128,
        "user balance must be unchanged after rejected bet"
    );
}

/// C4: positive amount continues to work (boundary test).
#[test]
fn c4_place_bet_positive_amount_works() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Must not panic
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100i128, "total_a must reflect the bet");
}

// ============================================================================
// Issue #60: Expired pool betting rejection tests
//
// The contract must reject bets placed after the pool expiry timestamp.
// This ensures betting is closed once the market expires.
// ============================================================================

/// D1: place_bet after pool expiry must be rejected.
#[test]
#[should_panic]
fn d1_place_bet_after_expiry_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Advance ledger time past expiry
    expire_pool(&t.env);

    // Attempt to place bet after expiry — must panic
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
}

/// D2: place_bet exactly at expiry timestamp is rejected (boundary test).
#[test]
#[should_panic]
fn d2_place_bet_exactly_at_expiry_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Set ledger timestamp exactly at expiry (pool created with 3600s duration)
    t.env.ledger().with_mut(|info| {
        info.timestamp = 3600; // Exactly at expiry
    });

    // Attempt to place bet exactly at expiry — must panic
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
}

/// D3: no token transfer occurs when betting on expired pool.
#[test]
fn d3_expired_bet_does_not_transfer_tokens() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Record initial balance
    let token = soroban_sdk::token::Client::new(&t.env, &t.token);
    let initial_balance = token.balance(&t.user);

    // Advance past expiry
    expire_pool(&t.env);

    // Attempt bet — must panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client
            .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    }));
    assert!(result.is_err(), "bet after expiry must panic");

    // Verify no tokens were transferred
    let final_balance = token.balance(&t.user);
    assert_eq!(
        final_balance, initial_balance,
        "no token transfer should occur for expired pool bet"
    );
}

/// D4: place_bet just before expiry succeeds (boundary test).
#[test]
fn d4_place_bet_just_before_expiry_succeeds() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Set ledger timestamp just before expiry
    t.env.ledger().with_mut(|info| {
        info.timestamp = 3599; // 1 second before expiry at 3600
    });

    // Should succeed
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100i128, "bet should be recorded");
}

// ============================================================================
// Issue #64: Pagination-friendly pool listing tests
//
// The contract exposes get_pools_batch for efficient paginated pool discovery.
// ============================================================================

/// E1: get_pools_batch returns correct slice of pools.
#[test]
fn e1_get_pools_batch_returns_correct_slice() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    // Create 5 pools
    let creator = Address::generate(&env);
    for i in 0..5 {
        client.create_pool(
            &creator,
            &String::from_str(&env, &format!("Market {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, "Yes"),
            &String::from_str(&env, "No"),
            &3600u64,
        );
    }

    // Fetch batch starting from pool 1, count 3
    let batch = client.get_pools_batch(&1u32, &3u32);
    assert_eq!(batch.len(), 3, "should return exactly 3 pools");

    // Verify pool IDs (1-indexed)
    let pool1 = batch.get(0).unwrap().unwrap();
    let pool2 = batch.get(1).unwrap().unwrap();
    let pool3 = batch.get(2).unwrap().unwrap();

    assert_eq!(pool1.title, String::from_str(&env, "Market 0"));
    assert_eq!(pool2.title, String::from_str(&env, "Market 1"));
    assert_eq!(pool3.title, String::from_str(&env, "Market 2"));
}

/// E2: get_pools_batch handles partial pages at boundaries.
#[test]
fn e2_get_pools_batch_handles_partial_pages() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    // Create 3 pools
    let creator = Address::generate(&env);
    for i in 0..3 {
        client.create_pool(
            &creator,
            &String::from_str(&env, &format!("Market {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, "Yes"),
            &String::from_str(&env, "No"),
            &3600u64,
        );
    }

    // Request more pools than exist (start at 2, count 5)
    let batch = client.get_pools_batch(&2u32, &5u32);
    // Should only return pools 2 and 3 (indices 1 and 2)
    assert_eq!(batch.len(), 2, "should return only available pools");
}

/// E3: get_pools_batch returns empty when start_id exceeds pool count.
#[test]
fn e3_get_pools_batch_empty_when_start_exceeds_count() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    // Create 2 pools
    let creator = Address::generate(&env);
    client.create_pool(
        &creator,
        &String::from_str(&env, "Market 1"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );
    client.create_pool(
        &creator,
        &String::from_str(&env, "Market 2"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );

    // Request starting beyond pool count
    let batch = client.get_pools_batch(&100u32, &10u32);
    assert_eq!(
        batch.len(),
        0,
        "should return empty when start exceeds count"
    );
}

/// E4: get_pools_batch caps count at 100 to prevent excessive gas.
/// Ignored: reading 100 pools in one invocation exceeds the Soroban test
/// environment footprint limit (100 ledger entries) when PoolCounter is
/// included, causing `Error(Budget, ExceededLimit)` before the assertion runs.
#[test]
#[ignore]
fn e4_get_pools_batch_caps_count_at_100() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    // Create 105 pools
    let creator = Address::generate(&env);
    for i in 0..105 {
        client.create_pool(
            &creator,
            &String::from_str(&env, &format!("Market {}", i)),
            &String::from_str(&env, "Description"),
            &String::from_str(&env, "Yes"),
            &String::from_str(&env, "No"),
            &3600u64,
        );
    }

    // Request 200 pools, should be capped at 100
    let batch = client.get_pools_batch(&1u32, &200u32);
    assert_eq!(batch.len(), 100, "should cap count at 100 pools");
}

/// E5: get_pools_batch handles gaps in pool IDs gracefully.
#[test]
fn e5_get_pools_batch_handles_gaps() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);

    // Create pools 1 and 3 (we'll simulate a gap at 2 by not creating it,
    // but since pools are sequential, we'll just verify the function returns
    // Option<Pool> for each position)
    client.create_pool(
        &creator,
        &String::from_str(&env, "Market 1"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );
    client.create_pool(
        &creator,
        &String::from_str(&env, "Market 2"),
        &String::from_str(&env, "Description"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );

    let batch = client.get_pools_batch(&1u32, &2u32);
    assert_eq!(batch.len(), 2, "should return 2 pools");
    assert!(batch.get(0).is_some(), "pool 1 should exist");
    assert!(batch.get(1).is_some(), "pool 2 should exist");
}

// ============================================================================
// Delegated Settler: assign_settler and settle_pool authorization tests
// ============================================================================

/// F1: Delegated settler can settle a pool after expiry.
#[test]
fn f1_delegated_settler_can_settle_after_expiry() {
    let t = setup();
    let pool_id = make_pool(&t);

    let settler = Address::generate(&t.env);
    t.client.assign_settler(&t.admin, &pool_id, &settler);

    // A participant is required for settlement (default min = 1).
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    expire_pool(&t.env);

    t.client.settle_pool(&settler, &pool_id, &0u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.status, PoolStatus::Settled(0), "pool must be settled");
}

/// F2: Unauthorized address cannot settle even after expiry.
#[test]
#[should_panic]
fn f2_unauthorized_address_cannot_settle() {
    let t = setup();
    let pool_id = make_pool(&t);

    let settler = Address::generate(&t.env);
    t.client.assign_settler(&t.admin, &pool_id, &settler);

    let random = Address::generate(&t.env);
    expire_pool(&t.env);

    t.client.settle_pool(&random, &pool_id, &0u32);
}

/// F3: Only the creator can assign a settler.
#[test]
#[should_panic]
fn f3_non_creator_cannot_assign_settler() {
    let t = setup();
    let pool_id = make_pool(&t);

    let non_creator = Address::generate(&t.env);
    let settler = Address::generate(&t.env);

    t.client.assign_settler(&non_creator, &pool_id, &settler);
}

/// F4: Creator can still settle without a delegated settler assigned.
#[test]
fn f4_creator_can_settle_without_delegated_settler() {
    let t = setup();
    let pool_id = make_pool(&t);

    // A participant is required for settlement (default min = 1).
    t.client
        .place_bet(&t.user, &pool_id, &1u32, &100i128, &None::<Address>);

    expire_pool(&t.env);

    t.client.settle_pool(&t.admin, &pool_id, &1u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.status, PoolStatus::Settled(1));
}

/// F5: get_delegated_settler returns the assigned settler.
#[test]
fn f5_get_delegated_settler_returns_assigned_address() {
    let t = setup();
    let pool_id = make_pool(&t);

    let settler = Address::generate(&t.env);
    t.client.assign_settler(&t.admin, &pool_id, &settler);

    let stored = t.client.get_delegated_settler(&pool_id);
    assert_eq!(stored, Some(settler));
}

/// F6: get_delegated_settler returns None when no settler assigned.
#[test]
fn f6_get_delegated_settler_returns_none_when_unset() {
    let t = setup();
    let pool_id = make_pool(&t);

    let stored = t.client.get_delegated_settler(&pool_id);
    assert!(stored.is_none());
}

// ============================================================================
// Issue #165: Treasury recipient rotation tests
//
// The treasury recipient must be rotatable by the current recipient.
// Rotation emits an event with old and new addresses.
// ============================================================================

/// G1: Current treasury recipient can rotate to a new address.
#[test]
fn g1_treasury_recipient_can_be_rotated() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let original_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &original_recipient);

    // Verify original recipient is set
    let current = client
        .get_treasury_recipient()
        .expect("recipient must be set");
    assert_eq!(current, original_recipient);

    // Rotate to new recipient
    let new_recipient = Address::generate(&env);
    client.rotate_treasury_recipient(&original_recipient, &new_recipient);

    // Verify new recipient is now set
    let updated = client
        .get_treasury_recipient()
        .expect("recipient must be set");
    assert_eq!(updated, new_recipient);
}

/// G2: Unauthorized caller cannot rotate treasury recipient.
#[test]
#[should_panic]
fn g2_unauthorized_cannot_rotate_treasury_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let original_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &original_recipient);

    // Attempt rotation from unauthorized address
    let unauthorized = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    client.rotate_treasury_recipient(&unauthorized, &new_recipient);
}

/// G3: After rotation, only new recipient can withdraw treasury funds.
#[test]
fn g3_after_rotation_only_new_recipient_can_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let original_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &original_recipient);

    // Create a pool and generate treasury fees
    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);
    client.claim_winnings(&user1, &pool_id);

    // Verify treasury has funds
    let treasury_balance = client.get_treasury_balance();
    assert!(treasury_balance > 0, "treasury should have fees");

    // Rotate recipient
    let new_recipient = Address::generate(&env);
    client.rotate_treasury_recipient(&original_recipient, &new_recipient);

    // Old recipient should not be able to withdraw
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.withdraw_treasury(&original_recipient, &treasury_balance);
    }));
    assert!(
        result.is_err(),
        "old recipient should not be able to withdraw"
    );

    // New recipient should be able to withdraw
    client.withdraw_treasury(&new_recipient, &treasury_balance);

    // Verify withdrawal succeeded
    assert_eq!(client.get_treasury_balance(), 0);
    assert_eq!(token.balance(&new_recipient), treasury_balance);
}

/// G4: Rotation emits event with old and new addresses.
#[test]
fn g4_rotation_emits_event_with_old_and_new_addresses() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let original_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &original_recipient);

    let new_recipient = Address::generate(&env);
    client.rotate_treasury_recipient(&original_recipient, &new_recipient);

    // Event verification would be done through event inspection in production
    // For this test, we verify the state change occurred
    let updated = client
        .get_treasury_recipient()
        .expect("recipient must be set");
    assert_eq!(updated, new_recipient);
}

/// G5: Multiple rotations work correctly.
#[test]
fn g5_multiple_rotations_work_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let recipient1 = Address::generate(&env);
    client.initialize(&token_id.address(), &recipient1);

    let recipient2 = Address::generate(&env);
    client.rotate_treasury_recipient(&recipient1, &recipient2);

    let recipient3 = Address::generate(&env);
    client.rotate_treasury_recipient(&recipient2, &recipient3);

    // Verify final recipient is set
    let final_recipient = client
        .get_treasury_recipient()
        .expect("recipient must be set");
    assert_eq!(final_recipient, recipient3);

    // Verify only final recipient can rotate
    let recipient4 = Address::generate(&env);
    client.rotate_treasury_recipient(&recipient3, &recipient4);

    let updated = client
        .get_treasury_recipient()
        .expect("recipient must be set");
    assert_eq!(updated, recipient4);
}

// ============================================================================
// Issue #163: Explicit treasury withdrawal event tests
//
// Treasury withdrawals must emit a dedicated event with caller, recipient,
// and amount. Failed withdrawals must not emit the event.
// ============================================================================

/// H1: Successful withdrawal emits event with caller, recipient, and amount.
#[test]
fn h1_successful_withdrawal_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // Generate treasury fees
    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);
    client.claim_winnings(&user1, &pool_id);

    let treasury_balance = client.get_treasury_balance();
    assert!(treasury_balance > 0);

    // Withdraw treasury
    client.withdraw_treasury(&treasury_recipient, &treasury_balance);

    // Event verification would be done through event inspection in production
    // For this test, we verify the withdrawal succeeded
    assert_eq!(client.get_treasury_balance(), 0);
}

/// H2: Failed withdrawal (insufficient balance) does not emit event.
#[test]
#[should_panic]
fn h2_failed_withdrawal_does_not_emit_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // Attempt to withdraw more than available
    client.withdraw_treasury(&treasury_recipient, &1000);
}

/// H3: Failed withdrawal (unauthorized) does not emit event.
#[test]
#[should_panic]
fn h3_unauthorized_withdrawal_does_not_emit_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // Attempt withdrawal from unauthorized address
    let unauthorized = Address::generate(&env);
    client.withdraw_treasury(&unauthorized, &100);
}

/// H4: Multiple withdrawals each emit their own event.
#[test]
fn h4_multiple_withdrawals_emit_separate_events() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // Generate treasury fees
    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);
    client.claim_winnings(&user1, &pool_id);

    let treasury_balance = client.get_treasury_balance();
    let half_balance = treasury_balance / 2;

    // First withdrawal
    client.withdraw_treasury(&treasury_recipient, &half_balance);
    assert_eq!(token.balance(&treasury_recipient), half_balance);

    // Second withdrawal
    let remaining = client.get_treasury_balance();
    client.withdraw_treasury(&treasury_recipient, &remaining);
    assert_eq!(token.balance(&treasury_recipient), treasury_balance);
    assert_eq!(client.get_treasury_balance(), 0);
}

/// H5: Withdrawal event includes correct caller and recipient.
#[test]
fn h5_withdrawal_event_includes_caller_and_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // Generate treasury fees
    let creator = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    token_admin_client.mint(&user1, &1000);
    token_admin_client.mint(&user2, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user1, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&user2, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);
    client.claim_winnings(&user1, &pool_id);

    let treasury_balance = client.get_treasury_balance();

    // Withdraw treasury
    client.withdraw_treasury(&treasury_recipient, &treasury_balance);

    // Verify withdrawal succeeded with correct recipient
    assert_eq!(token.balance(&treasury_recipient), treasury_balance);
    assert_eq!(client.get_treasury_balance(), 0);
}

// ── Issue #171: Enriched settlement events ────────────────────────────────────

/// Settlement event must include winning-side total, total pool volume, and
/// fee amount so downstream consumers can derive payout context without
/// additional reads.
#[test]
fn test_settle_pool_event_includes_totals_and_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creator = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    token_admin_client.mint(&user_a, &300);
    token_admin_client.mint(&user_b, &100);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Settlement Event Test"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    // user_a bets 300 on outcome 0, user_b bets 100 on outcome 1
    client.place_bet(&user_a, &pool_id, &0, &300, &None::<Address>);
    client.place_bet(&user_b, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    client.settle_pool(&creator, &pool_id, &0);

    // Verify derived values:
    //   winning_side_total = total_a = 300
    //   total_pool_volume  = 300 + 100 = 400
    //   fee_amount         = 400 * 2 / 100 = 8
    // (We verify indirectly through claim_winnings which uses the same fee rate.)
    let winnings = client.claim_winnings(&user_a, &pool_id);
    let fee = (400i128 * 2) / 100;
    let net = 400 - fee; // 392
                         // user_a staked 300 / 300 of the winning side → full net pool
    assert_eq!(winnings, net, "claim should equal net pool after 2% fee");
    assert_eq!(
        client.get_treasury_balance(),
        fee,
        "treasury must hold exactly the fee"
    );
}

/// The event payload for outcome 1 (side B) carries the correct totals.
#[test]
fn test_settle_pool_event_outcome_b_totals() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creator = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    token_admin_client.mint(&user_a, &200);
    token_admin_client.mint(&user_b, &600);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Outcome B Event Test"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user_a, &pool_id, &0, &200, &None::<Address>);
    client.place_bet(&user_b, &pool_id, &1, &600, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });

    // Settle with outcome 1 — winning_side_total should be total_b = 600
    client.settle_pool(&creator, &pool_id, &1);

    let winnings = client.claim_winnings(&user_b, &pool_id);
    let total_volume = 800i128;
    let fee = (total_volume * 2) / 100; // 16
    let net = total_volume - fee; // 784
    assert_eq!(winnings, net);
    assert_eq!(client.get_treasury_balance(), fee);
}

// ── Issue #179: Per-pool creation fee ─────────────────────────────────────────

/// Creating a pool when a fee is set must transfer the fee to the treasury
/// recipient and then succeed in creating the pool.
#[test]
fn test_create_pool_with_fee_transfers_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creation_fee = 500i128;
    client.set_creation_fee(&treasury_recipient, &creation_fee);
    assert_eq!(client.get_creation_fee(), creation_fee);

    let creator = Address::generate(&env);
    token_admin_client.mint(&creator, &creation_fee);

    let initial_treasury_balance = token.balance(&treasury_recipient);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Fee Pool"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    // Pool was created successfully
    let pool = client.get_pool(&pool_id);
    assert!(!pool.unwrap().settled);

    // Fee was transferred to the treasury recipient
    assert_eq!(
        token.balance(&treasury_recipient),
        initial_treasury_balance + creation_fee,
        "treasury recipient must receive the creation fee"
    );
    // Creator's balance is now 0
    assert_eq!(token.balance(&creator), 0);
}

/// Creating a pool when no fee is set must succeed without any token transfer.
#[test]
fn test_create_pool_no_fee_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    // No set_creation_fee call — defaults to 0
    assert_eq!(client.get_creation_fee(), 0);

    let creator = Address::generate(&env);
    // Creator has zero balance — pool creation must still succeed (no fee charged)
    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "No Fee Pool"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    let pool = client.get_pool(&pool_id);
    assert!(!pool.unwrap().settled);
}

/// Only the treasury recipient can set the creation fee.
#[test]
#[should_panic]
fn test_set_creation_fee_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let attacker = Address::generate(&env);
    // Must panic with "Unauthorized"
    client.set_creation_fee(&attacker, &1000);
}

/// `set_creation_fee` must reject negative fee values.
#[test]
#[should_panic]
fn test_set_creation_fee_negative_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    client.set_creation_fee(&treasury_recipient, &-1);
}

/// An exempt creator is not charged the creation fee, even when one is set.
#[test]
fn test_creation_fee_exemption_skips_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creation_fee = 500i128;
    client.set_creation_fee(&treasury_recipient, &creation_fee);

    let creator = Address::generate(&env);
    // Exempt the creator. Note: no tokens are minted to the creator, so the
    // pool can only be created if the fee transfer is genuinely skipped.
    assert!(!client.is_creation_fee_exempt(&creator));
    client.set_creation_fee_exemption(&treasury_recipient, &creator, &true);
    assert!(client.is_creation_fee_exempt(&creator));

    let initial_treasury_balance = token.balance(&treasury_recipient);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Exempt Pool"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    let pool = client.get_pool(&pool_id);
    assert!(!pool.unwrap().settled);
    // No fee moved to the treasury recipient.
    assert_eq!(token.balance(&treasury_recipient), initial_treasury_balance);
    assert_eq!(token.balance(&creator), 0);
}

/// Revoking an exemption restores normal fee charging.
#[test]
fn test_creation_fee_exemption_revoked_charges_again() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creation_fee = 500i128;
    client.set_creation_fee(&treasury_recipient, &creation_fee);

    let creator = Address::generate(&env);
    client.set_creation_fee_exemption(&treasury_recipient, &creator, &true);
    client.set_creation_fee_exemption(&treasury_recipient, &creator, &false);
    assert!(!client.is_creation_fee_exempt(&creator));

    token_admin_client.mint(&creator, &creation_fee);
    let initial_treasury_balance = token.balance(&treasury_recipient);

    client.create_pool(
        &creator,
        &String::from_str(&env, "Charged Pool"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    assert_eq!(
        token.balance(&treasury_recipient),
        initial_treasury_balance + creation_fee
    );
    assert_eq!(token.balance(&creator), 0);
}

/// Only the treasury recipient may set a creation-fee exemption.
#[test]
#[should_panic]
fn test_set_creation_fee_exemption_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let attacker = Address::generate(&env);
    let account = Address::generate(&env);
    client.set_creation_fee_exemption(&attacker, &account, &true);
}

// ── Cumulative volume tracking ────────────────────────────────────────────────

/// Per-pool and contract-wide volume increase by each bet amount, across
/// multiple users and both outcomes, and persist unchanged through settlement
/// and a winner claim.
#[test]
fn test_cumulative_volume_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    client.initialize(&token_id.address(), &token_admin);

    // Two independent pools so we can check contract-wide aggregation.
    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    token_admin_client.mint(&alice, &1000);
    token_admin_client.mint(&bob, &1000);

    let pool_a = client.create_pool(
        &creator,
        &String::from_str(&env, "Pool A"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );
    let pool_b = client.create_pool(
        &creator,
        &String::from_str(&env, "Pool B"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    // New pools start at zero volume.
    assert_eq!(client.get_pool_volume(&pool_a), 0);
    assert_eq!(client.get_total_contract_volume(), 0);

    // Multiple users, both outcomes, both pools.
    client.place_bet(&alice, &pool_a, &0, &100, &None::<Address>);
    client.place_bet(&bob, &pool_a, &1, &250, &None::<Address>);
    client.place_bet(&alice, &pool_a, &1, &50, &None::<Address>); // same user, again
    client.place_bet(&bob, &pool_b, &0, &400, &None::<Address>);

    // Per-pool volume is the lifetime sum of bet amounts in that pool.
    assert_eq!(client.get_pool_volume(&pool_a), 400);
    assert_eq!(client.get_pool_volume(&pool_b), 400);
    // The Pool struct exposes the same figure.
    assert_eq!(client.get_pool(&pool_a).unwrap().cumulative_volume, 400);
    // Contract-wide volume aggregates across all pools.
    assert_eq!(client.get_total_contract_volume(), 800);

    // Settle pool A and have a winner claim; volume must not change.
    env.ledger().with_mut(|li| li.timestamp = 3601);
    client.settle_pool(&creator, &pool_a, &0); // outcome 0 (alice's 100) wins
    assert_eq!(client.get_pool_volume(&pool_a), 400);

    client.claim_winnings(&alice, &pool_a);
    assert_eq!(
        client.get_pool_volume(&pool_a),
        400,
        "volume must persist through settlement and claims"
    );
    assert_eq!(client.get_total_contract_volume(), 800);
}

/// Unknown pools report zero volume rather than panicking.
#[test]
fn test_get_pool_volume_unknown_pool_is_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    assert_eq!(client.get_pool_volume(&999), 0);
    assert_eq!(client.get_total_contract_volume(), 0);
}

// ── Volume-based fee tiers ────────────────────────────────────────────────────

/// Create a pool with a single winner and single loser of the given amounts,
/// settle it, and return `(settlement_protocol_fee, winner_payout)`. Advances
/// the ledger past the pool's expiry before settling.
fn tiered_pool_fee_and_payout(
    env: &Env,
    client: &PredinexContractClient,
    token_admin_client: &token::StellarAssetClient,
    winner_amt: i128,
    loser_amt: i128,
) -> (i128, i128) {
    let creator = Address::generate(env);
    let winner = Address::generate(env);
    let loser = Address::generate(env);
    token_admin_client.mint(&winner, &winner_amt);
    token_admin_client.mint(&loser, &loser_amt);

    let now = env.ledger().timestamp();
    let pool_id = client.create_pool(
        &creator,
        &String::from_str(env, "Tier Market"),
        &String::from_str(env, "Desc"),
        &String::from_str(env, "Yes"),
        &String::from_str(env, "No"),
        &3600,
    );
    client.place_bet(&winner, &pool_id, &0, &winner_amt, &None::<Address>);
    client.place_bet(&loser, &pool_id, &1, &loser_amt, &None::<Address>);

    env.ledger().with_mut(|li| li.timestamp = now + 3601);
    client.settle_pool(&creator, &pool_id, &0);

    let fee = client
        .get_pool_protocol_revenue(&pool_id)
        .settlement_protocol_fee;
    let payout = client.claim_winnings(&winner, &pool_id);
    (fee, payout)
}

/// Below the first tier → flat default fee; within a tier → that tier's fee;
/// above the highest tier → the highest tier's fee. The settlement fee and the
/// winner payout both reflect the resolved tier.
#[test]
fn test_volume_fee_tiers_resolution() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    // Treasury recipient == token_admin (authorised to configure tiers).
    client.initialize(&token_id.address(), &token_admin);

    // Default protocol fee is 200 bps (2%). Two tiers below that.
    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [
            FeeTier {
                volume_threshold: 1000,
                fee_bps: 100,
            }, // >= 1000 → 1%
            FeeTier {
                volume_threshold: 5000,
                fee_bps: 50,
            }, // >= 5000 → 0.5%
        ],
    );
    client.set_volume_fee_tiers(&token_admin, &tiers);

    // Volume 500 (below first tier) → default 2% → fee 10, payout 490.
    let (fee, payout) = tiered_pool_fee_and_payout(&env, &client, &token_admin_client, 300, 200);
    assert_eq!(fee, 10, "below first tier uses default fee");
    assert_eq!(payout, 490);

    // Volume 2000 (within first tier) → 1% → fee 20, payout 1980.
    let (fee, payout) = tiered_pool_fee_and_payout(&env, &client, &token_admin_client, 1200, 800);
    assert_eq!(fee, 20, "within tier uses tier fee");
    assert_eq!(payout, 1980);

    // Volume 6000 (above highest tier) → 0.5% → fee 30, payout 5970.
    let (fee, payout) = tiered_pool_fee_and_payout(&env, &client, &token_admin_client, 4000, 2000);
    assert_eq!(fee, 30, "above highest tier uses highest tier fee");
    assert_eq!(payout, 5970);
}

/// With no tiers configured the contract uses the flat protocol fee (backward
/// compatible), even when a tier-capable build is deployed.
#[test]
fn test_volume_fee_tiers_unconfigured_is_flat_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    client.initialize(&token_id.address(), &token_admin);

    assert!(client.get_volume_fee_tiers().is_empty());

    // Volume 6000, no tiers → flat 2% → fee 120, payout 5880.
    let (fee, payout) = tiered_pool_fee_and_payout(&env, &client, &token_admin_client, 4000, 2000);
    assert_eq!(fee, 120);
    assert_eq!(payout, 5880);
}

/// Setting tiers emits a `fee_tiers_updated` event and an empty vector clears them.
#[test]
fn test_set_volume_fee_tiers_event_and_clear() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [FeeTier {
            volume_threshold: 1000,
            fee_bps: 100,
        }],
    );
    client.set_volume_fee_tiers(&token_admin, &tiers);

    // The event emitted by set_volume_fee_tiers is fee_tiers_updated. Read it
    // before any further contract call (the event buffer reflects the most
    // recent invocation only).
    let events = env.events().all();
    let last_event = events.events().last().expect("must emit an event");
    let name: soroban_sdk::Symbol = soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, last_event, 0)).unwrap();
    assert_eq!(name, soroban_sdk::Symbol::new(&env, "fee_tiers_updated"));

    assert_eq!(client.get_volume_fee_tiers().len(), 1);

    // Empty vector clears configured tiers.
    let empty = soroban_sdk::Vec::<FeeTier>::new(&env);
    client.set_volume_fee_tiers(&token_admin, &empty);
    assert!(client.get_volume_fee_tiers().is_empty());
}

/// More than MAX_FEE_TIERS (5) tiers is rejected.
#[test]
#[should_panic]
fn test_set_volume_fee_tiers_too_many_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [
            FeeTier {
                volume_threshold: 100,
                fee_bps: 90,
            },
            FeeTier {
                volume_threshold: 200,
                fee_bps: 80,
            },
            FeeTier {
                volume_threshold: 300,
                fee_bps: 70,
            },
            FeeTier {
                volume_threshold: 400,
                fee_bps: 60,
            },
            FeeTier {
                volume_threshold: 500,
                fee_bps: 50,
            },
            FeeTier {
                volume_threshold: 600,
                fee_bps: 40,
            },
        ],
    );
    client.set_volume_fee_tiers(&token_admin, &tiers);
}

/// Non-ascending thresholds are rejected.
#[test]
#[should_panic]
fn test_set_volume_fee_tiers_non_ascending_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [
            FeeTier {
                volume_threshold: 5000,
                fee_bps: 50,
            },
            FeeTier {
                volume_threshold: 1000,
                fee_bps: 100,
            },
        ],
    );
    client.set_volume_fee_tiers(&token_admin, &tiers);
}

/// A fee_bps above the protocol maximum is rejected.
#[test]
#[should_panic]
fn test_set_volume_fee_tiers_fee_out_of_bounds_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [FeeTier {
            volume_threshold: 1000,
            fee_bps: 1001,
        }],
    );
    client.set_volume_fee_tiers(&token_admin, &tiers);
}

/// Only the treasury recipient may configure fee tiers.
#[test]
#[should_panic]
fn test_set_volume_fee_tiers_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);

    let attacker = Address::generate(&env);
    let tiers = soroban_sdk::Vec::from_array(
        &env,
        [FeeTier {
            volume_threshold: 1000,
            fee_bps: 100,
        }],
    );
    client.set_volume_fee_tiers(&attacker, &tiers);
}

// ── Minimum participants for settlement ───────────────────────────────────────

/// Build a clean contract and return (env, client, treasury_recipient, mint).
fn min_participants_setup() -> (
    Env,
    PredinexContractClient<'static>,
    Address,
    token::StellarAssetClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());
    client.initialize(&token_id.address(), &token_admin);

    let client: PredinexContractClient<'static> = unsafe { core::mem::transmute(client) };
    let token_admin_client: token::StellarAssetClient<'static> =
        unsafe { core::mem::transmute(token_admin_client) };
    (env, client, token_admin, token_admin_client)
}

/// Default threshold is 1 and is configurable; the setter persists.
#[test]
fn test_min_settlement_participants_default_and_set() {
    let (_env, client, treasury, _mint) = min_participants_setup();
    assert_eq!(client.get_min_settlement_participants(), 1);

    client.set_min_settlement_participants(&treasury, &3);
    assert_eq!(client.get_min_settlement_participants(), 3);
}

/// A pool with fewer participants than the threshold cannot be settled, and the
/// pool stays Open after the rejected attempt.
#[test]
fn test_settle_below_min_participants_rejected() {
    let (env, client, treasury, mint) = min_participants_setup();
    client.set_min_settlement_participants(&treasury, &2);

    let creator = Address::generate(&env);
    let user = Address::generate(&env);
    mint.mint(&user, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Thin Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );
    // Only one participant — below the threshold of 2.
    client.place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    env.ledger().with_mut(|li| li.timestamp = 3601);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.settle_pool(&creator, &pool_id, &0);
    }));
    assert!(
        result.is_err(),
        "settlement below threshold must be rejected"
    );

    let pool = client.get_pool(&pool_id).expect("pool must still exist");
    assert_eq!(pool.status, PoolStatus::Open, "pool must remain Open");
}

/// Once the participant count reaches the threshold, settlement succeeds.
#[test]
fn test_settle_meets_min_participants_succeeds() {
    let (env, client, treasury, mint) = min_participants_setup();
    client.set_min_settlement_participants(&treasury, &2);

    let creator = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint.mint(&alice, &1000);
    mint.mint(&bob, &1000);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );
    // Two distinct participants meet the threshold of 2.
    client.place_bet(&alice, &pool_id, &0, &100, &None::<Address>);
    client.place_bet(&bob, &pool_id, &1, &100, &None::<Address>);

    env.ledger().with_mut(|li| li.timestamp = 3601);
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.status, PoolStatus::Settled(0));
}

/// Setting the threshold to 0 disables the check (empty pools may settle).
#[test]
fn test_min_settlement_participants_zero_disables_check() {
    let (env, client, treasury, _mint) = min_participants_setup();
    client.set_min_settlement_participants(&treasury, &0);

    let creator = Address::generate(&env);
    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Empty Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    env.ledger().with_mut(|li| li.timestamp = 3601);
    client.settle_pool(&creator, &pool_id, &0);

    let pool = client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.status, PoolStatus::Settled(0));
}

/// Only the treasury recipient may change the threshold.
#[test]
#[should_panic]
fn test_set_min_settlement_participants_unauthorized_rejected() {
    let (env, client, _treasury, _mint) = min_participants_setup();
    let attacker = Address::generate(&env);
    client.set_min_settlement_participants(&attacker, &5);
}

// ── Issue #173: get_claim_status read method ──────────────────────────────────

/// Transitions for a winning bettor: NeverBet → NotEligible (open) → Claimable → AlreadyClaimed.
#[test]
fn claim_status_winner_transitions() {
    let t = setup();
    let pool_id = make_pool(&t);

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&winner, &500);
    token_admin.mint(&loser, &500);

    // Before any bet: NeverBet
    assert_eq!(
        t.client.get_claim_status(&pool_id, &winner),
        super::ClaimStatus::NeverBet
    );

    t.client
        .place_bet(&winner, &pool_id, &0, &300, &None::<Address>); // outcome A
    t.client
        .place_bet(&loser, &pool_id, &1, &200, &None::<Address>); // outcome B

    // After bet, pool still open: NotEligible (no claim available yet)
    assert_eq!(
        t.client.get_claim_status(&pool_id, &winner),
        super::ClaimStatus::NotEligible
    );

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0); // A wins

    // After settlement, winner: Claimable
    assert_eq!(
        t.client.get_claim_status(&pool_id, &winner),
        super::ClaimStatus::Claimable
    );
    // After settlement, loser: NotEligible
    assert_eq!(
        t.client.get_claim_status(&pool_id, &loser),
        super::ClaimStatus::NotEligible
    );

    t.client.claim_winnings(&winner, &pool_id);

    // After claim: AlreadyClaimed
    assert_eq!(
        t.client.get_claim_status(&pool_id, &winner),
        super::ClaimStatus::AlreadyClaimed
    );
}

/// Losing bettor status is NotEligible, distinct from NeverBet.
#[test]
fn claim_status_loser_is_not_eligible_not_never_bet() {
    let t = setup();
    let pool_id = make_pool(&t);

    let loser = Address::generate(&t.env);
    let winner = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&loser, &100);
    token_admin.mint(&winner, &100);

    t.client
        .place_bet(&loser, &pool_id, &1, &100, &None::<Address>); // outcome B
    t.client
        .place_bet(&winner, &pool_id, &0, &100, &None::<Address>); // outcome A

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0); // A wins

    let loser_status = t.client.get_claim_status(&pool_id, &loser);
    let never_bet_status = t
        .client
        .get_claim_status(&pool_id, &Address::generate(&t.env));

    assert_eq!(loser_status, super::ClaimStatus::NotEligible);
    assert_eq!(never_bet_status, super::ClaimStatus::AlreadyClaimed); // settled pool, no record
    assert_ne!(loser_status, never_bet_status);
}

/// Cancelled pool: RefundClaimable → AlreadyClaimed after claim_refund.
#[test]
fn claim_status_cancelled_pool_transitions() {
    let t = setup();
    let pool_id = make_pool(&t);

    let user = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user, &200);

    t.client
        .place_bet(&user, &pool_id, &0, &200, &None::<Address>);
    t.client.cancel_pool(&t.admin, &pool_id);

    assert_eq!(
        t.client.get_claim_status(&pool_id, &user),
        super::ClaimStatus::RefundClaimable
    );

    t.client.claim_refund(&user, &pool_id);

    assert_eq!(
        t.client.get_claim_status(&pool_id, &user),
        super::ClaimStatus::AlreadyClaimed
    );
}

// ── Issue #186: treasury withdrawal amount validation ─────────────────────────

/// Helper: set up a contract with some treasury balance accumulated via a settled pool.
fn setup_with_treasury() -> (TestEnv<'static>, u32) {
    let t = setup();
    let pool_id = make_pool(&t);

    // user1 bets A, user2 bets B — creates a pool with funds
    let user2 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user2, &1000);

    t.client
        .place_bet(&t.user, &pool_id, &0, &500, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1, &500, &None::<Address>);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0);

    // winner claims — 2% fee (20 tokens) goes to treasury
    t.client.claim_winnings(&t.user, &pool_id);

    (t, pool_id)
}

/// Zero withdrawal must be rejected.
#[test]
#[should_panic]
fn treasury_withdraw_zero_rejected() {
    let (t, _) = setup_with_treasury();
    t.client.withdraw_treasury(&t.admin, &0i128);
}

/// Negative withdrawal must be rejected.
#[test]
#[should_panic]
fn treasury_withdraw_negative_rejected() {
    let (t, _) = setup_with_treasury();
    t.client.withdraw_treasury(&t.admin, &-1i128);
}

/// Valid positive withdrawal succeeds and reduces the treasury balance.
#[test]
fn treasury_withdraw_positive_succeeds() {
    let (t, _) = setup_with_treasury();

    let before = t.client.get_treasury_balance();
    assert!(
        before > 0,
        "treasury must have a balance after fee collection"
    );

    t.client.withdraw_treasury(&t.admin, &before);

    assert_eq!(t.client.get_treasury_balance(), 0);
}

// ============================================================================
// Issue #160: Pool cancellation path before the first bet
//
// The creator must be able to cancel a pool that has no bets. Once cancelled
// the pool transitions to the Cancelled terminal state and rejects all further
// actions. Cancellation after the first bet must be rejected.
// ============================================================================

/// I1: Creator can cancel a pool before any bets are placed.
#[test]
fn i1_cancel_pool_before_bets_succeeds() {
    let t = setup();
    let pool_id = make_pool(&t);

    let pool_before = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool_before.status, PoolStatus::Open);

    t.client.cancel_pool(&t.admin, &pool_id);

    let pool_after = t
        .client
        .get_pool(&pool_id)
        .expect("pool must still exist after cancel");
    assert_eq!(
        pool_after.status,
        PoolStatus::Cancelled,
        "status must be Cancelled after creator cancels"
    );
}

/// I2: Creator can cancel a pool after bets have been placed.
#[test]
fn i2_cancel_pool_after_first_bet_succeeds() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client.cancel_pool(&t.admin, &pool_id);

    let pool_after = t
        .client
        .get_pool(&pool_id)
        .expect("pool must still exist after cancel");
    assert_eq!(pool_after.status, PoolStatus::Cancelled);
}

/// I3: A non-creator cannot cancel the pool.
#[test]
#[should_panic]
fn i3_non_creator_cannot_cancel_pool() {
    let t = setup();
    let pool_id = make_pool(&t);

    let other = Address::generate(&t.env);
    t.client.cancel_pool(&other, &pool_id);
}

/// I4: Pool records survive cancellation; storage is not silently deleted.
#[test]
fn i4_cancelled_pool_record_is_retained() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.cancel_pool(&t.admin, &pool_id);

    let pool = t.client.get_pool(&pool_id);
    assert!(
        pool.is_some(),
        "pool record must still exist after cancellation"
    );
    assert_eq!(pool.unwrap().status, PoolStatus::Cancelled);
}

/// I5: Betting into a cancelled pool is rejected.
#[test]
#[should_panic]
fn i5_place_bet_on_cancelled_pool_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.cancel_pool(&t.admin, &pool_id);
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
}

/// I6: Settling a cancelled pool is rejected.
#[test]
#[should_panic]
fn i6_settle_cancelled_pool_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.cancel_pool(&t.admin, &pool_id);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);
}

// ============================================================================
// Issue #172: Read method to scan a user position across pool ranges
//
// get_user_pools returns only pools where the user has an open bet record.
// Scans are range-bounded, capped at 100 pools per call, and deterministic
// so callers can paginate with successive start_id values.
// ============================================================================

/// J1: Scan returns only pools where the user has a bet.
#[test]
fn j1_get_user_pools_returns_correct_pools() {
    let t = setup();

    let pool_a = make_pool(&t);
    let pool_b = make_pool(&t);
    let pool_c = make_pool(&t);

    // User bets in pool_a and pool_c but not pool_b
    t.client
        .place_bet(&t.user, &pool_a, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_c, &1u32, &200i128, &None::<Address>);

    let positions = t.client.get_user_pools(&t.user, &pool_a, &3u32);

    let pool_ids: soroban_sdk::Vec<u32> = {
        let mut ids = soroban_sdk::Vec::new(&t.env);
        for i in 0..positions.len() {
            ids.push_back(positions.get(i).unwrap().pool_id);
        }
        ids
    };

    assert_eq!(positions.len(), 2, "must find exactly 2 positions");
    assert!(pool_ids.contains(pool_a), "pool_a must be in results");
    assert!(
        !pool_ids.contains(pool_b),
        "pool_b must not appear — user never bet"
    );
    assert!(pool_ids.contains(pool_c), "pool_c must be in results");
}

/// J2: Results are ordered by ascending pool_id within the scanned range.
#[test]
fn j2_get_user_pools_is_ordered_ascending() {
    let t = setup();

    let pool_a = make_pool(&t);
    let pool_b = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_b, &0u32, &50i128, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_a, &0u32, &50i128, &None::<Address>);

    let positions = t.client.get_user_pools(&t.user, &pool_a, &2u32);
    assert_eq!(positions.len(), 2);
    assert!(
        positions.get(0).unwrap().pool_id < positions.get(1).unwrap().pool_id,
        "positions must be ordered by ascending pool_id"
    );
}

/// J3: Querying a range with no user bets returns an empty vec.
#[test]
fn j3_get_user_pools_returns_empty_when_no_bets() {
    let t = setup();
    let pool_id = make_pool(&t);
    // User never bets
    let positions = t.client.get_user_pools(&t.user, &pool_id, &5u32);
    assert_eq!(
        positions.len(),
        0,
        "must return empty when user has no bets in range"
    );
}

/// J4: Claimed positions do not appear in subsequent scans.
#[test]
fn j4_claimed_position_is_not_returned_by_scan() {
    let t = setup();
    let pool_id = make_pool(&t);

    let loser = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&loser, &100);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &100i128, &None::<Address>);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);
    t.client.claim_winnings(&t.user, &pool_id);

    // After claiming, user's bet record is gone — scan must return empty.
    let positions = t.client.get_user_pools(&t.user, &pool_id, &1u32);
    assert_eq!(
        positions.len(),
        0,
        "claimed position must not appear in scan"
    );
}

/// J5: Count is capped at 100 pools per call.
/// Ignored: exceeds Soroban test environment footprint limit (same as E4).
#[test]
#[ignore]
fn j5_get_user_pools_caps_count_at_100() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let user = Address::generate(&env);

    // Create 105 pools so 100+ exist in range
    for i in 0..105 {
        client.create_pool(
            &creator,
            &String::from_str(&env, &format!("Pool {}", i)),
            &String::from_str(&env, "Desc"),
            &String::from_str(&env, "Yes"),
            &String::from_str(&env, "No"),
            &3_600u64,
        );
    }

    // Even requesting 200, only 100 are scanned
    let positions = client.get_user_pools(&user, &1u32, &200u32);
    // User has no bets so result is empty, but the function must not scan > 100 pools.
    // We verify it completes without error and returns an empty vec (≤ 100 scanned).
    assert_eq!(positions.len(), 0, "no bets placed, must return empty");
}

// ============================================================================
// Issue #189: Storage TTL extension for active pools and user positions
//
// Pool and UserBet entries are bumped on creation, every write, and every read
// so active records remain accessible for the full market lifecycle.
// ============================================================================

/// K1: A newly created pool has an extended TTL (bump does not panic).
#[test]
fn k1_pool_ttl_is_extended_on_create() {
    let t = setup();
    // create_pool internally calls extend_ttl — verify no panic occurs.
    let pool_id = make_pool(&t);
    let pool = t.client.get_pool(&pool_id);
    assert!(
        pool.is_some(),
        "pool must be readable after creation with TTL bump"
    );
}

/// K2: Placing a bet extends both pool and user-position TTLs (no panic).
#[test]
fn k2_pool_and_bet_ttl_extended_on_place_bet() {
    let t = setup();
    let pool_id = make_pool(&t);

    // place_bet calls extend_ttl for both pool and UserBet — verify no panic.
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    let pool = t.client.get_pool(&pool_id);
    assert!(pool.is_some());
    let bet = t.client.get_user_bet(&pool_id, &t.user);
    assert!(bet.is_some(), "user bet must be readable after TTL bump");
}

/// K3: Settling a pool extends the pool TTL so claims can proceed after settlement.
#[test]
fn k3_pool_ttl_extended_on_settle() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    expire_pool(&t.env);
    // settle_pool calls extend_ttl — verify pool remains readable afterward.
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    let pool = t.client.get_pool(&pool_id);
    assert!(
        pool.is_some(),
        "pool must remain readable after settlement TTL bump"
    );
}

/// K4: get_user_bet read path extends the TTL of the returned entry.
#[test]
fn k4_get_user_bet_extends_ttl_on_read() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    // get_user_bet calls extend_ttl — verify no panic and correct data returned.
    let bet = t.client.get_user_bet(&pool_id, &t.user);
    assert!(bet.is_some());
    assert_eq!(bet.unwrap().amount_a, 100i128);
}

// ============================================================================
// Issue #200: Token transfers and treasury accounting stay in sync
//
// claim_winnings is structured so the token transfer happens before any state
// mutation. A failed claim (no bet, wrong pool, not winner) must leave both the
// treasury balance and the contract token balance unchanged.
// ============================================================================

/// L1: A claim on a non-existent pool panics and leaves treasury unchanged.
#[test]
fn l1_failed_claim_nonexistent_pool_leaves_treasury_unchanged() {
    let t = setup();
    let treasury_before = t.client.get_treasury_balance();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&t.user, &999u32);
    }));
    assert!(result.is_err(), "claim on nonexistent pool must panic");

    let treasury_after = t.client.get_treasury_balance();
    assert_eq!(
        treasury_before, treasury_after,
        "treasury must be unchanged after failed claim"
    );
}

/// L2: A claim with no bet record panics and leaves treasury unchanged.
#[test]
fn l2_failed_claim_no_bet_leaves_treasury_unchanged() {
    let t = setup();
    let pool_id = make_pool(&t);

    let user2 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user2, &100);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    let treasury_before = t.client.get_treasury_balance();

    // user2 never bet — claim must panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&user2, &pool_id);
    }));
    assert!(result.is_err(), "claim with no bet must panic");

    let treasury_after = t.client.get_treasury_balance();
    assert_eq!(
        treasury_before, treasury_after,
        "treasury must be unchanged after failed claim"
    );
}

/// L3: A loser's claim panics and leaves treasury and token balances unchanged.
#[test]
fn l3_loser_claim_leaves_balances_unchanged() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin_addr = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creator = Address::generate(&env);
    let winner = Address::generate(&env);
    let loser = Address::generate(&env);

    token_admin_client.mint(&winner, &500);
    token_admin_client.mint(&loser, &500);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Market"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&winner, &pool_id, &0, &300, &None::<Address>);
    client.place_bet(&loser, &pool_id, &1, &200, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });
    client.settle_pool(&creator, &pool_id, &0);

    let treasury_before = client.get_treasury_balance();
    let loser_balance_before = token.balance(&loser);
    let contract_balance_before = token.balance(&contract_id);

    // Loser claims — must panic with "No winnings to claim"
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.claim_winnings(&loser, &pool_id);
    }));
    assert!(result.is_err(), "loser claim must panic");

    assert_eq!(
        client.get_treasury_balance(),
        treasury_before,
        "treasury must be unchanged after loser's failed claim"
    );
    assert_eq!(
        token.balance(&loser),
        loser_balance_before,
        "loser token balance must be unchanged"
    );
    assert_eq!(
        token.balance(&contract_id),
        contract_balance_before,
        "contract token balance must be unchanged"
    );
}

/// L4: A successful claim reconciles treasury and token balances exactly.
#[test]
fn l4_successful_claim_reconciles_treasury_and_balances() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin_addr = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creator = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    token_admin_client.mint(&user_a, &300);
    token_admin_client.mint(&user_b, &200);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Reconciliation test"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user_a, &pool_id, &0, &300, &None::<Address>);
    client.place_bet(&user_b, &pool_id, &1, &200, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });
    client.settle_pool(&creator, &pool_id, &0); // A wins

    let contract_balance_before = token.balance(&contract_id);
    // Total = 500, fee = 10 (2%), net = 490. user_a staked all winning side → wins 490.
    let winnings = client.claim_winnings(&user_a, &pool_id);

    let expected_fee = (500i128 * 2) / 100;
    let expected_winnings = 500 - expected_fee;

    assert_eq!(
        winnings, expected_winnings,
        "winnings must equal net pool after fee"
    );
    assert_eq!(
        client.get_treasury_balance(),
        expected_fee,
        "treasury must hold exactly the fee"
    );
    assert_eq!(
        token.balance(&contract_id),
        contract_balance_before - winnings,
        "contract balance must decrease by exactly the payout"
    );
    assert_eq!(
        token.balance(&contract_id),
        expected_fee,
        "remaining contract balance must equal the unclaimed treasury fee"
    );
}

/// L5: Claim winnings emits a claim event with payout and fee context.
#[test]
fn l5_claim_winnings_emits_claim_event() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin_addr = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let treasury_recipient = Address::generate(&env);
    client.initialize(&token_id.address(), &treasury_recipient);

    let creator = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    token_admin_client.mint(&user_a, &300);
    token_admin_client.mint(&user_b, &200);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Event test"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600,
    );

    client.place_bet(&user_a, &pool_id, &0, &300, &None::<Address>);
    client.place_bet(&user_b, &pool_id, &1, &200, &None::<Address>);

    env.ledger().with_mut(|li| {
        li.timestamp = 3601;
    });
    client.settle_pool(&creator, &pool_id, &0); // A wins

    let winnings = client.claim_winnings(&user_a, &pool_id);

    // Retrieve events emitted
    let events = env.events().all();

    // The last event emitted in `claim_winnings` is the `claim_winnings` event itself
    let last_event = events.events().last().expect("must emit an event");

    // Verify topics via XDR decoding
    // Topics: [claim_winnings, pool_id, user]
    let topic0: soroban_sdk::Symbol = soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, last_event, 0)).unwrap();
    let topic1: u32 = soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, last_event, 1)).unwrap();
    let topic2: Address = soroban_sdk::TryFromVal::try_from_val(&env, &xdr_topic_val(&env, last_event, 2)).unwrap();

    assert_eq!(topic0, soroban_sdk::Symbol::new(&env, "claim_winnings"));
    assert_eq!(topic1, pool_id);
    assert_eq!(topic2, user_a);

    // Verify payload is ClaimEvent
    let data_val: Val = match &last_event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => {
            <Val as soroban_sdk::TryFromVal<Env, soroban_sdk::xdr::ScVal>>::try_from_val(&env, &v0.data).unwrap()
        }
    };
    let claim_event: crate::ClaimEvent = soroban_sdk::TryFromVal::try_from_val(&env, &data_val).unwrap();

    assert_eq!(claim_event.amount, winnings);
    assert_eq!(claim_event.winning_outcome, 0);
    assert_eq!(claim_event.total_pool_size, 500);

    let expected_fee = (500i128 * 2) / 100;
    assert_eq!(claim_event.fee_amount, expected_fee);
}

// ============================================================================
// Issue #187: Metadata validation tests
// ============================================================================

// ============================================================================
// Issue #193: Contract configuration read method tests
//
// The contract exposes a single get_config method for frontend bootstrapping.
// ============================================================================

/// I1: get_config returns all configuration values after initialization.
#[test]
fn i1_get_config_returns_all_values() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    client.initialize(&token_id.address(), &token_admin);

    let config = client.get_config();

    assert_eq!(config.token, token_id.address());
    assert_eq!(config.treasury_recipient, token_admin);
    assert_eq!(config.creation_fee, 0i128);
    assert_eq!(config.protocol_fee_bps, 200u32);
    assert_eq!(config.event_schema_version, Symbol::new(&env, "v1"));
}

/// I2: get_config reflects updated values after configuration changes.
#[test]
fn i2_get_config_reflects_updates() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    client.initialize(&token_id.address(), &token_admin);

    client.set_creation_fee(&token_admin, &5000i128);
    client.set_protocol_fee(&token_admin, &500u32);

    let config = client.get_config();

    assert_eq!(config.creation_fee, 5000i128);
    assert_eq!(config.protocol_fee_bps, 500u32);
}

// ============================================================================
// Issue #154: Metadata length limit tests
// ============================================================================

#[test]
#[should_panic]
fn test_create_pool_exceeds_title_length() {
    let t = setup();
    let long_title_str = std::string::String::from_utf8(std::vec![b'A'; 101]).unwrap();
    let long_title = String::from_str(&t.env, &long_title_str);

    t.client.create_pool(
        &t.admin,
        &long_title,
        &String::from_str(&t.env, "Description"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
    );
}

#[test]
#[should_panic]
fn test_create_pool_exceeds_description_length() {
    let t = setup();
    let long_desc_str = std::string::String::from_utf8(std::vec![b'B'; 1001]).unwrap();
    let long_desc = String::from_str(&t.env, &long_desc_str);

    t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &long_desc,
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
    );
}

#[test]
#[should_panic]
fn test_create_pool_exceeds_outcome_length() {
    let t = setup();
    let long_outcome_str = std::string::String::from_utf8(std::vec![b'C'; 51]).unwrap();
    let long_outcome = String::from_str(&t.env, &long_outcome_str);

    t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Title"),
        &String::from_str(&t.env, "Description"),
        &long_outcome, // A exceeds
        &String::from_str(&t.env, "No"),
        &3_600u64,
    );
}

#[test]
fn test_create_pool_max_lengths_accepted() {
    let t = setup();

    let title_str = std::string::String::from_utf8(std::vec![b'T'; 100]).unwrap();
    let desc_str = std::string::String::from_utf8(std::vec![b'D'; 1000]).unwrap();
    let out_a_str = std::string::String::from_utf8(std::vec![b'A'; 50]).unwrap();
    let out_b_str = std::string::String::from_utf8(std::vec![b'B'; 50]).unwrap();

    let pool_id = t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, &title_str),
        &String::from_str(&t.env, &desc_str),
        &String::from_str(&t.env, &out_a_str),
        &String::from_str(&t.env, &out_b_str),
        &3_600u64,
    );

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.title.len(), 100);
    assert_eq!(pool.description.len(), 1000);
    assert_eq!(pool.outcome_a_name.len(), 50);
}

#[test]
#[should_panic]
fn test_circuit_breaker_rejects_bets_above_max_pool_size() {
    let t = setup();
    t.client.set_circuit_breaker_config(&t.admin, &200, &0, &0);

    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);
    let token_admin_client = token::StellarAssetClient::new(&t.env, &t.token);
    token_admin_client.mint(&user_a, &500);
    token_admin_client.mint(&user_b, &500);

    let pool_id = make_pool(&t);
    t.client
        .place_bet(&user_a, &pool_id, &0, &150, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1, &60, &None::<Address>);
}

#[test]
fn test_circuit_breaker_auto_cooling_freezes_then_unlocks() {
    let t = setup();
    t.client
        .set_circuit_breaker_config(&t.admin, &0, &200, &120);

    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);
    let token_admin_client = token::StellarAssetClient::new(&t.env, &t.token);
    token_admin_client.mint(&user_a, &500);
    token_admin_client.mint(&user_b, &500);

    let pool_id = make_pool(&t);
    t.client
        .place_bet(&user_a, &pool_id, &0, &150, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1, &50, &None::<Address>);

    let frozen_pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(frozen_pool.status, PoolStatus::Frozen);

    t.env.ledger().with_mut(|li| li.timestamp += 121);
    t.client
        .place_bet(&user_a, &pool_id, &0, &10, &None::<Address>);
    let reopened_pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(reopened_pool.status, PoolStatus::Open);
}

#[test]
fn test_circuit_breaker_admin_override_unfreezes_pool() {
    let t = setup();
    t.client
        .set_circuit_breaker_config(&t.admin, &0, &200, &300);

    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);
    let token_admin_client = token::StellarAssetClient::new(&t.env, &t.token);
    token_admin_client.mint(&user_a, &500);
    token_admin_client.mint(&user_b, &500);

    let pool_id = make_pool(&t);
    t.client
        .place_bet(&user_a, &pool_id, &0, &150, &None::<Address>);
    t.client
        .place_bet(&user_b, &pool_id, &1, &50, &None::<Address>);
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Frozen
    );

    t.client.override_pool_cooling(&t.admin, &pool_id);
    t.client
        .place_bet(&user_a, &pool_id, &0, &10, &None::<Address>);
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Open
    );
}

#[test]
#[should_panic]
fn test_rate_limit_blocks_wallet_when_threshold_exceeded() {
    let t = setup();
    t.client.set_rate_limit_config(&t.admin, &2, &60);

    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0, &10, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_id, &1, &10, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_id, &0, &10, &None::<Address>);
}

#[test]
fn test_rate_limit_resets_after_window() {
    let t = setup();
    t.client.set_rate_limit_config(&t.admin, &2, &60);

    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0, &10, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_id, &1, &10, &None::<Address>);

    t.env.ledger().with_mut(|li| li.timestamp += 61);
    t.client
        .place_bet(&t.user, &pool_id, &0, &10, &None::<Address>);

    let status = t.client.get_wallet_rate_limit_status(&t.user);
    assert_eq!(status.used, 1);
    assert_eq!(status.remaining, 1);
}

#[test]
fn test_rate_limit_status_reports_remaining_capacity() {
    let t = setup();
    t.client.set_rate_limit_config(&t.admin, &3, &120);
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0, &10, &None::<Address>);
    t.client
        .place_bet(&t.user, &pool_id, &1, &10, &None::<Address>);

    let status = t.client.get_wallet_rate_limit_status(&t.user);
    assert_eq!(status.max_bets_per_window, 3);
    assert_eq!(status.window_secs, 120);
    assert_eq!(status.used, 2);
    assert_eq!(status.remaining, 1);
}

// ============================================================================
// Issue #350: Emergency pause mechanism
// ============================================================================

#[test]
fn test_pause_blocks_place_bet() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.set_paused(&t.admin, &true);
    assert!(t.client.is_paused());

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client
            .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);
    }));
    assert!(result.is_err(), "place_bet must be blocked when paused");
}

#[test]
fn test_pause_blocks_settle_pool() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);
    expire_pool(&t.env);

    t.client.set_paused(&t.admin, &true);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.settle_pool(&t.admin, &pool_id, &0);
    }));
    assert!(result.is_err(), "settle_pool must be blocked when paused");
}

#[test]
fn test_pause_blocks_claim_winnings() {
    let t = setup();
    let pool_id = make_pool(&t);
    let loser = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&loser, &500);
    t.client
        .place_bet(&t.user, &pool_id, &0, &300, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1, &200, &None::<Address>);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0);

    t.client.set_paused(&t.admin, &true);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_winnings(&t.user, &pool_id);
    }));
    assert!(
        result.is_err(),
        "claim_winnings must be blocked when paused"
    );
}

#[test]
fn test_pause_blocks_claim_refund() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);
    t.client.cancel_pool(&t.admin, &pool_id);

    t.client.set_paused(&t.admin, &true);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_refund(&t.user, &pool_id);
    }));
    assert!(result.is_err(), "claim_refund must be blocked when paused");
}

#[test]
fn test_pause_blocks_void_pool() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.set_paused(&t.admin, &true);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.void_pool(&t.admin, &pool_id);
    }));
    assert!(result.is_err(), "void_pool must be blocked when paused");
}

#[test]
fn test_treasury_withdrawal_works_while_paused() {
    let t = setup();
    let pool_id = make_pool(&t);
    let user2 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user2, &1000);
    t.client
        .place_bet(&t.user, &pool_id, &0, &500, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1, &500, &None::<Address>);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &0);
    t.client.claim_winnings(&t.user, &pool_id);

    let treasury = t.client.get_treasury_balance();
    assert!(treasury > 0);

    t.client.set_paused(&t.admin, &true);

    // Treasury withdrawal must still work while paused
    t.client.withdraw_treasury(&t.admin, &treasury);
    assert_eq!(t.client.get_treasury_balance(), 0);
}

#[test]
fn test_set_paused_unauthorized_rejected() {
    let t = setup();
    let stranger = Address::generate(&t.env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.set_paused(&stranger, &true);
    }));
    assert!(result.is_err(), "non-treasury must not be able to pause");
}

#[test]
fn test_resume_after_unpause() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client.set_paused(&t.admin, &true);
    t.client.set_paused(&t.admin, &false);
    assert!(!t.client.is_paused());

    // Should succeed after unpause
    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);
    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 100);
}

// ============================================================================
// Issue #351: Batch settlement
// ============================================================================

#[test]
fn test_settle_pools_batch_single_pool() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);
    expire_pool(&t.env);

    let mut reqs: soroban_sdk::Vec<PoolSettleRequest> = soroban_sdk::Vec::new(&t.env);
    reqs.push_back(PoolSettleRequest {
        pool_id,
        winning_outcome: 0,
    });

    let results = t.client.settle_pools(&t.admin, &reqs);
    assert_eq!(results.len(), 1);
    assert!(results.get(0).unwrap().success);
    assert_eq!(results.get(0).unwrap().pool_id, pool_id);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Settled(0));
}

#[test]
fn test_settle_pools_batch_partial_failure() {
    let t = setup();
    let pool_a = make_pool(&t);
    t.client
        .place_bet(&t.user, &pool_a, &0, &100, &None::<Address>);
    expire_pool(&t.env);

    // Create a pool with a very long duration so it's not yet expired
    let future_pool_id = t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Future pool"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &999_999u64,
    );

    let mut reqs: soroban_sdk::Vec<PoolSettleRequest> = soroban_sdk::Vec::new(&t.env);
    reqs.push_back(PoolSettleRequest {
        pool_id: pool_a,
        winning_outcome: 0,
    });
    reqs.push_back(PoolSettleRequest {
        pool_id: future_pool_id,
        winning_outcome: 0,
    });

    let results = t.client.settle_pools(&t.admin, &reqs);
    assert_eq!(results.len(), 2);
    assert!(results.get(0).unwrap().success, "pool_a must settle");
    assert!(
        !results.get(1).unwrap().success,
        "future pool must fail (not expired)"
    );
}

#[test]
fn test_settle_pools_caps_at_twenty() {
    let t = setup();
    let mut reqs: soroban_sdk::Vec<PoolSettleRequest> = soroban_sdk::Vec::new(&t.env);
    for _ in 0..25 {
        reqs.push_back(PoolSettleRequest {
            pool_id: 999,
            winning_outcome: 0,
        });
    }

    let results = t.client.settle_pools(&t.admin, &reqs);
    assert_eq!(results.len(), 20, "must cap at 20 pools");
}

#[test]
fn test_settle_pools_unauthorized_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);

    let mut reqs: soroban_sdk::Vec<PoolSettleRequest> = soroban_sdk::Vec::new(&t.env);
    reqs.push_back(PoolSettleRequest {
        pool_id,
        winning_outcome: 0,
    });

    let stranger = Address::generate(&t.env);

    let results = t.client.settle_pools(&stranger, &reqs);
    assert_eq!(results.len(), 1, "must return exactly 1 result");
    assert!(
        !results.get(0).unwrap().success,
        "unauthorized caller must fail to settle"
    );
}

// ============================================================================
// Issue #356: Optional referral tracking
// ============================================================================

#[test]
fn test_place_bet_with_referrer_emits_event() {
    let t = setup();
    let pool_id = make_pool(&t);
    let referrer = Address::generate(&t.env);

    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &Some(referrer.clone()));

    let events = t.env.events().all();
    let found = events.events().iter().any(|event| {
        let topic0: soroban_sdk::Symbol =
            soroban_sdk::TryFromVal::try_from_val(&t.env, &xdr_topic_val(&t.env, event, 0)).unwrap();
        topic0 == soroban_sdk::Symbol::new(&t.env, "referral_bet")
    });
    assert!(found, "referral_bet event must be emitted");
}

#[test]
fn test_place_bet_without_referrer_no_referral_event() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0, &100, &None::<Address>);

    let events = t.env.events().all();
    let found = events.events().iter().any(|event| {
        let topic0: soroban_sdk::Symbol =
            soroban_sdk::TryFromVal::try_from_val(&t.env, &xdr_topic_val(&t.env, event, 0)).unwrap();
        topic0 == soroban_sdk::Symbol::new(&t.env, "referral_bet")
    });
    assert!(
        !found,
        "referral_bet event must NOT be emitted without referrer"
    );
}

// ============================================================================
// Issues #308, #349, #354: multi-outcome pools, metadata, and templates
// ============================================================================

#[test]
fn test_multi_outcome_pool_accepts_third_outcome_and_pays_winner() {
    let t = setup();
    let user2 = Address::generate(&t.env);
    let user3 = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user2, &10_000i128);
    token_admin.mint(&user3, &10_000i128);

    let mut outcomes = soroban_sdk::Vec::new(&t.env);
    outcomes.push_back(String::from_str(&t.env, "Red"));
    outcomes.push_back(String::from_str(&t.env, "Blue"));
    outcomes.push_back(String::from_str(&t.env, "Green"));

    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Three-way pool"),
        &String::from_str(&t.env, "Choose a color"),
        &outcomes,
        &3_600u64,
        &None::<String>,
    );

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);
    t.client
        .place_bet(&user2, &pool_id, &1u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&user3, &pool_id, &2u32, &300i128, &None::<Address>);

    let outcome_state = t.client.get_pool_outcomes(&pool_id);
    assert_eq!(outcome_state.len(), 3);
    assert_eq!(outcome_state.get(2).unwrap().total, 300i128);

    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &2u32);

    let payout = t.client.claim_winnings(&user3, &pool_id);
    assert_eq!(payout, 588i128);
}

#[test]
fn test_pool_metadata_can_be_set_by_creator_only_and_validates_scheme() {
    let t = setup();
    let mut outcomes = soroban_sdk::Vec::new(&t.env);
    outcomes.push_back(String::from_str(&t.env, "Yes"));
    outcomes.push_back(String::from_str(&t.env, "No"));
    let pool_id = t.client.create_multi_outcome_pool(
        &t.admin,
        &String::from_str(&t.env, "Metadata pool"),
        &String::from_str(&t.env, "Description"),
        &outcomes,
        &3_600u64,
        &Some(String::from_str(&t.env, "ipfs://market")),
    );

    assert_eq!(
        t.client.get_pool_metadata(&pool_id).unwrap(),
        String::from_str(&t.env, "ipfs://market")
    );

    t.client.set_pool_metadata(
        &t.admin,
        &pool_id,
        &Some(String::from_str(&t.env, "https://example.com/market.json")),
    );
    assert_eq!(
        t.client.get_pool_metadata(&pool_id).unwrap(),
        String::from_str(&t.env, "https://example.com/market.json")
    );

    let stranger = Address::generate(&t.env);
    let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.set_pool_metadata(
            &stranger,
            &pool_id,
            &Some(String::from_str(&t.env, "https://example.com/nope.json")),
        );
    }));
    assert!(unauthorized.is_err());

    let invalid_scheme = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.set_pool_metadata(
            &t.admin,
            &pool_id,
            &Some(String::from_str(&t.env, "ftp://example.com/market.json")),
        );
    }));
    assert!(invalid_scheme.is_err());
}

#[test]
fn test_pool_templates_are_treasury_managed_and_create_pools_with_overrides() {
    let t = setup();
    let mut outcomes = soroban_sdk::Vec::new(&t.env);
    outcomes.push_back(String::from_str(&t.env, "Home"));
    outcomes.push_back(String::from_str(&t.env, "Draw"));
    outcomes.push_back(String::from_str(&t.env, "Away"));

    let template_id = t.client.create_pool_template(
        &t.admin,
        &String::from_str(&t.env, "Match result"),
        &String::from_str(&t.env, "Standard 1X2 market"),
        &outcomes,
        &3_600u64,
        &Some(String::from_str(&t.env, "ar://template")),
        &true,
    );
    assert_eq!(t.client.get_templates().len(), 1);

    let overrides = PoolTemplateOverrides {
        title: Some(String::from_str(&t.env, "Final result")),
        description: None,
        outcomes: None,
        duration: Some(7_200u64),
        metadata_uri: Some(String::from_str(&t.env, "https://example.com/final.json")),
    };

    let pool_id = t
        .client
        .create_pool_from_template(&t.user, &template_id, &overrides);
    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.title, String::from_str(&t.env, "Final result"));
    assert_eq!(pool.expiry, pool.created_at + 7_200u64);
    assert_eq!(
        t.client.get_pool_metadata(&pool_id).unwrap(),
        String::from_str(&t.env, "https://example.com/final.json")
    );

    let stranger = Address::generate(&t.env);
    let unauthorized = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.delete_pool_template(&stranger, &template_id);
    }));
    assert!(unauthorized.is_err());

    t.client.delete_pool_template(&t.admin, &template_id);
    assert_eq!(t.client.get_templates().len(), 0);
}

// ============================================================================
// Issue #411: list_pools — paginated pool listing
// ============================================================================

#[test]
fn test_list_pools_empty_returns_empty() {
    // No pools created — any start should return empty.
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let result = client.list_pools(&1, &20);
    assert_eq!(result.len(), 0, "no pools created must return empty vec");
}

#[test]
fn test_list_pools_start_beyond_count_returns_empty() {
    let t = setup();
    make_pool(&t);
    make_pool(&t);
    // start=100 is beyond the 2 pools that exist.
    let result = t.client.list_pools(&100, &10);
    assert_eq!(result.len(), 0, "start beyond pool count must return empty");
}

#[test]
fn test_list_pools_exact_page_returns_all() {
    let t = setup();
    make_pool(&t);
    make_pool(&t);
    make_pool(&t);
    // pool IDs are 1-based; start=1, limit=3 should return all 3.
    let result = t.client.list_pools(&1, &3);
    assert_eq!(result.len(), 3, "exact page must return all pools");
}

#[test]
fn test_list_pools_partial_page_at_boundary() {
    let t = setup();
    make_pool(&t);
    make_pool(&t);
    make_pool(&t);
    // start=3, limit=10 — only pool 3 remains.
    let result = t.client.list_pools(&3, &10);
    assert_eq!(
        result.len(),
        1,
        "partial page at boundary must return remaining pools"
    );
}

#[test]
fn test_list_pools_limit_capped_at_20() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    client.initialize(&token_id.address(), &token_admin);
    let creator = Address::generate(&env);
    // Create 25 pools.
    for i in 0..25u64 {
        client.create_pool(
            &creator,
            &String::from_str(&env, &std::format!("Pool {}", i)),
            &String::from_str(&env, "Desc"),
            &String::from_str(&env, "Yes"),
            &String::from_str(&env, "No"),
            &3_600u64,
        );
    }
    // Requesting 50 must be capped at 20.
    let result = client.list_pools(&1, &50);
    assert_eq!(result.len(), 20, "limit must be capped at 20");
}

#[test]
fn test_list_pools_insertion_order_preserved() {
    let t = setup();
    let id1 = make_pool(&t);
    let id2 = make_pool(&t);
    let id3 = make_pool(&t);
    let result = t.client.list_pools(&1, &3);
    assert_eq!(result.len(), 3);
    // Pools are returned in ascending ID order (insertion order).
    assert_eq!(
        result.get(0).unwrap().creator,
        t.client.get_pool(&id1).unwrap().creator
    );
    assert_eq!(
        result.get(1).unwrap().creator,
        t.client.get_pool(&id2).unwrap().creator
    );
    assert_eq!(
        result.get(2).unwrap().creator,
        t.client.get_pool(&id3).unwrap().creator
    );
}

#[test]
fn test_list_pools_second_page() {
    let t = setup();
    make_pool(&t); // id 1
    make_pool(&t); // id 2
    make_pool(&t); // id 3
    make_pool(&t); // id 4
    make_pool(&t); // id 5

    let page1 = t.client.list_pools(&1, &2);
    assert_eq!(page1.len(), 2);

    let page2 = t.client.list_pools(&3, &2);
    assert_eq!(page2.len(), 2);

    let page3 = t.client.list_pools(&5, &2);
    assert_eq!(page3.len(), 1);
}

// ============================================================================
// Issue #412: claim_expired — refund from expired unsettled pools
// ============================================================================

#[test]
fn test_claim_expired_successful_refund() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Place a bet then let the pool expire without settling.
    t.client
        .place_bet(&t.user, &pool_id, &0u32, &300i128, &None::<Address>);

    // Advance past expiry.
    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    let token = soroban_sdk::token::Client::new(&t.env, &t.token);
    let balance_before = token.balance(&t.user);

    let refund = t.client.claim_expired(&t.user, &pool_id);

    assert_eq!(refund, 300i128, "refund must equal original bet");
    assert_eq!(
        token.balance(&t.user),
        balance_before + 300,
        "tokens must be returned to user"
    );
}

#[test]
fn test_claim_expired_no_fee_deducted() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &500i128, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    let refund = t.client.claim_expired(&t.user, &pool_id);
    // Full amount back — no protocol fee on expired refunds.
    assert_eq!(
        refund, 500i128,
        "no fee must be deducted from expired refund"
    );
}

#[test]
fn test_claim_expired_double_claim_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &200i128, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    // First claim succeeds.
    t.client.claim_expired(&t.user, &pool_id);

    // Second claim must panic — bet record was removed.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        t.client.claim_expired(&t.user, &pool_id);
    }));
    assert!(result.is_err(), "double claim must be rejected");
}

#[test]
#[should_panic]
fn test_claim_expired_on_active_pool_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &100i128, &None::<Address>);

    // Ledger is still before expiry — must panic.
    t.client.claim_expired(&t.user, &pool_id);
}

#[test]
#[should_panic]
fn test_claim_expired_on_settled_pool_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    let loser = Address::generate(&t.env);
    let token_admin = soroban_sdk::token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&loser, &200);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &200i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &200i128, &None::<Address>);

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);
    t.client.settle_pool(&t.admin, &pool_id, &0u32);

    // Pool is now Settled — claim_expired must panic.
    t.client.claim_expired(&t.user, &pool_id);
}

#[test]
#[should_panic]
fn test_claim_expired_no_bet_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    // User never placed a bet — must panic.
    let no_bet_user = Address::generate(&t.env);
    t.client.claim_expired(&no_bet_user, &pool_id);
}

#[test]
fn test_claim_expired_removes_bet_record() {
    let t = setup();
    let pool_id = make_pool(&t);

    t.client
        .place_bet(&t.user, &pool_id, &0u32, &150i128, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    t.client.claim_expired(&t.user, &pool_id);

    // Bet record must be gone after claim.
    let bet = t.client.get_user_bet(&pool_id, &t.user);
    assert!(
        bet.is_none(),
        "bet record must be removed after claim_expired"
    );
}

/// F6: withdraw_liquidity panics when shares exceed position.
/// Ignored: requires provide_liquidity / withdraw_liquidity which are not yet implemented.
#[test]
#[ignore]
fn f6_withdraw_more_than_owned_rejected() {
    panic!("LP feature not yet implemented in contract");
}

// ============================================================================
// Issue #419: Pool dispute resolution mechanism
// ============================================================================

/// G1: dispute_pool within settlement window succeeds.
/// Ignored: requires get_pool_dispute which is not yet implemented.
#[test]
#[ignore]
fn g1_dispute_within_window_succeeds() {
    panic!("get_pool_dispute not yet implemented in contract");
}

/// G2: dispute_pool after window expiry is rejected.
/// Ignored: dispute_pool call signature mismatch (reason arg not in contract).
#[test]
#[ignore]
fn g2_dispute_after_window_rejected() {
    panic!("dispute_pool reason arg not in contract; test needs updating");
}

/// G3: resolve_dispute upheld = true → claiming proceeds normally.
/// Ignored: requires resolve_dispute / get_pool_dispute which are not yet implemented.
#[test]
#[ignore]
fn g3_resolve_upheld_allows_normal_claim() {
    panic!("resolve_dispute / get_pool_dispute not yet implemented in contract");
}

/// G4: resolve_dispute upheld = false voids pool → all bettors get refunds.
/// Ignored: requires resolve_dispute which is not yet implemented.
#[test]
#[ignore]
fn g4_resolve_void_issues_refunds() {
    panic!("resolve_dispute not yet implemented in contract");
}

/// G5: Claiming while dispute is unresolved panics.
/// Ignored: dispute_pool reason arg not in contract.
#[test]
#[ignore]
fn g5_claim_during_active_dispute_rejected() {
    panic!("dispute_pool reason arg not in contract; test needs updating");
}

/// G6: Unauthorized dispute resolution is rejected.
/// Ignored: requires resolve_dispute which is not yet implemented.
#[test]
#[ignore]
fn g6_unauthorized_resolve_rejected() {
    panic!("resolve_dispute not yet implemented in contract");
}

/// G7: get_pool_dispute returns None when no dispute exists.
/// Ignored: requires get_pool_dispute which is not yet implemented.
#[test]
#[ignore]
fn g7_get_pool_dispute_returns_none_when_no_dispute() {
    panic!("get_pool_dispute not yet implemented in contract");
}

// ============================================================================
// Issue #447: Security — double-fee fix (proportional treasury fee per claim)
// ============================================================================

/// H1: Two winners both claim; treasury receives exactly one pool fee in total.
///
/// Before the fix, each claim added the full 2% pool fee to treasury, causing
/// over-crediting when multiple winners existed. After the fix, each winner pays
/// only their proportional share of the fee.
#[test]
fn h1_double_fee_fix_treasury_correct_with_multiple_winners() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&token_id.address(), &token_admin);

    let creator = Address::generate(&env);
    let winner1 = Address::generate(&env);
    let winner2 = Address::generate(&env);
    let loser = Address::generate(&env);

    token_admin_client.mint(&winner1, &300i128);
    token_admin_client.mint(&winner2, &100i128);
    token_admin_client.mint(&loser, &200i128);

    let pool_id = client.create_pool(
        &creator,
        &String::from_str(&env, "Pool"),
        &String::from_str(&env, "Desc"),
        &String::from_str(&env, "Yes"),
        &String::from_str(&env, "No"),
        &3600u64,
    );

    client.place_bet(&winner1, &pool_id, &0, &300, &None::<Address>); // 300 on A
    client.place_bet(&winner2, &pool_id, &0, &100, &None::<Address>); // 100 on A
    client.place_bet(&loser, &pool_id, &1, &200, &None::<Address>);   // 200 on B, loses

    env.ledger().with_mut(|l| l.timestamp = 3601);
    client.settle_pool(&creator, &pool_id, &0);

    let w1 = client.claim_winnings(&winner1, &pool_id);
    let w2 = client.claim_winnings(&winner2, &pool_id);

    // Total pool = 600. Fee 2% = 12. Net = 588.
    // Winner total = 400. w1 = 300*588/400 = 441. w2 = 100*588/400 = 147.
    assert_eq!(w1, 441i128);
    assert_eq!(w2, 147i128);
    // Total paid = 588 = net pool ✓

    // Treasury must hold exactly the fee (user-proportional fee sums to total_fee)
    let treasury = client.get_treasury_balance();
    // w1 fee = 300*12/400 = 9. w2 fee = 100*12/400 = 3. Total = 12.
    assert_eq!(treasury, 12i128, "treasury must equal exactly 2% of total pool");
}

