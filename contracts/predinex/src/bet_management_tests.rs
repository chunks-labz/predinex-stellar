// ============================================================================
// Bet management tests: partial/full bet cancellation (`cancel_bet`) and
// pool duration extension (`extend_pool_duration`).
//
// `cancel_bet` lets a bettor reduce or close their exposure on an outcome while
// the market is still live; `extend_pool_duration` lets the creator push out an
// open pool's expiry up to the maximum total lifetime.
// ============================================================================

#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::Address as _, testutils::Events, testutils::Ledger, Address, Env, String, Val,
};

// ── Event helpers ─────────────────────────────────────────────────────────────

fn xdr_topic_val(env: &Env, event: &soroban_sdk::xdr::ContractEvent, i: usize) -> Val {
    match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => <Val as soroban_sdk::TryFromVal<
            Env,
            soroban_sdk::xdr::ScVal,
        >>::try_from_val(env, &v0.topics[i])
        .unwrap(),
    }
}

fn xdr_data_val(env: &Env, event: &soroban_sdk::xdr::ContractEvent) -> Val {
    match &event.body {
        soroban_sdk::xdr::ContractEventBody::V0(v0) => <Val as soroban_sdk::TryFromVal<
            Env,
            soroban_sdk::xdr::ScVal,
        >>::try_from_val(env, &v0.data)
        .unwrap(),
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

struct BmEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    token: Address,
    admin: Address,
}

fn setup_bm() -> BmEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &token_admin, &token_admin);

    BmEnv {
        env,
        client,
        token: token_id.address(),
        admin: token_admin,
    }
}

fn mint(env: &Env, token: &Address, user: &Address, amount: i128) {
    let admin = soroban_sdk::token::StellarAssetClient::new(env, token);
    admin.mint(user, &amount);
}

/// Create a 1-hour pool with a known creator and return `(pool_id, creator)`.
fn make_pool_bm(t: &BmEnv) -> (u32, Address) {
    let creator = Address::generate(&t.env);
    let pool_id = t.client.create_pool(
        &creator,
        &String::from_str(&t.env, "Bet Management Pool"),
        &String::from_str(&t.env, "cancel / extend test"),
        &String::from_str(&t.env, "Yes"),
        &String::from_str(&t.env, "No"),
        &3_600u64,
        &MIN_CREATOR_DEPOSIT,
    );
    (pool_id, creator)
}

/// Find the most recent `bet_cancelled` event and decode its payload.
fn last_bet_cancelled(env: &Env) -> (u32, Address, BetCancelledEvent) {
    let events = env.events().all();
    for event in events.events().iter().rev() {
        let topic0: Symbol =
            soroban_sdk::TryFromVal::try_from_val(env, &xdr_topic_val(env, event, 0)).unwrap();
        if topic0 == Symbol::new(env, "bet_cancelled") {
            let pool_id: u32 =
                soroban_sdk::TryFromVal::try_from_val(env, &xdr_topic_val(env, event, 2)).unwrap();
            let user: Address =
                soroban_sdk::TryFromVal::try_from_val(env, &xdr_topic_val(env, event, 3)).unwrap();
            let payload: BetCancelledEvent =
                soroban_sdk::TryFromVal::try_from_val(env, &xdr_data_val(env, event)).unwrap();
            return (pool_id, user, payload);
        }
    }
    panic!("no bet_cancelled event emitted");
}

// ── Suite C — cancel_bet ────────────────────────────────────────────────────

/// C1: Partial cancellation refunds the cancelled amount, reduces the outcome
/// total and the user's position, and leaves participant_count unchanged.
#[test]
fn c1_partial_cancellation_updates_totals_and_refunds() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    t.client
        .place_bet(&user, &pool_id, &0u32, &600i128, &None::<Address>);
    assert_eq!(token_client.balance(&user), 400, "stake escrowed on bet");

    // Cancel 200 of the 600 staked on outcome A.
    let refund = t.client.cancel_bet(&user, &pool_id, &0u32, &200i128);
    assert_eq!(refund, 200, "cancel_bet returns the refunded amount");

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(
        pool.total_a, 400,
        "outcome total reduced by cancelled amount"
    );
    assert_eq!(pool.total_b, 0);
    assert_eq!(
        pool.participant_count, 1,
        "participant_count unchanged by partial cancellation"
    );

    let bet = t.client.get_user_bet(&pool_id, &user).expect("bet remains");
    assert_eq!(bet.amount_a, 400, "user position reduced");
    assert_eq!(bet.total_bet, 400);

    assert_eq!(
        token_client.balance(&user),
        600,
        "refund returned to the bettor"
    );
}

