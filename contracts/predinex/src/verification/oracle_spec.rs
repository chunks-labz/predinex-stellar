//! # Settlement authority specifications (#1118)
//!
//! A prediction market has to learn how the world turned out. `predinex` has no
//! external price feed; the role an oracle plays elsewhere is filled here by the
//! **settlement authority** — the admin, the pool creator, or an operator the
//! creator delegates via `assign_settler`. Whoever holds that role decides which
//! outcome pays, so its specification is the oracle specification for this
//! protocol.
//!
//! ## Properties
//!
//! 1. **Authority.** Only the admin, creator, or delegated settler can settle.
//!    No other account can, under any sequence.
//! 2. **Attribution.** Every settlement records which of those roles acted, so
//!    a disputed resolution can be traced to a principal.
//! 3. **Finality.** A settled pool cannot be re-settled, and its recorded
//!    outcome never changes afterwards.
//! 4. **Range.** The winning outcome is always within the pool's declared
//!    outcome set — an out-of-range index would make payouts unreachable.
//! 5. **Timeliness.** A pool cannot be resolved before its expiry.
//! 6. **Quorum.** A pool below the configured participant minimum cannot be
//!    settled, which is what stops a thin market being resolved unfairly.
//!
//! ## Bounds
//!
//! Unauthorised-caller checks are exhaustive over the role space the harness can
//! construct (admin, creator, delegate, and unrelated accounts). Outcome-range
//! checks are exhaustive over a bounded index range. Sequence-driven suites are
//! bounded at [`MAX_STEPS`] over a fixed seed set.

extern crate std;

use super::{Harness, Lcg, DEFAULT_DEPOSIT, DEFAULT_DURATION};
use crate::SettlementSource;

/// Operations per generated sequence.
const MAX_STEPS: u32 = 12;
/// Seeds explored. Fixed so a failure is reproducible.
const SEEDS: [u64; 4] = [11, 23, 4_099, 777_777];
/// Outcome indices probed when checking the valid range.
const OUTCOME_PROBE_LIMIT: u32 = 8;

/// A pool past its expiry, with a bet on each side so it meets any quorum.
fn expired_pool(h: &Harness) -> u32 {
    let creator = h.actors[0].clone();
    let a = h.actors[1].clone();
    let b = h.actors[2].clone();

    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client.place_bet(&a, &pool_id, &0, &300_000, &None);
    h.client.place_bet(&b, &pool_id, &1, &200_000, &None);
    h.advance(DEFAULT_DURATION + 1);
    pool_id
}

/// **Authority.** An account that is neither admin, creator, nor delegate
/// cannot settle.
#[test]
fn only_an_authorized_role_can_settle() {
    let h = Harness::new(4);
    let pool_id = expired_pool(&h);

    // Several distinct unrelated accounts, including one that has bet into the
    // pool: participating confers no settlement authority.
    let outsiders = std::vec![
        h.funded_actor(1_000_000),
        h.funded_actor(1_000_000),
        h.actors[1].clone(),
        h.actors[3].clone(),
    ];

    for (i, outsider) in outsiders.iter().enumerate() {
        let result = h.client.try_settle_pool(outsider, &pool_id, &0);
        assert!(
            result.is_err(),
            "outsider {i} settled a pool it has no authority over"
        );
        assert!(
            !h.client.get_pool(&pool_id).unwrap().settled,
            "outsider {i} left the pool settled"
        );
    }

    // The admin, by contrast, can.
    h.client.settle_pool(&h.admin, &pool_id, &0);
    assert!(h.client.get_pool(&pool_id).unwrap().settled);
}

/// **Authority.** The pool creator can settle its own pool.
#[test]
fn the_creator_can_settle_its_own_pool() {
    let h = Harness::new(4);
    let creator = h.actors[0].clone();
    let pool_id = expired_pool(&h);

    h.client.settle_pool(&creator, &pool_id, &1);

    let pool = h.client.get_pool(&pool_id).unwrap();
    assert!(pool.settled);
    assert_eq!(pool.winning_outcome, Some(1));
}

