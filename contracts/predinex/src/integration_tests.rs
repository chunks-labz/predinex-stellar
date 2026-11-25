//! End-to-end integration tests for the full bet lifecycle.
//!
//! Unlike the focused unit tests in `test.rs`, these exercise complete
//! cross-function flows — create → bet → resolve → claim — for both single-
//! and multi-outcome pools, plus the cancellation/refund and claim-after-expiry
//! paths. They also assert that each lifecycle transition emits its Soroban
//! event so off-chain indexers can reconstruct state from the event stream.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::String;
use soroban_sdk::{
    testutils::Address as _, testutils::Events, testutils::Ledger, Address, Env, Symbol, Val,
};

/// A funded test fixture: an initialized contract plus a mintable token.
struct Fixture {
    env: Env,
    client: PredinexContractClient<'static>,
    token: token::Client<'static>,
    token_admin_client: token::StellarAssetClient<'static>,
    /// Protocol admin — the only account authorized to settle pools.
    admin: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token::Client::new(&env, &token_id.address());
    let token_admin_client = token::StellarAssetClient::new(&env, &token_id.address());

    // Treasury recipient and admin are the same account for these tests.
    client.initialize(&token_id.address(), &token_admin, &token_admin);

    Fixture {
        env,
        client,
        token,
        token_admin_client,
        admin: token_admin,
    }
}

/// Returns `true` if any event from the *most recent* contract invocation
/// carries `name` as its first topic.
///
/// The Soroban test host keeps only the latest top-level invocation's events in
/// `env.events().all()`, so callers must assert immediately after the call that
/// is expected to emit the event. Scanning all topics (rather than a fixed
/// position) keeps the check robust and ignores the unrelated token-contract
/// events that also land in `env.events()`.
fn event_emitted(env: &Env, name: &str) -> bool {
    let target = Symbol::new(env, name);
    let events = env.events().all();
    events.events().iter().any(|event| match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => {
            if let Some(first) = v0.topics.first() {
                if let Ok(val) =
                    <Val as soroban_sdk::TryFromVal<Env, soroban_sdk::xdr::ScVal>>::try_from_val(
                        env, first,
                    )
                {
                    if let Ok(sym) =
                        <Symbol as soroban_sdk::TryFromVal<Env, Val>>::try_from_val(env, &val)
                    {
                        return sym == target;
                    }
                }
            }
            false
        }
    })
}

/// Single-asset (binary) pool: create → two bets → settle → winner claims.
#[test]
fn single_asset_pool_full_lifecycle() {
    let f = setup();
    let creator = Address::generate(&f.env);
    let winner = Address::generate(&f.env);
    let loser = Address::generate(&f.env);

    // Bets must clear the protocol minimum (1_000_000 base units).
    let bet = 1_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    f.token_admin_client.mint(&winner, &100_000_000);
    f.token_admin_client.mint(&loser, &100_000_000);

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Will it rain tomorrow?"),
        &String::from_str(&f.env, "Resolves yes if rain is recorded."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );
    assert!(event_emitted(&f.env, "create_pool"));

    // Both sides take an equal position.
    f.client
        .place_bet(&winner, &pool_id, &0, &bet, &None::<Address>);
    assert!(event_emitted(&f.env, "place_bet"));
    f.client
        .place_bet(&loser, &pool_id, &1, &bet, &None::<Address>);

    assert_eq!(f.client.get_participant_count(&pool_id), 2);
    assert_eq!(f.token.balance(&winner), 100_000_000 - bet);

    // Advance past expiry and resolve outcome 0 (Yes) as the winner.
    f.env.ledger().with_mut(|li| li.timestamp = 3601);
    f.client.settle_pool(&f.admin, &pool_id, &0);
    assert!(event_emitted(&f.env, "settle_pool"));

    let pool = f.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Settled(0));

    // Pool total = 2_000_000, 2% fee = 40_000, net = 1_960_000. Sole winner takes it all.
    // (Assert the event before any token read — each contract invocation resets
    // the test host's per-invocation event buffer.)
    let winnings = f.client.claim_winnings(&winner, &pool_id);
    assert!(event_emitted(&f.env, "claim_winnings"));
    assert_eq!(winnings, 1_960_000);
    assert_eq!(f.token.balance(&winner), 100_000_000 - bet + 1_960_000);
}

