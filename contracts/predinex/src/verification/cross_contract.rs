//! # Cross-contract invocation invariants (#1116)
//!
//! Every path that moves value in `predinex` does it by invoking a **separate
//! contract**: the Stellar Asset Contract behind `token::Client`. That boundary
//! is where custody bugs live, because the contract's own bookkeeping and the
//! token ledger are updated by two different programs and only the host
//! guarantees they commit together.
//!
//! These suites verify the properties that must hold across that boundary:
//!
//! 1. **Conservation.** No operation creates or destroys value. Whatever leaves
//!    an actor's balance arrives at the contract, and vice versa.
//! 2. **Custody.** The contract holds at least what it owes.
//! 3. **Atomicity.** A rejected call leaves neither side changed — no state
//!    written without the matching transfer, and no transfer without the state.
//! 4. **Authorisation.** A transfer only happens on behalf of an account that
//!    authorised the invocation.
//!
//! ## Bounds
//!
//! Sequences are bounded at [`MAX_STEPS`] operations over [`ACTOR_COUNT`]
//! actors and at most [`MAX_POOLS`] pools, drawn from a fixed seed set. Amounts
//! are drawn from a bounded range. Properties shown here therefore hold *for
//! that space*, not for all inputs.

extern crate std;

use super::{Harness, Lcg, DEFAULT_DEPOSIT, STARTING_BALANCE};
use soroban_sdk::Address;

/// Actors used by the randomised sequences.
const ACTOR_COUNT: usize = 4;
/// Operations per generated sequence.
const MAX_STEPS: u32 = 24;
/// Pools created per sequence.
const MAX_POOLS: u32 = 3;
/// Seeds explored. Fixed so a failure is reproducible.
const SEEDS: [u64; 6] = [1, 7, 42, 1_337, 99_991, 2_718_281];

/// Total token units held by the contract plus every actor.
///
/// The token is minted only during setup, so this figure must not change once
/// the sequence starts, whatever the contract does internally.
fn circulating(h: &Harness) -> i128 {
    let mut total = h.contract_balance();
    for actor in &h.actors {
        total += h.token.balance(actor);
    }
    total += h.token.balance(&h.admin);
    total
}

/// **Conservation.** Betting and settling move value between accounts without
/// creating or destroying any.
#[test]
fn value_is_conserved_across_the_token_boundary() {
    for seed in SEEDS {
        let h = Harness::new(ACTOR_COUNT);
        let mut rng = Lcg::new(seed);

        let baseline = circulating(&h);
        let creator = h.actors[0].clone();
        let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);

        assert_eq!(
            circulating(&h),
            baseline,
            "seed {seed}: creating a pool changed the circulating supply"
        );

        for step in 0..MAX_STEPS {
            let actor = h.actors[(rng.next() as usize) % ACTOR_COUNT].clone();
            let outcome = (rng.next() % 2) as u32;
            let amount = rng.in_range(1_000, 5_000_000) as i128;

            // Failures are expected and fine; what matters is that a rejected
            // call moves nothing.
            let _ = h
                .client
                .try_place_bet(&actor, &pool_id, &outcome, &amount, &None);

            assert_eq!(
                circulating(&h),
                baseline,
                "seed {seed} step {step}: place_bet changed the circulating supply"
            );
            h.check_invariants(1, "conservation/bet");
        }
    }
}