/// C2: Full cancellation zeroes the user's position but keeps participant_count.
#[test]
fn c2_full_cancellation_keeps_participant_count() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    let token_client = soroban_sdk::token::Client::new(&t.env, &t.token);

    t.client
        .place_bet(&user, &pool_id, &1u32, &500i128, &None::<Address>);

    let refund = t.client.cancel_bet(&user, &pool_id, &1u32, &500i128);
    assert_eq!(refund, 500);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_b, 0, "outcome total fully removed");
    assert_eq!(
        pool.participant_count, 1,
        "participant_count is retained even on full cancellation"
    );

    let bet = t
        .client
        .get_user_bet(&pool_id, &user)
        .expect("record remains");
    assert_eq!(bet.amount_b, 0);
    assert_eq!(bet.total_bet, 0);

    assert_eq!(token_client.balance(&user), 1_000, "entire stake refunded");
}

/// C3: Cancelling only affects the targeted outcome when the user bet on both.
#[test]
fn c3_cancellation_targets_only_chosen_outcome() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);

    t.client
        .place_bet(&user, &pool_id, &0u32, &300i128, &None::<Address>);
    t.client
        .place_bet(&user, &pool_id, &1u32, &200i128, &None::<Address>);

    // Cancel 100 from outcome B only.
    t.client.cancel_bet(&user, &pool_id, &1u32, &100i128);

    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 300, "outcome A untouched");
    assert_eq!(pool.total_b, 100, "outcome B reduced");

    let bet = t.client.get_user_bet(&pool_id, &user).expect("bet remains");
    assert_eq!(bet.amount_a, 300);
    assert_eq!(bet.amount_b, 100);
    assert_eq!(bet.total_bet, 400);
}

/// C4: Cancelling more than the staked amount on the outcome is rejected.
#[test]
fn c4_cannot_cancel_more_than_staked() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &101i128),
        Err(Ok(ContractError::InvalidBetAmount)),
        "cannot cancel more than the staked amount"
    );
    // Cancelling the other (un-bet) outcome must also fail.
    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &1u32, &1i128),
        Err(Ok(ContractError::InvalidBetAmount)),
        "cannot cancel a stake the user never placed"
    );
}

/// C5: Non-positive amounts are rejected.
#[test]
fn c5_non_positive_amount_rejected() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &0i128),
        Err(Ok(ContractError::InvalidBetAmount))
    );
    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &-50i128),
        Err(Ok(ContractError::InvalidBetAmount))
    );
}

/// C6: A user with no bet in the pool cannot cancel.
#[test]
fn c6_no_bet_found_for_non_bettor() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.client.try_cancel_bet(&stranger, &pool_id, &0u32, &10i128),
        Err(Ok(ContractError::NoBetFound))
    );
}

/// C7: Cancellation is rejected once the pool has expired.
#[test]
fn c7_expired_pool_rejects_cancellation() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);

    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &50i128),
        Err(Ok(ContractError::PoolExpired))
    );
}

/// C8: Cancellation is rejected once the pool is no longer Open (settled).
#[test]
fn c8_settled_pool_rejects_cancellation() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &50i128),
        Err(Ok(ContractError::PoolNotOpen))
    );
}

/// C9: After cancellation a non-zero remaining stake must still meet the
/// configured minimum bet; a full cancellation below the minimum is allowed.
#[test]
fn c9_min_bet_rechecked_after_cancellation() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    // Configure a per-pool minimum bet of 100 (admin is the treasury recipient).
    t.client
        .set_pool_bet_limits(&t.admin, &pool_id, &100i128, &0i128);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &300i128, &None::<Address>);

    // Cancelling 250 would leave 50, below the 100 minimum → rejected.
    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &0u32, &250i128),
        Err(Ok(ContractError::InvalidBetAmount)),
        "remaining stake below the min bet must be rejected"
    );

    // Cancelling 150 leaves 150 (>= min) → allowed.
    assert_eq!(t.client.cancel_bet(&user, &pool_id, &0u32, &150i128), 150);
    assert_eq!(t.client.get_pool(&pool_id).unwrap().total_a, 150);

    // Fully cancelling the remaining 150 is allowed even though 0 < min bet.
    assert_eq!(t.client.cancel_bet(&user, &pool_id, &0u32, &150i128), 150);
    assert_eq!(t.client.get_pool(&pool_id).unwrap().total_a, 0);
}

