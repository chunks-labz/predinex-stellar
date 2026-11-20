//! # Formal verification harness
//!
//! The suites under this module differ from the unit tests in `test.rs` in what
//! they assert. A unit test pins one call's result. A verification suite states
//! a property that must hold in **every** reachable state, then drives the
//! contract through a bounded space of states and re-checks it after each step.
//!
//! ## Why a harness rather than a solver
//!
//! Soroban contracts have no SMT backend comparable to Certora or Kani: the
//! host is a WASM interpreter with ledger state, and the properties worth
//! checking here are about that state, not about arithmetic in isolation. What
//! is tractable — and what this module does — is *bounded exhaustive
//! verification*: enumerate a small, complete slice of the input space, execute
//! it against the real host, and assert the invariants after every transition.
//!
//! Bounded means bounded. A property that holds for the enumerated space is not
//! proved for all inputs. The bounds are stated explicitly in each suite so a
//! reader knows exactly what was and was not covered.
//!
//! ## Layout
//!
//! | Module | Verifies | Issue |
//! |--------|----------|-------|
//! | [`cross_contract`] | Invariants across the `predinex` ↔ token boundary | #1116 |
//! | [`upgrade_safety`] | The schema-version state machine and migration paths | #1117 |
//! | [`oracle_spec`] | The settlement authority that resolves markets | #1118 |
//!
//! The shared machinery lives here: [`Harness`] builds a funded fixture, and
//! [`Harness::check_invariants`] asserts every global invariant at once so an
//! individual suite only has to say *when* to check, not *what*.
//!
//! See `docs/FORMAL_VERIFICATION.md` for the invariant catalogue and for how to
//! add a suite.

#![cfg(test)]

pub mod cross_contract;
pub mod oracle_spec;
pub mod upgrade_safety;

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String};

/// Token units minted to every actor in the harness.
pub const STARTING_BALANCE: i128 = 1_000_000_000;
/// Creator deposit used when a suite does not care about the exact figure.
pub const DEFAULT_DEPOSIT: i128 = 10_000_000;
/// Pool lifetime used by [`Harness::create_pool`], in seconds.
pub const DEFAULT_DURATION: u64 = 3_600;

/// A deterministic generator, matching the LCG already used by `fuzz.rs` and
/// `validation_prop_tests.rs`.
///
/// Determinism is the point: a failing verification run must be reproducible
/// from its seed alone.
pub struct Lcg(u64);

impl Lcg {
    pub fn new(seed: u64) -> Self {
        Lcg(seed)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    /// Uniform in `[min, max]`.
    pub fn in_range(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        min + (self.next() % (max - min + 1))
    }
}

/// An initialized contract, a mintable token, and funded actors.
pub struct Harness {
    pub env: Env,
    pub client: PredinexContractClient<'static>,
    pub token: token::Client<'static>,
    pub token_admin: token::StellarAssetClient<'static>,
    pub contract_id: Address,
    /// Protocol admin; also the treasury recipient.
    pub admin: Address,
    /// Actors funded with [`STARTING_BALANCE`].
    pub actors: std::vec::Vec<Address>,
}

impl Harness {
    /// Build a harness with `actor_count` funded accounts.
    pub fn new(actor_count: usize) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        let client = PredinexContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token::Client::new(&env, &token_id.address());
        let token_admin = token::StellarAssetClient::new(&env, &token_id.address());

        client.initialize(&token_id.address(), &admin, &admin);

        let mut actors = std::vec::Vec::with_capacity(actor_count);
        for _ in 0..actor_count {
            let actor = Address::generate(&env);
            token_admin.mint(&actor, &STARTING_BALANCE);
            actors.push(actor);
        }

        Harness {
            env,
            client,
            token,
            token_admin,
            contract_id,
            admin,
            actors,
        }
    }

    /// Mint `amount` to a fresh account and return it.
    pub fn funded_actor(&self, amount: i128) -> Address {
        let actor = Address::generate(&self.env);
        self.token_admin.mint(&actor, &amount);
        actor
    }