/// **Atomicity.** A rejected `place_bet` leaves both the token ledger and the
/// pool's bookkeeping exactly as they were.
///
/// This is the property a partial cross-contract write would break: state
/// updated before a transfer that then fails, or the reverse.
#[test]
fn a_rejected_bet_moves_nothing_on_either_side() {
    let h = Harness::new(2);
    let creator = h.actors[0].clone();
    let bettor = h.actors[1].clone();
    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);

    let before_pool = h.client.get_pool(&pool_id).unwrap();
    let before_balance = h.token.balance(&bettor);
    let before_contract = h.contract_balance();

    // Every one of these must be rejected.
    let rejections: std::vec::Vec<(&str, i128, u32)> = std::vec![
        ("zero amount", 0, 0),
        ("negative amount", -1, 0),
        ("outcome out of range", 1_000, 7),
        ("more than the bettor holds", STARTING_BALANCE * 10, 0),
    ];

    for (label, amount, outcome) in rejections {
        let result = h
            .client
            .try_place_bet(&bettor, &pool_id, &outcome, &amount, &None);
        assert!(result.is_err(), "{label}: expected rejection, got success");

        let after_pool = h.client.get_pool(&pool_id).unwrap();
        assert_eq!(
            (
                after_pool.total_a,
                after_pool.total_b,
                after_pool.cumulative_volume
            ),
            (
                before_pool.total_a,
                before_pool.total_b,
                before_pool.cumulative_volume
            ),
            "{label}: pool state changed on a rejected bet"
        );
        assert_eq!(
            h.token.balance(&bettor),
            before_balance,
            "{label}: bettor balance changed on a rejected bet"
        );
        assert_eq!(
            h.contract_balance(),
            before_contract,
            "{label}: contract balance changed on a rejected bet"
        );
    }
}

/// **Custody.** After an arbitrary sequence of bets, the contract holds at
/// least the stake recorded across its pools.
#[test]
fn the_contract_holds_at_least_what_it_records() {
    for seed in SEEDS {
        let h = Harness::new(ACTOR_COUNT);
        let mut rng = Lcg::new(seed);

        let mut pool_count = 0u32;
        for i in 0..MAX_POOLS {
            let creator = h.actors[i as usize % ACTOR_COUNT].clone();
            h.create_pool(&creator, DEFAULT_DEPOSIT);
            pool_count += 1;
        }

        for step in 0..MAX_STEPS {
            let actor = h.actors[(rng.next() as usize) % ACTOR_COUNT].clone();
            let pool_id = (rng.next() % pool_count as u64) as u32;
            let outcome = (rng.next() % 2) as u32;
            let amount = rng.in_range(1_000, 2_000_000) as i128;

            let _ = h
                .client
                .try_place_bet(&actor, &pool_id, &outcome, &amount, &None);

            let mut staked = 0i128;
            for id in 0..pool_count {
                if let Some(pool) = h.client.get_pool(&id) {
                    staked += pool.total_a + pool.total_b;
                }
            }
            assert!(
                h.contract_balance() >= staked,
                "seed {seed} step {step}: contract holds {} but records {staked} staked",
                h.contract_balance()
            );

            h.check_invariants(pool_count, "custody");
        }
    }
}

/// **Debit matches credit.** A successful bet moves exactly the bet amount out
/// of the bettor and into the contract.
///
/// Fees are taken from the amount *inside* the contract, so the bettor's debit
/// is the full amount and the contract's credit matches it; the split into
/// stake and treasury is internal.
#[test]
fn a_successful_bet_debits_exactly_what_the_contract_receives() {
    let h = Harness::new(2);
    let creator = h.actors[0].clone();
    let bettor = h.actors[1].clone();
    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);

    for amount in [1_000i128, 50_000, 1_000_000] {
        let before_bettor = h.token.balance(&bettor);
        let before_contract = h.contract_balance();

        h.client.place_bet(&bettor, &pool_id, &0, &amount, &None);

        let bettor_debit = before_bettor - h.token.balance(&bettor);
        let contract_credit = h.contract_balance() - before_contract;

        assert_eq!(
            bettor_debit, amount,
            "bettor was debited {bettor_debit}, expected {amount}"
        );
        assert_eq!(
            contract_credit, bettor_debit,
            "contract received {contract_credit} but the bettor paid {bettor_debit}"
        );
    }
}

/// **Authorisation.** A bet debits the account that authorised it and no other.
#[test]
fn a_bet_only_debits_its_own_authorizer() {
    let h = Harness::new(3);
    let creator = h.actors[0].clone();
    let bettor = h.actors[1].clone();
    let bystander = h.actors[2].clone();
    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);

    let before_bystander = h.token.balance(&bystander);
    h.client.place_bet(&bettor, &pool_id, &0, &100_000, &None);

    assert_eq!(
        h.token.balance(&bystander),
        before_bystander,
        "an unrelated account was debited by someone else's bet"
    );
}

