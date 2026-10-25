//! # Upgrade and migration safety (#1117)
//!
//! `predinex` records a schema version (`DataKey::ContractVersion`) so an
//! upgraded binary can tell whether the persistent state it inherits matches
//! the layout it expects. That version is the hinge of every migration: if it
//! can be lost, forged, or silently disagree with the state actually on chain,
//! a migration either fails to run or runs twice.
//!
//! ## What is verified
//!
//! Rather than a single-path unit test, these suites explore the reachable
//! version-and-state space and assert the properties that must hold at every
//! point in it:
//!
//! 1. **Persistence.** The version survives arbitrary contract activity. No
//!    ordinary operation may clear or rewrite it.
//! 2. **Agreement.** The version reported by `get_config` always matches what
//!    is stored, so a migration guard cannot read a different value from the
//!    one that was written.
//! 3. **Idempotence.** Re-running initialization does not silently reset state
//!    or the version — the property that makes a re-run migration safe.
//! 4. **State compatibility.** Records written before a version read remain
//!    readable and unchanged afterwards, which is what an in-place migration
//!    depends on.
//!
//! ## Bounds
//!
//! Sequences are bounded at [`MAX_STEPS`] operations drawn from a fixed seed
//! set. The version symbol itself is a compile-time constant, so its *value* is
//! checked exhaustively; what is bounded is the state space it is checked
//! against.
//!
//! ## What is out of scope
//!
//! This contract has no `update_current_contract_wasm` entry point, so a real
//! binary swap cannot be driven from a test. These suites verify the state
//! machine an upgrade would rely on, not the deployment mechanics.

extern crate std;

use super::{Harness, Lcg, DEFAULT_DEPOSIT};
use crate::CONTRACT_STATE_VERSION;
use soroban_sdk::{Env, Symbol};

/// Operations per generated sequence.
const MAX_STEPS: u32 = 16;
/// Seeds explored. Fixed so a failure is reproducible.
const SEEDS: [u64; 4] = [3, 17, 5_501, 8_675_309];

/// The version symbol the binary expects to find.
fn expected_version(env: &Env) -> Symbol {
    Symbol::new(env, CONTRACT_STATE_VERSION)
}

/// **Agreement.** Initialization records the version the binary was built with.
#[test]
fn initialization_records_the_binary_version() {
    let h = Harness::new(1);
    let config = h.client.get_config();

    assert_eq!(
        config.contract_state_version,
        expected_version(&h.env),
        "the stored schema version does not match the binary's constant"
    );
}

/// **Persistence.** The version survives an arbitrary sequence of operations.
///
/// This is the property a migration guard depends on. If any ordinary call
/// could clear the version, an upgraded binary would read a default and either
/// skip a required migration or re-run one that had already happened.
#[test]
fn the_version_survives_arbitrary_activity() {
    for seed in SEEDS {
        let h = Harness::new(3);
        let mut rng = Lcg::new(seed);
        let expected = expected_version(&h.env);

        let creator = h.actors[0].clone();
        let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);

        for step in 0..MAX_STEPS {
            let actor = h.actors[(rng.next() as usize) % 3].clone();

            match rng.next() % 5 {
                0 | 1 => {
                    let amount = rng.in_range(1_000, 500_000) as i128;
                    let outcome = (rng.next() % 2) as u32;
                    let _ = h
                        .client
                        .try_place_bet(&actor, &pool_id, &outcome, &amount, &None);
                }
                2 => {
                    let _ = h.client.try_settle_pool(&h.admin, &pool_id, &0);
                }
                3 => {
                    let _ = h.client.try_claim_winnings(&actor, &pool_id);
                }
                _ => {
                    h.advance(rng.in_range(60, 7_200));
                }
            }

            assert_eq!(
                h.client.get_config().contract_state_version,
                expected,
                "seed {seed} step {step}: the schema version changed under ordinary activity"
            );
        }
    }
}

/// **Persistence under pause.** Pausing and unpausing does not disturb the
/// version, so an operator can quiesce the contract before an upgrade.
#[test]
fn pausing_does_not_disturb_the_version() {
    let h = Harness::new(1);
    let expected = expected_version(&h.env);

    h.client.set_paused(&h.admin, &true);
    assert_eq!(
        h.client.get_config().contract_state_version,
        expected,
        "pausing changed the schema version"
    );

    h.client.set_paused(&h.admin, &false);
    assert_eq!(
        h.client.get_config().contract_state_version,
        expected,
        "unpausing changed the schema version"
    );
}