/// **Authority.** A delegated settler can settle, and only for the pool it was
/// delegated on.
#[test]
fn delegation_grants_authority_for_one_pool_only() {
    let h = Harness::new(4);
    let creator = h.actors[0].clone();

    let delegated = expired_pool(&h);
    let other = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client
        .place_bet(&h.actors[1].clone(), &other, &0, &200_000, &None);
    h.client
        .place_bet(&h.actors[2].clone(), &other, &1, &200_000, &None);
    h.advance(DEFAULT_DURATION + 1);

    let operator = h.funded_actor(1_000);
    h.client.assign_settler(&creator, &delegated, &operator);

    // Authorised on the pool it was assigned to.
    h.client.settle_pool(&operator, &delegated, &0);
    assert!(h.client.get_pool(&delegated).unwrap().settled);

    // Not on any other.
    let result = h.client.try_settle_pool(&operator, &other, &0);
    assert!(
        result.is_err(),
        "a delegate settled a pool it was not assigned to"
    );
    assert!(!h.client.get_pool(&other).unwrap().settled);
}

/// **Attribution.** Every settlement records the role that performed it.
///
/// Without this, a disputed resolution cannot be traced to a principal.
#[test]
fn every_settlement_records_its_source() {
    // Admin.
    let h = Harness::new(4);
    let pool_id = expired_pool(&h);
    h.client.settle_pool(&h.admin, &pool_id, &0);
    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        Some(SettlementSource::Admin),
        "an admin settlement was not attributed to the admin"
    );

    // Creator.
    let h = Harness::new(4);
    let creator = h.actors[0].clone();
    let pool_id = expired_pool(&h);
    h.client.settle_pool(&creator, &pool_id, &0);
    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        Some(SettlementSource::Creator),
        "a creator settlement was not attributed to the creator"
    );

    // Delegated operator.
    let h = Harness::new(4);
    let creator = h.actors[0].clone();
    let pool_id = expired_pool(&h);
    let operator = h.funded_actor(1_000);
    h.client.assign_settler(&creator, &pool_id, &operator);
    h.client.settle_pool(&operator, &pool_id, &0);
    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        Some(SettlementSource::Operator),
        "a delegated settlement was not attributed to an operator"
    );
}

/// **Attribution.** An unsettled pool has no recorded source.
#[test]
fn an_unsettled_pool_has_no_source() {
    let h = Harness::new(4);
    let pool_id = expired_pool(&h);

    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        None,
        "an unsettled pool already names a settlement source"
    );
}

/// **Finality.** A settled pool cannot be re-settled, and its outcome is fixed.
#[test]
fn a_settled_outcome_is_final() {
    let h = Harness::new(4);
    let creator = h.actors[0].clone();
    let pool_id = expired_pool(&h);

    h.client.settle_pool(&h.admin, &pool_id, &0);
    let settled = h.client.get_pool(&pool_id).unwrap();
    assert_eq!(settled.winning_outcome, Some(0));

    // Neither the admin, the creator, nor a delegate may overturn it.
    let operator = h.funded_actor(1_000);
    let _ = h.client.try_assign_settler(&creator, &pool_id, &operator);

    for (label, caller) in std::vec![
        ("admin", h.admin.clone()),
        ("creator", creator.clone()),
        ("operator", operator.clone()),
    ] {
        let result = h.client.try_settle_pool(&caller, &pool_id, &1);
        assert!(result.is_err(), "{label} re-settled a finalized pool");

        let pool = h.client.get_pool(&pool_id).unwrap();
        assert_eq!(
            pool.winning_outcome,
            Some(0),
            "{label} changed the recorded outcome after settlement"
        );
    }

    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        Some(SettlementSource::Admin),
        "the attribution changed after a rejected re-settlement"
    );
}

/// **Range.** Only outcome indices inside the pool's declared set are accepted.
///
/// An out-of-range winner would make every payout path unreachable, stranding
/// the pool's funds.
#[test]
fn the_winning_outcome_must_be_in_range() {
    // A binary pool declares outcomes 0 and 1.
    for outcome in 2..OUTCOME_PROBE_LIMIT {
        let h = Harness::new(4);
        let pool_id = expired_pool(&h);

        let result = h.client.try_settle_pool(&h.admin, &pool_id, &outcome);
        assert!(
            result.is_err(),
            "outcome {outcome} was accepted on a two-outcome pool"
        );
        assert!(
            !h.client.get_pool(&pool_id).unwrap().settled,
            "a rejected outcome left the pool settled"
        );
    }

    // Both declared outcomes are accepted.
    for outcome in 0..2u32 {
        let h = Harness::new(4);
        let pool_id = expired_pool(&h);
        h.client.settle_pool(&h.admin, &pool_id, &outcome);
        assert_eq!(
            h.client.get_pool(&pool_id).unwrap().winning_outcome,
            Some(outcome),
            "declared outcome {outcome} was not recorded"
        );
    }
}

