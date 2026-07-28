#![cfg(test)]
//! Tests for three related pool changes:
//!
//!  1. The pool creator may not bet on their own pool (`CreatorCannotBet`).
//!  2. A creator-supplied custom deposit deadline (betting cutoff) that is
//!     enforced independently of, and earlier than, the resolution deadline.
//!  3. The claim functions return the amount claimed — including a per-asset
//!     breakdown for multi-asset pools.
//!
//! Unlike much of the older suite, these tests use bet amounts at or above
//! `MIN_BET_AMOUNT` so the contract's dust-prevention floor does not reject the
//! bets before the behaviour under test is exercised.

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

/// A bet size comfortably above `MIN_BET_AMOUNT` (1_000_000 stroops).
const BET: i128 = 5_000_000;

// ── Single-asset harness ─────────────────────────────────────────────────────

struct Setup {
    env: Env,
    client: PredinexContractClient<'static>,
    token: token::Client<'static>,
    minter: token::StellarAssetClient<'static>,
    admin: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token = token::Client::new(&env, &token_id.address());
    let minter = token::StellarAssetClient::new(&env, &token_id.address());

    // The admin address is both treasury recipient and pool settler.
    let admin = Address::generate(&env);
    client.initialize(&token_id.address(), &admin, &admin);

    env.ledger().with_mut(|li| li.timestamp = 1_000);

    Setup {
        env,
        client,
        token,
        minter,
        admin,
    }
}

fn new_pool(s: &Setup, creator: &Address, duration: u64, deposit_deadline: Option<u64>) -> u32 {
    s.client.create_pool(
        creator,
        &String::from_str(&s.env, "Market"),
        &String::from_str(&s.env, "Desc"),
        &String::from_str(&s.env, "Yes"),
        &String::from_str(&s.env, "No"),
        &duration,
        &MIN_CREATOR_DEPOSIT,
        &deposit_deadline,
    )
}

fn funded_account(s: &Setup, amount: i128) -> Address {
    let a = Address::generate(&s.env);
    s.minter.mint(&a, &amount);
    a
}

// ── Issue: creator cannot bet on own pool ────────────────────────────────────

#[test]
fn creator_cannot_bet_on_own_single_asset_pool() {
    let s = setup();
    let creator = funded_account(&s, BET);
    let pool_id = new_pool(&s, &creator, 3_600, None);

    let res = s
        .client
        .try_place_bet(&creator, &pool_id, &0, &BET, &None::<Address>);
    assert_eq!(res, Err(Ok(ContractError::CreatorCannotBet)));
}

#[test]
fn non_creator_can_bet_on_pool() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let pool_id = new_pool(&s, &creator, 3_600, None);

    let bettor = funded_account(&s, BET);
    s.client
        .place_bet(&bettor, &pool_id, &0, &BET, &None::<Address>);

    let pool = s.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, BET);
}

#[test]
fn creator_can_bet_on_someone_elses_pool() {
    let s = setup();
    // Alice creates pool 1; Bob creates pool 2.
    let alice = funded_account(&s, BET);
    let bob = Address::generate(&s.env);
    let _alice_pool = new_pool(&s, &alice, 3_600, None);
    let bob_pool = new_pool(&s, &bob, 3_600, None);

    // Alice (a creator) may still bet on Bob's pool.
    s.client
        .place_bet(&alice, &bob_pool, &0, &BET, &None::<Address>);

    let pool = s.client.get_pool(&bob_pool).unwrap();
    assert_eq!(pool.total_a, BET);
}

// ── Issue: custom deposit deadline ───────────────────────────────────────────

#[test]
fn create_pool_stores_custom_deposit_deadline() {
    let s = setup();
    let creator = Address::generate(&s.env);
    // now = 1_000, expiry = 1_000 + 3_600 = 4_600. Deadline strictly between.
    let pool_id = new_pool(&s, &creator, 3_600, Some(2_800));

    let pool = s.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.expiry, 4_600);
    assert_eq!(pool.deposit_deadline, 2_800);
}

#[test]
fn default_deposit_deadline_equals_expiry() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let pool_id = new_pool(&s, &creator, 3_600, None);

    let pool = s.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.deposit_deadline, pool.expiry);
}

