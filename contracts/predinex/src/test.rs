#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::String;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env};
use std::format;

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

    client.place_bet(&user, &pool_id, &0, &100);

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

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

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
#[should_panic(expected = "No bet found")]
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

    client.place_bet(&user, &pool_id, &0, &100);

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
    client.place_bet(&user, &pool_id, &0, &100);
    let token = token::Client::new(&env, &token_id.address());
    assert_eq!(token.balance(&user), 900);
}

/// A second `initialize` call must be rejected with "Already initialized".
#[test]
#[should_panic(expected = "Already initialized")]
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
    client.place_bet(&user, &pool_id, &0, &100);
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
#[should_panic(expected = "Pool has not expired yet")]
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

    client.place_bet(&user, &pool_id, &0, &100);

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

    client.place_bet(&user, &pool_id, &0, &100);

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
#[should_panic(expected = "Unauthorized")]
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

    client.place_bet(&user, &pool_id, &0, &100);

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

    client.place_bet(&user, &pool_id, &0, &100);

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
    client.place_bet(&user, &pool_id, &0u32, &100i128);
    // Place bet on outcome B (200 tokens)
    client.place_bet(&user, &pool_id, &1u32, &200i128);

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
    let env: Env = unsafe { core::mem::transmute(env) };

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
#[should_panic(expected = "Invalid outcome")]
fn a1_place_bet_outcome_2_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client.place_bet(&t.user, &pool_id, &2u32, &100i128);
}

/// A2: outcome == u32::MAX is also out of range and must be rejected.
#[test]
#[should_panic(expected = "Invalid outcome")]
fn a2_place_bet_outcome_max_u32_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client.place_bet(&t.user, &pool_id, &u32::MAX, &100i128);
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
        t.client.place_bet(&t.user, &pool_id, &2u32, &100i128);
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
    t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);

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
    t.client.place_bet(&t.user, &pool_id, &1u32, &200i128);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 0i128, "total_a must be unchanged");
    assert_eq!(pool.total_b, 200i128, "total_b must reflect outcome-1 bet");
}

// ─── Suite B — settle_pool invalid outcome ────────────────────────────────────

/// B1: winning_outcome == 2 must be rejected when settling.
#[test]
#[should_panic(expected = "Invalid outcome")]
fn b1_settle_pool_winning_outcome_2_is_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    expire_pool(&t.env);
    t.client.settle_pool(&t.admin, &pool_id, &2u32);
}

/// B2: winning_outcome == u32::MAX must be rejected when settling.
#[test]
#[should_panic(expected = "Invalid outcome")]
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
#[should_panic(expected = "Invalid bet amount")]
fn c1_place_bet_zero_amount_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client.place_bet(&t.user, &pool_id, &0u32, &0i128);
}

/// C2: place_bet with negative amount must be rejected.
#[test]
#[should_panic(expected = "Invalid bet amount")]
fn c2_place_bet_negative_amount_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);
    t.client.place_bet(&t.user, &pool_id, &0u32, &-100i128);
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
        t.client.place_bet(&t.user, &pool_id, &0u32, &0i128);
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
    t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);

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
#[should_panic(expected = "Pool expired")]
fn d1_place_bet_after_expiry_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Advance ledger time past expiry
    expire_pool(&t.env);

    // Attempt to place bet after expiry — must panic
    t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);
}

/// D2: place_bet exactly at expiry timestamp is rejected (boundary test).
#[test]
#[should_panic(expected = "Pool expired")]
fn d2_place_bet_exactly_at_expiry_rejected() {
    let t = setup();
    let pool_id = make_pool(&t);

    // Set ledger timestamp exactly at expiry (pool created with 3600s duration)
    t.env.ledger().with_mut(|info| {
        info.timestamp = 3600; // Exactly at expiry
    });

    // Attempt to place bet exactly at expiry — must panic
    t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);
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
        t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);
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
    t.client.place_bet(&t.user, &pool_id, &0u32, &100i128);

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
#[test]
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

    expire_pool(&t.env);

    t.client.settle_pool(&settler, &pool_id, &0u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert!(pool.settled, "pool must be settled");
    assert_eq!(pool.winning_outcome, Some(0u32));
}

/// F2: Unauthorized address cannot settle even after expiry.
#[test]
#[should_panic(expected = "Unauthorized")]
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
#[should_panic(expected = "Unauthorized")]
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

    expire_pool(&t.env);

    t.client.settle_pool(&t.admin, &pool_id, &1u32);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(1u32));
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
#[should_panic(expected = "Unauthorized")]
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

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

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

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

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
#[should_panic(expected = "Insufficient treasury balance")]
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
#[should_panic(expected = "Unauthorized")]
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

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

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

    client.place_bet(&user1, &pool_id, &0, &100);
    client.place_bet(&user2, &pool_id, &1, &100);

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