/// Multi-outcome pool: create with three outcomes → bets on each → settle →
/// the winning-side bettor claims the whole net pool end-to-end.
#[test]
fn multi_asset_pool_full_lifecycle() {
    let f = setup();
    let creator = Address::generate(&f.env);
    let better_a = Address::generate(&f.env);
    let better_b = Address::generate(&f.env);
    let better_c = Address::generate(&f.env);

    let bet = 1_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    for who in [&better_a, &better_b, &better_c] {
        f.token_admin_client.mint(who, &100_000_000);
    }

    let mut outcomes = soroban_sdk::Vec::new(&f.env);
    outcomes.push_back(String::from_str(&f.env, "Team A"));
    outcomes.push_back(String::from_str(&f.env, "Team B"));
    outcomes.push_back(String::from_str(&f.env, "Draw"));

    let pool_id = f.client.create_multi_outcome_pool(
        &creator,
        &String::from_str(&f.env, "Who wins the match?"),
        &String::from_str(&f.env, "Three-way market with a draw option."),
        &outcomes,
        &3600,
        &None::<String>,
        &MIN_CREATOR_DEPOSIT,
    );
    assert!(event_emitted(&f.env, "create_pool"));

    // One bettor per outcome, equal stakes.
    f.client
        .place_bet(&better_a, &pool_id, &0, &bet, &None::<Address>);
    f.client
        .place_bet(&better_b, &pool_id, &1, &bet, &None::<Address>);
    f.client
        .place_bet(&better_c, &pool_id, &2, &bet, &None::<Address>);

    // The pool really tracks three distinct outcomes with their totals.
    let pool_outcomes = f.client.get_pool_outcomes(&pool_id);
    assert_eq!(pool_outcomes.len(), 3);
    assert_eq!(pool_outcomes.get(2).unwrap().total, bet);

    f.env.ledger().with_mut(|li| li.timestamp = 3601);
    // Outcome 2 (Draw) wins.
    f.client.settle_pool(&f.admin, &pool_id, &2);
    assert!(event_emitted(&f.env, "settle_pool"));

    // Pool total = 3_000_000, 2% fee = 60_000, net = 2_940_000, single winner on outcome 2.
    let winnings = f.client.claim_winnings(&better_c, &pool_id);
    assert!(event_emitted(&f.env, "claim_winnings"));
    assert_eq!(winnings, 2_940_000);
    assert_eq!(f.token.balance(&better_c), 100_000_000 - bet + 2_940_000);

    // A losing-side bettor has nothing to claim.
    assert!(f.client.try_claim_winnings(&better_a, &pool_id).is_err());
}