/// **Custody through the full lifecycle.** Create, bet, settle and claim, with
/// the invariants checked after every transition.
#[test]
fn custody_holds_through_a_full_lifecycle() {
    let h = Harness::new(3);
    let creator = h.actors[0].clone();
    let winner = h.actors[1].clone();
    let loser = h.actors[2].clone();

    let baseline = circulating(&h);
    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.check_invariants(1, "lifecycle/created");

    h.client.place_bet(&winner, &pool_id, &0, &500_000, &None);
    h.check_invariants(1, "lifecycle/bet-a");

    h.client.place_bet(&loser, &pool_id, &1, &300_000, &None);
    h.check_invariants(1, "lifecycle/bet-b");

    h.advance(super::DEFAULT_DURATION + 1);
    h.client.settle_pool(&h.admin, &pool_id, &0);
    h.check_invariants(1, "lifecycle/settled");

    let payout = h.client.claim_winnings(&winner, &pool_id);
    assert!(payout > 0, "the winning side claimed nothing");
    h.check_invariants(1, "lifecycle/claimed");

    assert_eq!(
        circulating(&h),
        baseline,
        "the full lifecycle changed the circulating supply"
    );
}

/// **No double spend across the boundary.** A second claim pays nothing further.
#[test]
fn a_settled_claim_cannot_be_replayed() {
    let h = Harness::new(3);
    let creator = h.actors[0].clone();
    let winner = h.actors[1].clone();
    let loser = h.actors[2].clone();

    let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
    h.client.place_bet(&winner, &pool_id, &0, &400_000, &None);
    h.client.place_bet(&loser, &pool_id, &1, &400_000, &None);

    h.advance(super::DEFAULT_DURATION + 1);
    h.client.settle_pool(&h.admin, &pool_id, &0);

    let first = h.client.claim_winnings(&winner, &pool_id);
    assert!(first > 0);

    let balance_after_first = h.token.balance(&winner);
    let second = h.client.try_claim_winnings(&winner, &pool_id);

    // Either the replay is rejected, or it pays nothing. Both are acceptable;
    // paying twice is not.
    match second {
        Err(_) => {}
        Ok(Ok(amount)) => assert_eq!(amount, 0, "a replayed claim paid out {amount} again"),
        Ok(Err(_)) => {}
    }
    assert_eq!(
        h.token.balance(&winner),
        balance_after_first,
        "a replayed claim moved tokens a second time"
    );
    h.check_invariants(1, "replay");
}

/// **Custody under interleaving.** Bets, settlements and claims in a
/// generated order never break custody.
#[test]
fn custody_holds_under_interleaved_operations() {
    for seed in SEEDS {
        let h = Harness::new(ACTOR_COUNT);
        let mut rng = Lcg::new(seed);

        let creator = h.actors[0].clone();
        let pool_id = h.create_pool(&creator, DEFAULT_DEPOSIT);
        let baseline = circulating(&h);

        for step in 0..MAX_STEPS {
            let actor: Address = h.actors[(rng.next() as usize) % ACTOR_COUNT].clone();

            match rng.next() % 4 {
                0 | 1 => {
                    let amount = rng.in_range(1_000, 1_000_000) as i128;
                    let outcome = (rng.next() % 2) as u32;
                    let _ = h
                        .client
                        .try_place_bet(&actor, &pool_id, &outcome, &amount, &None);
                }
                2 => {
                    // Settling before expiry must fail; after it, succeed once.
                    let _ = h.client.try_settle_pool(&h.admin, &pool_id, &0);
                }
                _ => {
                    let _ = h.client.try_claim_winnings(&actor, &pool_id);
                }
            }

            // Advance sometimes so both the pre- and post-expiry regimes are
            // reached within a sequence.
            if rng.next().is_multiple_of(5) {
                h.advance(super::DEFAULT_DURATION / 2 + 1);
            }

            assert_eq!(
                circulating(&h),
                baseline,
                "seed {seed} step {step}: supply changed"
            );
            h.check_invariants(1, "interleaved");
        }
    }
}
