//! Unit tests for the unified event emission module.

#![cfg(test)]

use crate::events::*;
use soroban_sdk::{testutils::Events, Env, String as SorobanString, Symbol};

#[test]
fn test_event_version_constant() {
    let env = Env::default();
    let version = event_version(&env);
    assert_eq!(version, Symbol::new(&env, "v1"));
}

#[test]
fn test_create_pool_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let creator = soroban_sdk::Address::generate(&env);
    let pool_id = 1u32;

    CreatePoolEvent::emit(
        &env,
        pool_id,
        CreatePoolEvent {
            creator: creator.clone(),
            expiry: 1000,
            title: SorobanString::from_str(&env, "Test Market"),
            outcome_a_name: SorobanString::from_str(&env, "Yes"),
            outcome_b_name: SorobanString::from_str(&env, "No"),
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 3);

    // Verify topic structure: (event_name, version, pool_id)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "create_pool"));

    let version: Symbol = topics.get(1).unwrap().try_into().unwrap();
    assert_eq!(version, Symbol::new(&env, "v1"));

    let emitted_pool_id: u32 = topics.get(2).unwrap().try_into().unwrap();
    assert_eq!(emitted_pool_id, pool_id);
}

#[test]
fn test_bet_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let user = soroban_sdk::Address::generate(&env);
    let pool_id = 5u32;

    BetEvent::emit(
        &env,
        &user,
        pool_id,
        BetEvent {
            outcome: 1,
            amount: 100_000_000,
            total_yes: 200_000_000,
            total_no: 150_000_000,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 4);

    // Verify topic structure: (event_name, version, user, pool_id)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "place_bet"));

    let version: Symbol = topics.get(1).unwrap().try_into().unwrap();
    assert_eq!(version, Symbol::new(&env, "v1"));
}

#[test]
fn test_claim_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let claimant = soroban_sdk::Address::generate(&env);
    let pool_id = 10u32;

    ClaimEvent::emit(
        &env,
        pool_id,
        &claimant,
        ClaimEvent {
            amount: 500_000_000,
            fee_amount: 10_000_000,
            winning_outcome: 0,
            total_pool_size: 1_000_000_000,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 4);

    // Verify topic structure: (event_name, version, pool_id, claimant)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "claim_winnings"));

    let emitted_pool_id: u32 = topics.get(2).unwrap().try_into().unwrap();
    assert_eq!(emitted_pool_id, pool_id);
}

#[test]
fn test_settle_pool_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let caller = soroban_sdk::Address::generate(&env);
    let pool_id = 7u32;

    SettlePoolEvent::emit(
        &env,
        pool_id,
        SettlePoolEvent {
            caller: caller.clone(),
            winning_outcome: 1,
            winning_side_total: 300_000_000,
            total_pool_volume: 500_000_000,
            fee_amount: 10_000_000,
            source: SettlementSource::Creator,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 3);

    // Verify topic structure: (event_name, version, pool_id)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "settle_pool"));
}

#[test]
fn test_referral_bet_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let referrer = soroban_sdk::Address::generate(&env);
    let pool_id = 3u32;

    ReferralBetEvent::emit(
        &env,
        ReferralBetEvent {
            referrer: referrer.clone(),
            pool_id,
            outcome: 0,
            amount: 50_000_000,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 4);

    // Verify topic structure: (event_name, version, referrer, pool_id)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "referral_bet"));
}

#[test]
fn test_fee_config_updated_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let fee_recipient = soroban_sdk::Address::generate(&env);

    FeeConfigUpdatedEvent::emit(
        &env,
        FeeConfigUpdatedEvent {
            fee_rate: 250,
            fee_recipient: fee_recipient.clone(),
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 2);

    // Verify topic structure: (event_name, version)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "fee_config_updated"));
}

#[test]
fn test_pool_cancelled_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let cancelled_by = soroban_sdk::Address::generate(&env);
    let pool_id = 12u32;

    PoolCancelledEvent::emit(
        &env,
        pool_id,
        PoolCancelledEvent {
            cancelled_by: cancelled_by.clone(),
            reason: SorobanString::from_str(&env, "Market outcome unclear"),
            total_refunded: 250_000_000,
            participant_count: 15,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 3);

    // Verify topic structure: (event_name, version, pool_id)
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "cancel_pool"));
}

#[test]
fn test_multiple_events_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let user = soroban_sdk::Address::generate(&env);
    let pool_id = 20u32;

    // Emit bet event
    BetEvent::emit(
        &env,
        &user,
        pool_id,
        BetEvent {
            outcome: 0,
            amount: 100_000_000,
            total_yes: 100_000_000,
            total_no: 0,
        },
    );

    // Emit referral event
    ReferralBetEvent::emit(
        &env,
        ReferralBetEvent {
            referrer: user.clone(),
            pool_id,
            outcome: 0,
            amount: 100_000_000,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 2);

    // Verify both events have correct version
    for event in events.iter() {
        let (topics, _): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &event;
        let version: Symbol = topics.get(1).unwrap().try_into().unwrap();
        assert_eq!(version, Symbol::new(&env, "v1"));
    }
}

#[test]
fn test_settlement_source_enum() {
    // Verify enum values for SettlementSource
    assert_eq!(SettlementSource::Creator as u32, 0);
    assert_eq!(SettlementSource::Operator as u32, 1);
}

#[test]
fn test_bet_cancelled_event_with_user_address() {
    let env = Env::default();
    env.mock_all_auths();

    let user = soroban_sdk::Address::generate(&env);
    let pool_id = 8u32;

    BetCancelledEvent::emit(
        &env,
        BetCancelledEvent {
            user: user.clone(),
            pool_id,
            outcome: 1,
            amount: 50_000_000,
        },
    );

    let events = env.events().all();
    assert_eq!(events.len(), 1);

    let (topics, _data): &(soroban_sdk::Vec<soroban_sdk::Val>, _) = &events[0];
    assert_eq!(topics.len(), 4);

    // Verify user address is in topics
    let event_name: Symbol = topics.get(0).unwrap().try_into().unwrap();
    assert_eq!(event_name, Symbol::new(&env, "bet_cancelled"));
}