/// **Idempotence.** A second `initialize` is rejected and changes nothing.
///
/// An upgraded binary that re-ran initialization would otherwise reset the
/// admin and treasury, handing control to whoever made the call.
#[test]
fn initialization_cannot_be_replayed() {
    let h = Harness::new(1);
    let before = h.client.get_config();

    let attacker = h.funded_actor(1_000);
    let result = h.client.try_initialize(&attacker, &attacker, &attacker);

    assert!(result.is_err(), "initialize was accepted a second time");

    let after = h.client.get_config();
    assert_eq!(
        after.contract_state_version, before.contract_state_version,
        "a rejected re-initialization changed the schema version"
    );
    assert_eq!(
        h.client.get_admin(),
        Some(h.admin.clone()),
        "a rejected re-initialization changed the admin"
    );
}

/// **State compatibility.** Records written before a version read are still
/// readable, and unchanged, afterwards.
///
/// An in-place migration reads the version, then walks existing records. If
/// reading the version could disturb them, that walk would see altered state.
#[test]
fn reading_the_version_does_not_disturb_existing_state() {
    let h = Harness::new(2);
    let creator = h.actors[0].clone();
    let bettor = h.actors[1].clone();

    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client.place_bet(&bettor, &pool_id, &0, &250_000, &None);

    let pool_before = h.client.get_pool(&pool_id).unwrap();
    let bet_before = h.client.get_user_bet(&pool_id, &bettor).unwrap();

    // Read the version several times, as a migration guard would.
    for _ in 0..5 {
        let _ = h.client.get_config().contract_state_version;
    }

    let pool_after = h.client.get_pool(&pool_id).unwrap();
    let bet_after = h.client.get_user_bet(&pool_id, &bettor).unwrap();

    assert_eq!(
        (
            pool_before.total_a,
            pool_before.total_b,
            pool_before.cumulative_volume
        ),
        (
            pool_after.total_a,
            pool_after.total_b,
            pool_after.cumulative_volume
        ),
        "reading the schema version changed pool state"
    );
    assert_eq!(
        (
            bet_before.amount_a,
            bet_before.amount_b,
            bet_before.total_bet
        ),
        (bet_after.amount_a, bet_after.amount_b, bet_after.total_bet),
        "reading the schema version changed a user bet"
    );
}

/// **Records outlive the version read.** Pools created before the version is
/// consulted remain fully readable, which is what makes a migration able to
/// enumerate pre-upgrade state.
#[test]
fn pre_existing_records_remain_readable_across_a_version_check() {
    let h = Harness::new(2);
    let creator = h.actors[0].clone();
    let bettor = h.actors[1].clone();

    let mut ids = std::vec::Vec::new();
    for _ in 0..3 {
        let id = h.create_pool(&creator, DEFAULT_DEPOSIT);
        h.client.place_bet(&bettor, &id, &0, &100_000, &None);
        ids.push(id);
    }

    let expected = expected_version(&h.env);
    assert_eq!(h.client.get_config().contract_state_version, expected);

    for id in ids {
        let pool = h
            .client
            .get_pool(&id)
            .unwrap_or_else(|| panic!("pool {id} became unreadable after a version check"));
        assert!(
            pool.total_a > 0,
            "pool {id} lost its stake across a version check"
        );
        assert!(
            h.client.get_user_bet(&id, &bettor).is_some(),
            "the bet on pool {id} became unreadable after a version check"
        );
    }
}

/// **Version stability across settlement.** Settlement is the most
/// state-mutating transition; it must not disturb the version either.
#[test]
fn settlement_does_not_disturb_the_version() {
    let h = Harness::new(3);
    let creator = h.actors[0].clone();
    let winner = h.actors[1].clone();
    let loser = h.actors[2].clone();
    let expected = expected_version(&h.env);

    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client.place_bet(&winner, &pool_id, &0, &300_000, &None);
    h.client.place_bet(&loser, &pool_id, &1, &200_000, &None);

    h.advance(super::DEFAULT_DURATION + 1);
    h.client.settle_pool(&h.admin, &pool_id, &0);
    assert_eq!(
        h.client.get_config().contract_state_version,
        expected,
        "settlement changed the schema version"
    );

    h.client.claim_winnings(&winner, &pool_id);
    assert_eq!(
        h.client.get_config().contract_state_version,
        expected,
        "claiming changed the schema version"
    );
}