/// Cancellation + refund: the creator cancels an open pool and every bettor is
/// refunded their full stake atomically as part of the cancellation.
#[test]
fn cancellation_and_refund_flow() {
    let f = setup();
    let creator = Address::generate(&f.env);
    let bettor = Address::generate(&f.env);

    let stake = 2_500_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    f.token_admin_client.mint(&bettor, &100_000_000);

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Will the launch ship on time?"),
        &String::from_str(&f.env, "Resolves yes on an on-time launch."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    f.client
        .place_bet(&bettor, &pool_id, &0, &stake, &None::<Address>);
    assert_eq!(f.token.balance(&bettor), 100_000_000 - stake);

    // Creator cancels the market while still open. cancel_pool refunds all
    // bettors their full stake (no fee) atomically and removes their positions.
    f.client.cancel_pool(
        &creator,
        &pool_id,
        &String::from_str(&f.env, "Event cancelled"),
    );
    assert!(event_emitted(&f.env, "cancel_pool"));

    assert_eq!(
        f.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Cancelled
    );
    // The stake was returned in full as part of cancellation — no protocol fee.
    assert_eq!(f.token.balance(&bettor), 100_000_000);

    // The position is gone, so an explicit refund claim has nothing to return.
    assert!(f.client.try_claim_refund(&bettor, &pool_id).is_err());
}

/// Claim after expiry: a pool expires without ever being settled, and the
/// bettor recovers their full stake via `claim_expired`.
#[test]
fn claim_after_expiry_flow() {
    let f = setup();
    let creator = Address::generate(&f.env);
    let bettor = Address::generate(&f.env);

    let stake = 4_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    f.token_admin_client.mint(&bettor, &100_000_000);

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Abandoned market"),
        &String::from_str(&f.env, "Creator never settles this one."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );
    assert!(event_emitted(&f.env, "create_pool"));

    f.client
        .place_bet(&bettor, &pool_id, &1, &stake, &None::<Address>);
    assert_eq!(f.token.balance(&bettor), 100_000_000 - stake);

    // Move strictly past expiry; the creator never calls settle_pool.
    f.env.ledger().with_mut(|li| li.timestamp = 3601);

    // Funds would otherwise be stuck — claim_expired returns the stake in full.
    let refund = f.client.claim_expired(&bettor, &pool_id);
    assert!(event_emitted(&f.env, "claim_expired"));
    assert_eq!(refund, stake);
    assert_eq!(f.token.balance(&bettor), 100_000_000);

    // The position is gone, so a repeat claim fails.
    assert!(f.client.try_claim_expired(&bettor, &pool_id).is_err());
}

// ── #1681 — Cancellation refund accounting ───────────────────────────────────

/// Multiple participants on both outcomes are refunded their exact stake when
/// the creator cancels the pool. Every bettor's balance returns to its pre-bet
/// amount, and the pool reaches `Cancelled` status.
#[test]
fn multi_participant_cancellation_refunds_all_bettors() {
    let f = setup();
    let creator = Address::generate(&f.env);

    // Four bettors: two on outcome A, two on outcome B.
    let a1 = Address::generate(&f.env);
    let a2 = Address::generate(&f.env);
    let b1 = Address::generate(&f.env);
    let b2 = Address::generate(&f.env);

    let stake_a1 = 1_500_000i128;
    let stake_a2 = 3_000_000i128;
    let stake_b1 = 2_000_000i128;
    let stake_b2 = 500_000i128;

    let initial = 100_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    for who in [&a1, &a2, &b1, &b2] {
        f.token_admin_client.mint(who, &initial);
    }

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Multi-participant cancel test"),
        &String::from_str(&f.env, "Pool with four bettors across both outcomes."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    f.client.place_bet(&a1, &pool_id, &0, &stake_a1, &None::<Address>);
    f.client.place_bet(&a2, &pool_id, &0, &stake_a2, &None::<Address>);
    f.client.place_bet(&b1, &pool_id, &1, &stake_b1, &None::<Address>);
    f.client.place_bet(&b2, &pool_id, &1, &stake_b2, &None::<Address>);

    // Verify the pool recorded all four participants.
    assert_eq!(f.client.get_participant_count(&pool_id), 4);

    // Each bettor's balance decreased by their stake.
    assert_eq!(f.token.balance(&a1), initial - stake_a1);
    assert_eq!(f.token.balance(&a2), initial - stake_a2);
    assert_eq!(f.token.balance(&b1), initial - stake_b1);
    assert_eq!(f.token.balance(&b2), initial - stake_b2);

    // Creator cancels — all four are refunded atomically.
    f.client.cancel_pool(
        &creator,
        &pool_id,
        &String::from_str(&f.env, "Event cancelled"),
    );

    // Every bettor received their exact stake back.
    assert_eq!(f.token.balance(&a1), initial);
    assert_eq!(f.token.balance(&a2), initial);
    assert_eq!(f.token.balance(&b1), initial);
    assert_eq!(f.token.balance(&b2), initial);

    // Pool is in terminal Cancelled state.
    assert_eq!(
        f.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Cancelled
    );

    // No residual bet entries — claim_refund finds nothing.
    assert!(f.client.try_claim_refund(&a1, &pool_id).is_err());
    assert!(f.client.try_claim_refund(&b2, &pool_id).is_err());
}

/// The total amount refunded to all participants must equal the total collateral
/// locked in the pool (sum of all stakes on both outcomes). This guards against
/// partial refunds, double refunds, or fees being silently deducted during
/// cancellation.
#[test]
fn cancellation_total_refunds_equal_total_locked_collateral() {
    let f = setup();
    let creator = Address::generate(&f.env);

    let bettors: [Address; 5] = [
        Address::generate(&f.env),
        Address::generate(&f.env),
        Address::generate(&f.env),
        Address::generate(&f.env),
        Address::generate(&f.env),
    ];
    let stakes: [i128; 5] = [
        1_000_000, 2_500_000, 500_000, 7_500_000, 3_000_000,
    ];
    let outcomes: [u32; 5] = [0, 1, 0, 1, 0];

    let initial = 100_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    for who in bettors.iter() {
        f.token_admin_client.mint(who, &initial);
    }

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Refund accounting test"),
        &String::from_str(&f.env, "Verify total refunds == total locked."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    // Record the contract's token balance before cancellation — this is the
    // total collateral locked in the pool.
    let total_locked: i128 = stakes.iter().sum();
    for (i, who) in bettors.iter().enumerate() {
        f.client.place_bet(who, &pool_id, &outcomes[i], &stakes[i], &None::<Address>);
    }

    // Sanity: the contract holds exactly the sum of all stakes.
    let contract_balance_before = f.token.balance(&f.env.current_contract_address());
    assert_eq!(contract_balance_before, total_locked + MIN_CREATOR_DEPOSIT);

    // Record each bettor's balance right before cancellation.
    let balances_before: [i128; 5] = [
        f.token.balance(&bettors[0]),
        f.token.balance(&bettors[1]),
        f.token.balance(&bettors[2]),
        f.token.balance(&bettors[3]),
        f.token.balance(&bettors[4]),
    ];

    f.client.cancel_pool(
        &creator,
        &pool_id,
        &String::from_str(&f.env, "Event cancelled"),
    );

    // Sum the actual refunds received by each bettor.
    let mut total_refunded: i128 = 0;
    for i in 0..5 {
        total_refunded += f.token.balance(&bettors[i]) - balances_before[i];
    }

    assert_eq!(
        total_refunded, total_locked,
        "total refunds must equal total locked collateral"
    );

    // The contract's balance dropped by exactly the total locked (creator
    // deposit remains, it is separate from bet collateral).
    let contract_balance_after = f.token.balance(&f.env.current_contract_address());
    assert_eq!(
        contract_balance_before - contract_balance_after,
        total_locked,
        "contract balance must decrease by exactly the total locked collateral"
    );
}

/// A pool that is already `Cancelled` must reject a second `cancel_pool` call.
/// This is a regression guard against double-cancellation that could double-
/// refund participants or corrupt state.
#[test]
fn repeated_cancellation_is_rejected() {
    let f = setup();
    let creator = Address::generate(&f.env);
    let bettor = Address::generate(&f.env);

    let stake = 2_000_000i128;
    f.token_admin_client.mint(&creator, &(MIN_CREATOR_DEPOSIT * 10));
    f.token_admin_client.mint(&bettor, &100_000_000);

    let pool_id = f.client.create_pool(
        &creator,
        &String::from_str(&f.env, "Repeated cancel test"),
        &String::from_str(&f.env, "Cancel twice, second must fail."),
        &String::from_str(&f.env, "Yes"),
        &String::from_str(&f.env, "No"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );

    f.client.place_bet(&bettor, &pool_id, &0, &stake, &None::<Address>);
    assert_eq!(f.token.balance(&bettor), 100_000_000 - stake);

    // First cancellation succeeds and refunds the bettor.
    f.client.cancel_pool(
        &creator,
        &pool_id,
        &String::from_str(&f.env, "First cancellation"),
    );
    assert_eq!(f.token.balance(&bettor), 100_000_000);
    assert_eq!(
        f.client.get_pool(&pool_id).unwrap().status,
        PoolStatus::Cancelled
    );

    // Second cancellation must be rejected — the pool is already Cancelled.
    assert_eq!(
        f.client.try_cancel_pool(
            &creator,
            &pool_id,
            &String::from_str(&f.env, "Second cancellation"),
        ),
        Err(Ok(ContractError::PoolIsCancelled))
    );

    // The bettor's balance is unchanged — no double refund occurred.
    assert_eq!(f.token.balance(&bettor), 100_000_000);
}