/// C10: Invalid outcome index is rejected.
#[test]
fn c10_invalid_outcome_rejected() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    assert_eq!(
        t.client.try_cancel_bet(&user, &pool_id, &5u32, &10i128),
        Err(Ok(ContractError::InvalidOutcome))
    );
}

/// C11: `bet_cancelled` event carries (user, pool_id, outcome, amount).
#[test]
fn c11_bet_cancelled_event_payload() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &1u32, &400i128, &None::<Address>);

    t.client.cancel_bet(&user, &pool_id, &1u32, &250i128);

    let (topic_pool, topic_user, payload) = last_bet_cancelled(&t.env);
    assert_eq!(topic_pool, pool_id, "pool_id topic must match");
    assert_eq!(topic_user, user, "user topic must match");
    assert_eq!(payload.user, user, "payload user must match");
    assert_eq!(payload.pool_id, pool_id, "payload pool_id must match");
    assert_eq!(payload.outcome, 1, "payload outcome must match");
    assert_eq!(payload.amount, 250, "payload amount must match");
}

/// C12: Cancelling down then settling produces a payout consistent with the
/// reduced totals — i.e. cancellation correctly feeds into settlement math.
#[test]
fn c12_cancellation_feeds_settlement_math() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    let winner = Address::generate(&t.env);
    let loser = Address::generate(&t.env);
    mint(&t.env, &t.token, &winner, 1_000);
    mint(&t.env, &t.token, &loser, 1_000);

    t.client
        .place_bet(&winner, &pool_id, &0u32, &500i128, &None::<Address>);
    t.client
        .place_bet(&loser, &pool_id, &1u32, &500i128, &None::<Address>);

    // Winner trims their exposure from 500 → 300 before resolution.
    t.client.cancel_bet(&winner, &pool_id, &0u32, &200i128);

    let pool = t.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 300);
    assert_eq!(pool.total_b, 500);

    // total = 800, fee = 2% = 16, net = 784. Winner is the only A bettor.
    let total_pool = 800i128;
    let fee = (total_pool * 200) / 10_000; // 16
    let net = total_pool - fee; // 784
    let expected = (300i128 * net) / 300i128; // 784

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    assert_eq!(
        t.client.claim_winnings(&winner, &pool_id),
        expected,
        "payout must reflect the cancelled stake"
    );
}

// ── Suite E — extend_pool_duration ──────────────────────────────────────────

/// E1: The creator can extend an open pool's duration; expiry moves out.
#[test]
fn e1_creator_extends_duration() {
    let t = setup_bm();
    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let (pool_id, creator) = make_pool_bm(&t);

    let original = t.client.get_pool(&pool_id).unwrap().expiry; // 100 + 3600 = 3700
    let new_expiry = t.client.extend_pool_duration(&creator, &pool_id, &1_800u64);

    assert_eq!(
        new_expiry,
        original + 1_800,
        "expiry pushed out by extension"
    );
    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().expiry,
        original + 1_800,
        "stored expiry updated"
    );
}

/// E2: A non-creator cannot extend the duration.
#[test]
fn e2_unauthorized_caller_rejected() {
    let t = setup_bm();
    let (pool_id, _creator) = make_pool_bm(&t);

    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.client
            .try_extend_pool_duration(&stranger, &pool_id, &600u64),
        Err(Ok(ContractError::Unauthorized))
    );
}

/// E3: Extending an already-expired pool is rejected.
#[test]
fn e3_expired_pool_rejected() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    t.env.ledger().with_mut(|li| li.timestamp = 7_200);
    assert_eq!(
        t.client
            .try_extend_pool_duration(&creator, &pool_id, &600u64),
        Err(Ok(ContractError::PoolExpired))
    );
}

/// E4: A zero extension is rejected — duration can only be increased.
#[test]
fn e4_zero_extension_rejected() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    assert_eq!(
        t.client.try_extend_pool_duration(&creator, &pool_id, &0u64),
        Err(Ok(ContractError::DurationTooShort))
    );
}