/// **Timeliness.** A pool cannot be resolved before it expires.
#[test]
fn a_pool_cannot_be_settled_before_expiry() {
    let h = Harness::new(4);
    let creator = h.actors[0].clone();
    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client
        .place_bet(&h.actors[1].clone(), &pool_id, &0, &300_000, &None);
    h.client
        .place_bet(&h.actors[2].clone(), &pool_id, &1, &200_000, &None);

    // Probe several points strictly inside the window.
    for fraction in [0u64, 1, 2, 3] {
        let result = h.client.try_settle_pool(&h.admin, &pool_id, &0);
        assert!(
            result.is_err(),
            "the pool was settled before expiry (step {fraction})"
        );
        assert!(!h.client.get_pool(&pool_id).unwrap().settled);
        h.advance(DEFAULT_DURATION / 8);
    }

    // Past expiry it succeeds.
    h.advance(DEFAULT_DURATION);
    h.client.settle_pool(&h.admin, &pool_id, &0);
    assert!(h.client.get_pool(&pool_id).unwrap().settled);
}

/// **Quorum.** A pool below the configured participant minimum cannot be
/// settled.
#[test]
fn a_thin_market_cannot_be_settled() {
    let h = Harness::new(4);
    let creator = h.actors[0].clone();

    // Require more participants than the pool will have.
    h.client.set_min_settlement_participants(&h.admin, &3);

    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client
        .place_bet(&h.actors[1].clone(), &pool_id, &0, &300_000, &None);
    h.advance(DEFAULT_DURATION + 1);

    let result = h.client.try_settle_pool(&h.admin, &pool_id, &0);
    assert!(
        result.is_err(),
        "a pool below the participant minimum was settled"
    );

    // Once enough distinct participants have bet, it settles.
    let pool_id2 = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client
        .place_bet(&h.actors[1].clone(), &pool_id2, &0, &100_000, &None);
    h.client
        .place_bet(&h.actors[2].clone(), &pool_id2, &1, &100_000, &None);
    h.client
        .place_bet(&h.actors[3].clone(), &pool_id2, &0, &100_000, &None);
    h.advance(DEFAULT_DURATION + 1);

    h.client.settle_pool(&h.admin, &pool_id2, &0);
    assert!(h.client.get_pool(&pool_id2).unwrap().settled);
}

/// **Authority under interleaving.** No generated sequence of unauthorised
/// calls ever settles a pool, and an authorised one settles it exactly once.
#[test]
fn authority_holds_under_interleaved_attempts() {
    for seed in SEEDS {
        let h = Harness::new(4);
        let mut rng = Lcg::new(seed);
        let pool_id = expired_pool(&h);

        let outsiders = std::vec![h.funded_actor(1_000), h.funded_actor(1_000)];
        let mut settled_by_outsider = false;

        for _ in 0..MAX_STEPS {
            let outsider = &outsiders[(rng.next() as usize) % outsiders.len()];
            let outcome = (rng.next() % 4) as u32;
            let _ = h.client.try_settle_pool(outsider, &pool_id, &outcome);

            if h.client.get_pool(&pool_id).unwrap().settled {
                settled_by_outsider = true;
                break;
            }
        }

        assert!(
            !settled_by_outsider,
            "seed {seed}: an unauthorized caller settled the pool"
        );

        // The admin can still settle, exactly once.
        h.client.settle_pool(&h.admin, &pool_id, &0);
        assert!(h.client.get_pool(&pool_id).unwrap().settled);
        assert!(
            h.client.try_settle_pool(&h.admin, &pool_id, &1).is_err(),
            "seed {seed}: the pool was settled twice"
        );
        h.check_invariants(1, "oracle/interleaved");
    }
}

/// **Attribution survives claims.** Settling then claiming leaves both the
/// recorded outcome and its source untouched.
#[test]
fn attribution_survives_the_claim_phase() {
    let h = Harness::new(4);
    let winner = h.actors[1].clone();
    let pool_id = expired_pool(&h);

    h.client.settle_pool(&h.admin, &pool_id, &0);
    let outcome_before = h.client.get_pool(&pool_id).unwrap().winning_outcome;
    let source_before = h.client.get_settlement_source(&pool_id);

    h.client.claim_winnings(&winner, &pool_id);

    assert_eq!(
        h.client.get_pool(&pool_id).unwrap().winning_outcome,
        outcome_before,
        "claiming changed the recorded outcome"
    );
    assert_eq!(
        h.client.get_settlement_source(&pool_id),
        source_before,
        "claiming changed the settlement attribution"
    );
}