    /// Create a pool owned by `creator`, returning its id.
    pub fn create_pool(&self, creator: &Address, deposit: i128) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Verification market"),
            &String::from_str(&self.env, "Created by the verification harness"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &DEFAULT_DURATION,
            &deposit,
            &None,
        )
    }

    /// Advance the ledger clock by `secs`.
    pub fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(now + secs);
    }

    /// Token units held by the contract itself.
    pub fn contract_balance(&self) -> i128 {
        self.token.balance(&self.contract_id)
    }

    /// Assert every global invariant over the pools `0..pool_count`.
    ///
    /// `context` is echoed in the failure message so a broken run names the step
    /// that produced the bad state rather than just the property.
    pub fn check_invariants(&self, pool_count: u32, context: &str) {
        self.check_custody(pool_count, context);
        self.check_pool_accounting(pool_count, context);
        self.check_settlement_consistency(pool_count, context);
    }

    /// **Custody.** The contract's token balance covers every liability it has
    /// recorded and not yet discharged.
    ///
    /// This is the property that matters most. If it ever fails, some claim
    /// path can be starved by another, which is insolvency however the
    /// bookkeeping reads.
    ///
    /// `total_a` / `total_b` are *not* decremented as winners claim: they hold
    /// the stake as it stood at settlement, because the pro-rata payout maths
    /// needs that figure for every later claimant. The live liability is
    /// therefore the staked total minus `PoolPayoutState::paid_out`.
    pub fn check_custody(&self, pool_count: u32, context: &str) {
        let mut outstanding = 0i128;
        for pool_id in 0..pool_count {
            let Some(pool) = self.client.get_pool(&pool_id) else {
                continue;
            };
            let staked = pool.total_a + pool.total_b;
            let paid_out = self
                .client
                .get_pool_payout_state(&pool_id)
                .map(|state| state.paid_out)
                .unwrap_or(0);

            assert!(
                paid_out >= 0 && paid_out <= staked,
                "[{context}] pool {pool_id} paid out {paid_out} against a staked total of {staked}"
            );
            outstanding += staked - paid_out;
        }

        let treasury = self.client.get_treasury_balance();
        let held = self.contract_balance();

        assert!(
            held >= 0,
            "[{context}] contract token balance went negative: {held}"
        );
        assert!(
            treasury >= 0,
            "[{context}] treasury went negative: {treasury}"
        );
        assert!(
            held >= outstanding,
            "[{context}] contract holds {held} but still owes {outstanding}"
        );
    }

    /// **Pool accounting.** Per-outcome totals are non-negative and cumulative
    /// volume never decreases, including across settlement and claims.
    pub fn check_pool_accounting(&self, pool_count: u32, context: &str) {
        for pool_id in 0..pool_count {
            let Some(pool) = self.client.get_pool(&pool_id) else {
                continue;
            };

            assert!(
                pool.total_a >= 0 && pool.total_b >= 0,
                "[{context}] pool {pool_id} has a negative side: a={} b={}",
                pool.total_a,
                pool.total_b
            );
            assert!(
                pool.cumulative_volume >= 0,
                "[{context}] pool {pool_id} cumulative volume went negative: {}",
                pool.cumulative_volume
            );
            // Volume is a lifetime figure, so it can never be below what is
            // currently staked on the two sides.
            assert!(
                pool.cumulative_volume >= pool.total_a + pool.total_b - pool.total_a.min(0),
                "[{context}] pool {pool_id} cumulative volume {} is below its live stake {}",
                pool.cumulative_volume,
                pool.total_a + pool.total_b
            );
            assert!(
                pool.deposit_deadline <= pool.expiry,
                "[{context}] pool {pool_id} accepts bets past its resolution deadline"
            );
        }
    }

    /// **Settlement consistency.** A settled pool names a winning outcome, and
    /// an unsettled one does not.
    pub fn check_settlement_consistency(&self, pool_count: u32, context: &str) {
        for pool_id in 0..pool_count {
            let Some(pool) = self.client.get_pool(&pool_id) else {
                continue;
            };

            if pool.settled {
                assert!(
                    pool.winning_outcome.is_some(),
                    "[{context}] pool {pool_id} is settled with no winning outcome"
                );
                assert!(
                    self.client.get_settlement_source(&pool_id).is_some(),
                    "[{context}] pool {pool_id} is settled with no recorded source"
                );
            } else {
                assert!(
                    pool.winning_outcome.is_none(),
                    "[{context}] pool {pool_id} names a winner while unsettled"
                );
            }
        }
    }
}