/// E5: Boundary — extending exactly to MAX_POOL_DURATION_SECS from creation is
/// allowed, but one second more is rejected.
#[test]
fn e5_boundary_at_max_pool_duration() {
    let t = setup_bm();
    t.env.ledger().with_mut(|li| li.timestamp = 0);
    let (pool_id, creator) = make_pool_bm(&t); // created_at = 0, expiry = 3600

    // Extend so total lifetime == MAX exactly.
    let to_max = MAX_POOL_DURATION_SECS - 3_600;
    let new_expiry = t.client.extend_pool_duration(&creator, &pool_id, &to_max);
    assert_eq!(new_expiry, MAX_POOL_DURATION_SECS);

    // Any further extension exceeds the cap.
    assert_eq!(
        t.client.try_extend_pool_duration(&creator, &pool_id, &1u64),
        Err(Ok(ContractError::DurationTooLong))
    );
}

/// E6: Extending beyond the max cap in a single call is rejected.
#[test]
fn e6_extension_beyond_cap_rejected() {
    let t = setup_bm();
    t.env.ledger().with_mut(|li| li.timestamp = 0);
    let (pool_id, creator) = make_pool_bm(&t); // expiry = 3600

    assert_eq!(
        t.client
            .try_extend_pool_duration(&creator, &pool_id, &MAX_POOL_DURATION_SECS),
        Err(Ok(ContractError::DurationTooLong))
    );
}

/// E7: A frozen pool cannot be extended.
#[test]
fn e7_frozen_pool_rejected() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    // Freeze via the freeze admin (creator is allowed to freeze their own pool).
    t.client.set_freeze_admin(&t.admin, &creator);
    t.client.freeze_pool(&creator, &pool_id);

    assert_eq!(
        t.client
            .try_extend_pool_duration(&creator, &pool_id, &600u64),
        Err(Ok(ContractError::PoolNotOpen))
    );
}

/// E7b: A disputed pool cannot be extended.
///
/// A pool can only be disputed after it is settled, so it is already out of the
/// `Open` state — extension must reject it with `PoolNotOpen`.
#[test]
fn e7b_disputed_pool_rejected() {
    let t = setup_bm();
    let (pool_id, creator) = make_pool_bm(&t);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    // Settle, then dispute via the freeze admin (creator is set as admin here).
    t.env.ledger().with_mut(|li| li.timestamp = 7_200);
    t.client.settle_pool(&creator, &pool_id, &0u32);
    t.client.set_freeze_admin(&t.admin, &creator);
    t.client.dispute_pool(&creator, &pool_id);

    assert_eq!(
        t.client
            .try_extend_pool_duration(&creator, &pool_id, &600u64),
        Err(Ok(ContractError::PoolNotOpen))
    );
}

/// E8: `pool_duration_extended` event carries the new expiry.
#[test]
fn e8_duration_extended_event_payload() {
    let t = setup_bm();
    t.env.ledger().with_mut(|li| li.timestamp = 50);
    let (pool_id, creator) = make_pool_bm(&t);

    let new_expiry = t.client.extend_pool_duration(&creator, &pool_id, &900u64);

    let events = t.env.events().all();
    let last = events.events().last().expect("must emit an event");
    let topic0: Symbol =
        soroban_sdk::TryFromVal::try_from_val(&t.env, &xdr_topic_val(&t.env, last, 0)).unwrap();
    let topic_pool: u32 =
        soroban_sdk::TryFromVal::try_from_val(&t.env, &xdr_topic_val(&t.env, last, 2)).unwrap();
    assert_eq!(topic0, Symbol::new(&t.env, "pool_duration_extended"));
    assert_eq!(topic_pool, pool_id);

    let payload: PoolDurationExtendedEvent =
        soroban_sdk::TryFromVal::try_from_val(&t.env, &xdr_data_val(&t.env, last)).unwrap();
    assert_eq!(payload.creator, creator);
    assert_eq!(payload.new_expiry, new_expiry);
}

/// E9: Bets can still be placed up to the extended expiry.
#[test]
fn e9_bets_allowed_until_extended_expiry() {
    let t = setup_bm();
    t.env.ledger().with_mut(|li| li.timestamp = 100);
    let (pool_id, creator) = make_pool_bm(&t); // expiry = 3700

    // Extend to 100 + 3600 + 3600 = 7300.
    t.client.extend_pool_duration(&creator, &pool_id, &3_600u64);

    // Move past the original expiry but before the new one.
    t.env.ledger().with_mut(|li| li.timestamp = 5_000);

    let user = Address::generate(&t.env);
    mint(&t.env, &t.token, &user, 1_000);
    t.client
        .place_bet(&user, &pool_id, &0u32, &100i128, &None::<Address>);

    assert_eq!(
        t.client.get_pool(&pool_id).unwrap().total_a,
        100,
        "bet accepted within the extended window"
    );
}