#[test]
fn deposit_deadline_must_be_in_the_future() {
    let s = setup();
    let creator = Address::generate(&s.env);
    // now == 1_000; a deadline at/below now is rejected.
    let res = s.client.try_create_pool(
        &creator,
        &String::from_str(&s.env, "Market"),
        &String::from_str(&s.env, "Desc"),
        &String::from_str(&s.env, "Yes"),
        &String::from_str(&s.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
        &Some(1_000u64),
    );
    assert_eq!(res, Err(Ok(ContractError::InvalidDepositDeadline)));
}

#[test]
fn deposit_deadline_must_be_before_resolution() {
    let s = setup();
    let creator = Address::generate(&s.env);
    // expiry = 4_600; a deadline at/after expiry is rejected.
    let res = s.client.try_create_pool(
        &creator,
        &String::from_str(&s.env, "Market"),
        &String::from_str(&s.env, "Desc"),
        &String::from_str(&s.env, "Yes"),
        &String::from_str(&s.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
        &Some(4_600u64),
    );
    assert_eq!(res, Err(Ok(ContractError::InvalidDepositDeadline)));
}

#[test]
fn bet_allowed_before_deposit_deadline() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let pool_id = new_pool(&s, &creator, 3_600, Some(2_800));

    let bettor = funded_account(&s, BET);
    // now = 1_500 < deadline 2_800.
    s.env.ledger().with_mut(|li| li.timestamp = 1_500);
    s.client
        .place_bet(&bettor, &pool_id, &0, &BET, &None::<Address>);

    assert_eq!(s.client.get_pool(&pool_id).unwrap().total_a, BET);
}

#[test]
fn bet_rejected_after_deposit_deadline_but_before_expiry() {
    let s = setup();
    let creator = Address::generate(&s.env);
    let pool_id = new_pool(&s, &creator, 3_600, Some(2_800));

    let bettor = funded_account(&s, BET);
    // now = 3_000: past deadline (2_800) but before expiry (4_600).
    s.env.ledger().with_mut(|li| li.timestamp = 3_000);
    let res = s
        .client
        .try_place_bet(&bettor, &pool_id, &0, &BET, &None::<Address>);
    assert_eq!(res, Err(Ok(ContractError::DepositDeadlinePassed)));
}

// ── Issue: claim functions return the amount claimed ─────────────────────────

/// Settle a freshly created two-bettor pool on `winning_outcome` and return the
/// `(winner, pool_id)` pair, with the winner having staked `BET` on the winner
/// outcome and a loser `BET` on the other.
fn settled_pool(s: &Setup, winning_outcome: u32) -> (Address, u32) {
    let creator = Address::generate(&s.env);
    let pool_id = new_pool(&s, &creator, 3_600, None);

    let winner = funded_account(s, BET);
    let loser = funded_account(s, BET);
    let losing_outcome = 1 - winning_outcome;
    s.client
        .place_bet(&winner, &pool_id, &winning_outcome, &BET, &None::<Address>);
    s.client
        .place_bet(&loser, &pool_id, &losing_outcome, &BET, &None::<Address>);

    s.env.ledger().with_mut(|li| li.timestamp = 1_000 + 3_601);
    s.client.settle_pool(&s.admin, &pool_id, &winning_outcome);
    (winner, pool_id)
}

#[test]
fn claim_winnings_returns_amount_transferred() {
    let s = setup();
    let (winner, pool_id) = settled_pool(&s, 0);

    let before = s.token.balance(&winner);
    let claimed = s.client.claim_winnings(&winner, &pool_id);
    let after = s.token.balance(&winner);

    assert!(claimed > 0);
    // The returned value is exactly what was transferred to the winner.
    assert_eq!(claimed, after - before);
}

#[test]
fn claim_all_winnings_returns_per_pool_amounts() {
    let s = setup();
    let (winner, pool_a) = settled_pool(&s, 0);

    let before = s.token.balance(&winner);
    let mut ids: Vec<u32> = Vec::new(&s.env);
    ids.push_back(pool_a);
    let results = s.client.claim_all_winnings(&winner, &ids);
    let after = s.token.balance(&winner);

    assert_eq!(results.len(), 1);
    let entry = results.get(0).unwrap();
    assert_eq!(entry.pool_id, pool_a);
    assert!(entry.amount > 0);
    // Returned amount matches the tokens actually received.
    assert_eq!(entry.amount, after - before);
}

// ── Multi-asset harness + per-asset breakdown ────────────────────────────────

struct MaSetup {
    env: Env,
    client: PredinexContractClient<'static>,
    alt: token::Client<'static>,
    alt_minter: token::StellarAssetClient<'static>,
    admin: Address,
}

fn ma_setup() -> MaSetup {
    let env = Env::default();
    env.mock_all_auths();

    let proto_admin = Address::generate(&env);
    let proto_id = env.register_stellar_asset_contract_v2(proto_admin);

    let alt_admin = Address::generate(&env);
    let alt_id = env.register_stellar_asset_contract_v2(alt_admin);
    let alt = token::Client::new(&env, &alt_id.address());
    let alt_minter = token::StellarAssetClient::new(&env, &alt_id.address());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&proto_id.address(), &admin, &admin);
    // 1 alt = 1 proto.
    client.set_token_exchange_rate(&admin, &alt_id.address(), &10_000i128);

    env.ledger().with_mut(|li| li.timestamp = 1_000);

    MaSetup {
        env,
        client,
        alt,
        alt_minter,
        admin,
    }
}

fn ma_pool(s: &MaSetup, creator: &Address, deposit_deadline: Option<u64>) -> u32 {
    let mut outcomes: Vec<String> = Vec::new(&s.env);
    outcomes.push_back(String::from_str(&s.env, "Yes"));
    outcomes.push_back(String::from_str(&s.env, "No"));
    let mut tokens: Vec<Address> = Vec::new(&s.env);
    tokens.push_back(s.alt.address.clone());

    s.client.create_multi_asset_pool(
        creator,
        &String::from_str(&s.env, "MA Pool"),
        &String::from_str(&s.env, "Desc"),
        &outcomes,
        &3_600u64,
        &tokens,
        &None,
        &deposit_deadline,
    )
}

#[test]
fn creator_cannot_bet_on_own_multi_asset_pool() {
    let s = ma_setup();
    let creator = Address::generate(&s.env);
    let pool_id = ma_pool(&s, &creator, None);
    s.alt_minter.mint(&creator, &BET);

    let res =
        s.client
            .try_place_multi_asset_bet(&creator, &pool_id, &0u32, &BET, &s.alt.address, &None);
    assert_eq!(res, Err(Ok(ContractError::CreatorCannotBet)));
}

#[test]
fn multi_asset_bet_rejected_after_deposit_deadline() {
    let s = ma_setup();
    let creator = Address::generate(&s.env);
    let pool_id = ma_pool(&s, &creator, Some(2_800));

    let bettor = Address::generate(&s.env);
    s.alt_minter.mint(&bettor, &BET);
    s.env.ledger().with_mut(|li| li.timestamp = 3_000);
    let res =
        s.client
            .try_place_multi_asset_bet(&bettor, &pool_id, &0u32, &BET, &s.alt.address, &None);
    assert_eq!(res, Err(Ok(ContractError::DepositDeadlinePassed)));
}

#[test]
fn multi_asset_claim_returns_per_asset_breakdown() {
    let s = ma_setup();
    let creator = Address::generate(&s.env);
    let pool_id = ma_pool(&s, &creator, None);

    let winner = Address::generate(&s.env);
    let loser = Address::generate(&s.env);
    s.alt_minter.mint(&winner, &BET);
    s.alt_minter.mint(&loser, &BET);

    s.client
        .place_multi_asset_bet(&winner, &pool_id, &0u32, &BET, &s.alt.address, &None);
    s.client
        .place_multi_asset_bet(&loser, &pool_id, &1u32, &BET, &s.alt.address, &None);

    s.env.ledger().with_mut(|li| li.timestamp = 1_000 + 3_601);
    s.client.settle_pool(&s.admin, &pool_id, &0u32);

    let before = s.alt.balance(&winner);
    let result = s.client.claim_multi_asset_winnings(&winner, &pool_id);
    let after = s.alt.balance(&winner);

    // The normalized total is positive and the per-asset list names the only
    // token in the pool with the exact amount transferred.
    assert!(result.total_normalized > 0);
    assert_eq!(result.per_asset.len(), 1);
    let entry = result.per_asset.get(0).unwrap();
    assert_eq!(entry.token, s.alt.address);
    assert_eq!(entry.amount, after - before);
}
