//! Interest-rate manipulation guard for lending pools.
//!
//! The guard is the boundary between "the rate the model wants to publish" and
//! "the rate a lender will actually see". Everything it does is a comparison
//! against a configured bound, which makes the *exact* comparison operator —
//! `>` versus `>=` — the whole security property. An off-by-one here either
//! rejects legitimate updates (a frozen market) or admits a manipulated one.
//!
//! # Formal verification (#1119)
//!
//! The `verification` module below states the boundary conditions as properties
//! and checks them by bounded exhaustive enumeration. It verifies the guard in
//! this file; see `docs/FORMAL_VERIFICATION.md` for the invariant catalogue and
//! the reasoning behind the bounds.

#![allow(dead_code)]

use soroban_sdk::contracttype;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum RateGuardError {
    AssetMismatch,
    RateOutOfBounds,
    UtilizationOutOfBounds,
    StaleObservation,
    RateDeltaExceeded,
    UtilizationJumpExceeded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct RateObservation {
    pub asset_id: u32,
    pub rate_bps: u32,
    pub utilization_bps: u32,
    pub timestamp: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct RateGuardConfig {
    pub max_rate_bps: u32,
    pub max_delta_bps: u32,
    pub max_utilization_jump_bps: u32,
    pub max_stale_secs: u64,
}

pub struct InterestRateGuard;

impl InterestRateGuard {
    pub fn validate_update(
        previous: RateObservation,
        next: RateObservation,
        config: RateGuardConfig,
        now: u64,
    ) -> Result<(), RateGuardError> {
        if previous.asset_id != next.asset_id {
            return Err(RateGuardError::AssetMismatch);
        }

        if next.rate_bps > config.max_rate_bps {
            return Err(RateGuardError::RateOutOfBounds);
        }

        if next.utilization_bps > 10_000 {
            return Err(RateGuardError::UtilizationOutOfBounds);
        }

        if now.saturating_sub(next.timestamp) > config.max_stale_secs {
            return Err(RateGuardError::StaleObservation);
        }

        if Self::abs_delta(previous.rate_bps, next.rate_bps) > config.max_delta_bps {
            return Err(RateGuardError::RateDeltaExceeded);
        }

        if Self::abs_delta(previous.utilization_bps, next.utilization_bps)
            > config.max_utilization_jump_bps
        {
            return Err(RateGuardError::UtilizationJumpExceeded);
        }

        Ok(())
    }

    fn abs_delta(left: u32, right: u32) -> u32 {
        if left >= right {
            left - right
        } else {
            right - left
        }
    }
}

#[cfg(test)]
mod verification {
    //! # Interest rate model — boundary conditions (#1119)
    //!
    //! A rate guard is almost entirely made of boundaries: five comparisons and
    //! one equality, each of which decides whether a lender sees a rate the
    //! model intended to publish. This suite verifies those boundaries rather
    //! than the happy path.
    //!
    //! ## Properties
    //!
    //! 1. **Verdict agreement.** `validate_update` accepts an update if and only
    //!    if every policy predicate holds. This is what makes the rest
    //!    meaningful: the expected verdicts come from an oracle transcribed from
    //!    the policy prose, not from a second copy of the implementation, so a
    //!    change to the guard that alters *which* updates pass cannot hide behind
    //!    a restatement of the same code.
    //! 2. **Inclusive bounds.** Every configured bound is inclusive: a value
    //!    exactly equal to the bound is accepted and the next representable step
    //!    is rejected. Checked for the rate, the staleness window, the rate
    //!    allowance, and the utilization allowance.
    //! 3. **Utilization is capped at 100%.** `10_000` bps is accepted and
    //!    `10_001` is rejected regardless of how permissive the rate policy is,
    //!    so the cap cannot be traded away for a looser rate bound.
    //! 4. **Delta checks are direction-independent.** The same pair of values is
    //!    judged identically whichever way round `previous` and `next` sit, so a
    //!    threshold cannot be evaded by approaching the bound from one side only.
    //! 5. **Asset binding is not waivable.** A mismatched asset is rejected even
    //!    when every other field is benign, and the failure is reported as an
    //!    asset mismatch rather than as whichever other check happened to run.
    //! 6. **Precedence is fixed and fail-closed.** When several conditions fail
    //!    at once, the reported error is the first in the documented order
    //!    (asset, rate, utilization, staleness, rate delta, utilization jump).
    //! 7. **Subtraction is total.** `abs_delta` is symmetric, zero on equal
    //!    inputs, and never overflows — including at `u32::MAX`, where a naive
    //!    `a - b` panics in a checked build and wraps in a release one.
    //! 8. **Chains of updates stay inside the policy.** In a generated sequence
    //!    where each observation is validated against the last accepted one, no
    //!    step is accepted that violates the policy.
    //!
    //! Two behaviours are *not* properties, because the guard does not provide
    //! them. They are pinned by tests so the gap is visible rather than assumed
    //! away: a future-dated observation is never stale, and the `previous`
    //! observation is never range-checked.
    //!
    //! ## Bounds
    //!
    //! - Utilization is enumerated **exhaustively** over `0..=10_001`, the whole
    //!   domain around the 100% cap. No utilization value goes unasked.
    //! - The rate and staleness domains are probed at `0`, `1`, `bound - 1`,
    //!   `bound`, `bound + 1`, and `u32::MAX`, which is every point at which a
    //!   comparison can change its answer.
    //! - Five policies are exercised, including a zeroed one and one with
    //!   saturated bounds, so no assertion depends on a single configuration.
    //!   Policies whose bounds leave an isolated boundary untestable (a saturated
    //!   bound has no representable value above it) skip that boundary
    //!   explicitly rather than asserting something weaker.
    //! - Sequences are bounded at [`MAX_STEPS`] observations over [`SEEDS`]
    //!   fixed seeds, so a failure is reproducible from its seed alone.
    //!
    //! Not covered: the curve that *produces* `rate_bps` (the two-slope kink
    //! configured by `types::LendingPoolConfig`), where `timestamp` comes from,
    //! and the interior of the rate domain between the probe points.

    extern crate std;

    use super::*;

    /// Observations per generated chain.
    const MAX_STEPS: u32 = 12;
    /// Seeds explored. Fixed so a failure is reproducible from its seed.
    const SEEDS: [u64; 4] = [7, 101, 4_321, 999_983];
    /// The utilization cap, in basis points: 100.00%.
    const UTILIZATION_CAP_BPS: u32 = 10_000;

    /// The policies under test: a zeroed one, a realistic one, a tight one with
    /// no staleness allowance, a fully saturated one, and an asymmetric one.
    const POLICIES: [RateGuardConfig; 5] = [
        RateGuardConfig {
            max_rate_bps: 0,
            max_delta_bps: 0,
            max_utilization_jump_bps: 0,
            max_stale_secs: 0,
        },
        RateGuardConfig {
            max_rate_bps: 8_000,
            max_delta_bps: 250,
            max_utilization_jump_bps: 1_500,
            max_stale_secs: 300,
        },
        RateGuardConfig {
            max_rate_bps: 500,
            max_delta_bps: 10,
            max_utilization_jump_bps: 10,
            max_stale_secs: 0,
        },
        RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: u32::MAX,
            max_stale_secs: u64::MAX,
        },
        RateGuardConfig {
            max_rate_bps: 1,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: 0,
            max_stale_secs: 1,
        },
    ];

    /// A verdict derived from the policy prose rather than from the guard.
    ///
    /// Written as predicates so the two cannot drift together unnoticed. Every
    /// bound is inclusive: "at most `max`" means `<=`, and a bound is crossed
    /// only by the value one step beyond it.
    fn policy_verdict(
        previous: &RateObservation,
        next: &RateObservation,
        config: &RateGuardConfig,
        now: u64,
    ) -> Result<(), RateGuardError> {
        if previous.asset_id != next.asset_id {
            return Err(RateGuardError::AssetMismatch);
        }
        if next.rate_bps > config.max_rate_bps {
            return Err(RateGuardError::RateOutOfBounds);
        }
        if next.utilization_bps > UTILIZATION_CAP_BPS {
            return Err(RateGuardError::UtilizationOutOfBounds);
        }
        // `saturating_sub` is part of the specified behaviour: an observation
        // dated in the future reads as age 0, not as an underflow.
        if now.saturating_sub(next.timestamp) > config.max_stale_secs {
            return Err(RateGuardError::StaleObservation);
        }
        if magnitude(next.rate_bps, previous.rate_bps) > config.max_delta_bps {
            return Err(RateGuardError::RateDeltaExceeded);
        }
        if magnitude(next.utilization_bps, previous.utilization_bps)
            > config.max_utilization_jump_bps
        {
            return Err(RateGuardError::UtilizationJumpExceeded);
        }
        Ok(())
    }

    /// Absolute difference, written so the ordering of the operands is visibly
    /// irrelevant.
    fn magnitude(a: u32, b: u32) -> u32 {
        if a > b {
            a - b
        } else {
            b - a
        }
    }

    fn observation(
        asset_id: u32,
        rate_bps: u32,
        utilization_bps: u32,
        timestamp: u64,
    ) -> RateObservation {
        RateObservation {
            asset_id,
            rate_bps,
            utilization_bps,
            timestamp,
        }
    }

    /// An observation that is in range under every policy — its rate is at half
    /// the cap and its utilization is half the 100% ceiling — so a test can vary
    /// one field and attribute the verdict to that field alone.
    fn baseline(config: &RateGuardConfig, now: u64) -> RateObservation {
        observation(1, config.max_rate_bps / 2, UTILIZATION_CAP_BPS / 2, now)
    }

    // ── Property 1: verdict agreement ────────────────────────────────────────

    /// **Verdict agreement.** The guard accepts exactly the updates the policy
    /// permits, across the whole utilization domain and both edges of the rate
    /// and staleness bounds.
    #[test]
    fn p1_verdict_agrees_with_the_policy_over_the_whole_domain() {
        let now = 1_000_000;

        for config in POLICIES.iter() {
            let previous = baseline(config, now);

            // The utilization domain, enumerated exhaustively. This is the bound
            // that makes the property exhaustive rather than sampled: there is
            // no utilization value the guard has not been asked about.
            for utilization in 0..=(UTILIZATION_CAP_BPS + 1) {
                let next = observation(1, config.max_rate_bps / 2, utilization, now);
                assert_eq!(
                    InterestRateGuard::validate_update(
                        previous.clone(),
                        next.clone(),
                        config.clone(),
                        now
                    ),
                    policy_verdict(&previous, &next, config, now),
                    "utilization {utilization} against policy {config:?}"
                );
            }

            // The rate domain, at the points where a comparison can change.
            let rate_probes = [
                0,
                1,
                config.max_rate_bps.saturating_sub(1),
                config.max_rate_bps,
                config.max_rate_bps.saturating_add(1),
                u32::MAX,
            ];
            for rate in rate_probes {
                let next = observation(1, rate, 0, now);
                assert_eq!(
                    InterestRateGuard::validate_update(
                        previous.clone(),
                        next.clone(),
                        config.clone(),
                        now
                    ),
                    policy_verdict(&previous, &next, config, now),
                    "rate {rate} against policy {config:?}"
                );
            }

            // The staleness window, at the same points around the limit. Ages
            // are derived from `now`, saturating so a saturated policy cannot
            // underflow the probe arithmetic.
            let limit = config.max_stale_secs;
            let age_probes = [
                0,
                1,
                limit.saturating_sub(1),
                limit,
                limit.saturating_add(1),
                u64::MAX,
            ];
            for age in age_probes {
                let next = observation(1, config.max_rate_bps / 2, 0, now.saturating_sub(age));
                assert_eq!(
                    InterestRateGuard::validate_update(
                        previous.clone(),
                        next.clone(),
                        config.clone(),
                        now
                    ),
                    policy_verdict(&previous, &next, config, now),
                    "age {age} against policy {config:?}"
                );
            }
        }
    }

    // ── Property 2: inclusive bounds ─────────────────────────────────────────

    /// **Inclusive bounds (rate and rate allowance).** A rate exactly at the cap
    /// is accepted and one step past it is rejected; a rate move of exactly the
    /// allowance is accepted and one step more is rejected.
    #[test]
    fn p2_rate_bounds_are_inclusive() {
        let now = 1_000_000;

        for config in POLICIES.iter() {
            // A saturated cap has no representable value above it, so the "one
            // step past" half of the property is vacuous rather than failing.
            if config.max_rate_bps == u32::MAX {
                continue;
            }
            // Anchored one allowance below the cap, so that reaching the cap is
            // a permitted move and the rate bound is the only thing under test.
            // Anchoring at zero would trip the rate allowance first and the
            // property would be asserting the wrong error.
            let anchor = observation(
                1,
                config.max_rate_bps.saturating_sub(config.max_delta_bps),
                0,
                now,
            );

            let at_cap = observation(1, config.max_rate_bps, 0, now);
            assert_eq!(
                InterestRateGuard::validate_update(
                    anchor.clone(),
                    at_cap.clone(),
                    config.clone(),
                    now
                ),
                Ok(()),
                "a rate exactly at the cap was rejected (policy {config:?})"
            );

            let past_cap = observation(1, config.max_rate_bps + 1, 0, now);
            assert_eq!(
                InterestRateGuard::validate_update(anchor.clone(), past_cap, config.clone(), now),
                Err(RateGuardError::RateOutOfBounds),
                "a rate one step past the cap was accepted (policy {config:?})"
            );

            // The rate allowance is only isolable when a value one step past it
            // is still inside the cap; otherwise the cap check reports first
            // and the property would be asserting the wrong error.
            if config.max_rate_bps <= config.max_delta_bps {
                continue;
            }

            // Anchor at zero rate so the delta equals the test rate directly.
            let zero_anchor = observation(1, 0, 0, now);

            let at_allowance = observation(1, config.max_delta_bps, 0, now);
            assert_eq!(
                InterestRateGuard::validate_update(
                    zero_anchor.clone(),
                    at_allowance,
                    config.clone(),
                    now
                ),
                Ok(()),
                "a rate move of exactly the allowance was rejected (policy {config:?})"
            );

            let past_allowance = observation(1, config.max_delta_bps + 1, 0, now);
            assert_eq!(
                InterestRateGuard::validate_update(zero_anchor, past_allowance, config.clone(), now),
                Err(RateGuardError::RateDeltaExceeded),
                "a rate move one step past the allowance was accepted (policy {config:?})"
            );
        }
    }

    /// **Inclusive bounds (utilization allowance).** A utilization jump of
    /// exactly the allowance is accepted and one step more is rejected.
    ///
    /// Anchored at zero utilization: a jump that overshoots the 100% cap would
    /// be reported as a cap violation instead, which is a different property.
    #[test]
    fn p2_utilization_jump_bound_is_inclusive() {
        let config = RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: 1_500,
            max_stale_secs: u64::MAX,
        };
        let now = 1_000_000;
        let anchor = observation(1, 0, 0, now);

        let at_allowance = observation(1, 0, config.max_utilization_jump_bps, now);
        assert_eq!(
            InterestRateGuard::validate_update(anchor.clone(), at_allowance, config.clone(), now),
            Ok(()),
            "a utilization jump of exactly the allowance was rejected"
        );

        let past_allowance = observation(1, 0, config.max_utilization_jump_bps + 1, now);
        assert_eq!(
            InterestRateGuard::validate_update(anchor, past_allowance, config.clone(), now),
            Err(RateGuardError::UtilizationJumpExceeded),
            "a utilization jump one step past the allowance was accepted"
        );
    }

    /// **Inclusive bounds (staleness).** An observation exactly at the limit is
    /// accepted and one second older is rejected. A zero window is the tightest
    /// form of the same boundary: it accepts only an observation stamped at
    /// `now`.
    #[test]
    fn p2_staleness_bound_is_inclusive() {
        let now = 1_000_000;
        let config = RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: u32::MAX,
            max_stale_secs: 300,
        };
        let anchor = observation(1, 0, 0, now);

        let at_limit = observation(1, 0, 0, now - 300);
        assert_eq!(
            InterestRateGuard::validate_update(anchor.clone(), at_limit, config.clone(), now),
            Ok(()),
            "an observation exactly at the staleness limit was rejected"
        );

        let past_limit = observation(1, 0, 0, now - 301);
        assert_eq!(
            InterestRateGuard::validate_update(anchor.clone(), past_limit, config.clone(), now),
            Err(RateGuardError::StaleObservation),
            "an observation one second past the staleness limit was accepted"
        );

        let strict = RateGuardConfig {
            max_stale_secs: 0,
            ..config
        };
        assert_eq!(
            InterestRateGuard::validate_update(
                anchor.clone(),
                observation(1, 0, 0, now),
                strict.clone(),
                now
            ),
            Ok(()),
            "a zero staleness window rejected an observation stamped at now"
        );
        assert_eq!(
            InterestRateGuard::validate_update(anchor, observation(1, 0, 0, now - 1), strict, now),
            Err(RateGuardError::StaleObservation),
            "a zero staleness window accepted an observation one second old"
        );
    }

    // ── Property 3: utilization is capped at 100% ────────────────────────────

    /// **Utilization is capped at 100%.** The cap holds under a policy that
    /// places no other restriction on the rate, so it cannot be relaxed by
    /// loosening the rate bound.
    #[test]
    fn p3_utilization_is_capped_at_one_hundred_percent() {
        let permissive = RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: u32::MAX,
            max_stale_secs: u64::MAX,
        };
        let now = 1_000_000;

        for utilization in [0, 1, 9_999, UTILIZATION_CAP_BPS] {
            let previous = observation(1, 0, utilization, now);
            let next = observation(1, 0, utilization, now);
            assert_eq!(
                InterestRateGuard::validate_update(previous, next, permissive.clone(), now),
                Ok(()),
                "utilization {utilization} is within the cap and must be accepted"
            );
        }

        for utilization in [UTILIZATION_CAP_BPS + 1, UTILIZATION_CAP_BPS + 2, u32::MAX] {
            let previous = observation(1, 0, 0, now);
            let next = observation(1, 0, utilization, now);
            assert_eq!(
                InterestRateGuard::validate_update(previous, next, permissive.clone(), now),
                Err(RateGuardError::UtilizationOutOfBounds),
                "utilization {utilization} is above the cap and must be rejected"
            );
        }
    }

    // ── Property 4: direction independence ──────────────────────────────────

    /// **Delta checks are direction-independent.** The same two values are judged
    /// identically whichever of them is `previous`, so a threshold cannot be
    /// evaded by approaching the bound from one side only.
    #[test]
    fn p4_delta_checks_do_not_depend_on_direction() {
        let config = RateGuardConfig {
            max_rate_bps: 8_000,
            max_delta_bps: 250,
            max_utilization_jump_bps: 1_500,
            max_stale_secs: 300,
        };
        let now = 1_000_000;

        for (low, high) in [(0u32, 250u32), (100, 350), (7_750, 8_000), (0, 8_000)] {
            let rising = InterestRateGuard::validate_update(
                observation(1, low, 0, now),
                observation(1, high, 0, now),
                config.clone(),
                now,
            );
            let falling = InterestRateGuard::validate_update(
                observation(1, high, 0, now),
                observation(1, low, 0, now),
                config.clone(),
                now,
            );
            assert_eq!(
                rising, falling,
                "rate pair ({low}, {high}) was judged differently by direction"
            );

            let rising = InterestRateGuard::validate_update(
                observation(1, 0, low, now),
                observation(1, 0, high, now),
                config.clone(),
                now,
            );
            let falling = InterestRateGuard::validate_update(
                observation(1, 0, high, now),
                observation(1, 0, low, now),
                config.clone(),
                now,
            );
            assert_eq!(
                rising, falling,
                "utilization pair ({low}, {high}) was judged differently by direction"
            );
        }
    }

    // ── Property 5: asset binding ────────────────────────────────────────────

    /// **Asset binding is not waivable.** A mismatched asset is rejected even
    /// when the rest of the update is benign, and the rejection names the asset
    /// rather than some other check.
    #[test]
    fn p5_a_mismatched_asset_is_always_rejected() {
        let now = 1_000_000;

        for config in POLICIES.iter() {
            let previous = baseline(config, now);
            for other_asset in [0u32, 2, u32::MAX] {
                let next = observation(
                    other_asset,
                    previous.rate_bps,
                    previous.utilization_bps,
                    now,
                );
                assert_eq!(
                    InterestRateGuard::validate_update(previous.clone(), next, config.clone(), now),
                    Err(RateGuardError::AssetMismatch),
                    "asset {other_asset} against policy {config:?} was not rejected as a mismatch"
                );
            }
        }
    }

    // ── Property 6: precedence ───────────────────────────────────────────────

    /// **Precedence is fixed and fail-closed.** With several conditions failing
    /// at once, the reported error is the first in the documented order. A
    /// caller acting on the returned error — refusing the update, alerting,
    /// retrying — must not be told the observation is stale when the rate was
    /// also out of bounds, and must not be told the rate is out of bounds when
    /// the asset is not even the one being priced.
    #[test]
    fn p6_precedence_is_fixed_and_fail_closed() {
        let config = RateGuardConfig {
            max_rate_bps: 1_000,
            max_delta_bps: 100,
            max_utilization_jump_bps: 100,
            max_stale_secs: 60,
        };
        let now = 1_000_000;
        let previous = observation(1, 1_000, 5_000, now);

        // Only the staleness window is violated.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 1_000, 5_000, now - 61),
                config.clone(),
                now
            ),
            Err(RateGuardError::StaleObservation)
        );

        // Staleness and rate: the rate is checked first, so the rate is reported.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 1_001, 5_000, now - 61),
                config.clone(),
                now
            ),
            Err(RateGuardError::RateOutOfBounds)
        );

        // Staleness and utilization: utilization is checked first.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 1_000, UTILIZATION_CAP_BPS + 1, now - 61),
                config.clone(),
                now
            ),
            Err(RateGuardError::UtilizationOutOfBounds)
        );

        // Rate and utilization: rate is checked first.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 1_001, UTILIZATION_CAP_BPS + 1, now),
                config.clone(),
                now
            ),
            Err(RateGuardError::RateOutOfBounds)
        );

        // Staleness and the rate allowance: staleness is checked first.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 500, 5_000, now - 61),
                config.clone(),
                now
            ),
            Err(RateGuardError::StaleObservation)
        );

        // The rate allowance is checked before the utilization allowance: both
        // are violated here, and the rate is reported.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous.clone(),
                observation(1, 0, 0, now),
                config.clone(),
                now
            ),
            Err(RateGuardError::RateDeltaExceeded)
        );

        // Asset is checked before everything, including an otherwise fatal rate.
        assert_eq!(
            InterestRateGuard::validate_update(
                previous,
                observation(9, u32::MAX, u32::MAX, 0),
                config,
                now
            ),
            Err(RateGuardError::AssetMismatch)
        );
    }

    // ── Property 7: total subtraction ────────────────────────────────────────

    /// **Subtraction is total.** `abs_delta` is symmetric, zero on equal inputs,
    /// and does not overflow — including at `u32::MAX`, where `a - b` on
    /// unsigned values panics in a checked build and wraps in a release one.
    #[test]
    fn p7_abs_delta_is_total_and_cannot_overflow() {
        let probes = [0u32, 1, 2, 10_000, u32::MAX - 1, u32::MAX];

        for left in probes {
            for right in probes {
                let forward = InterestRateGuard::abs_delta(left, right);
                let backward = InterestRateGuard::abs_delta(right, left);
                assert_eq!(
                    forward, backward,
                    "abs_delta({left}, {right}) is not symmetric"
                );
                assert_eq!(
                    InterestRateGuard::abs_delta(left, left),
                    0,
                    "abs_delta({left}, {left}) must be zero"
                );
                assert_eq!(
                    forward,
                    magnitude(left, right),
                    "abs_delta({left}, {right}) is wrong"
                );
            }
        }

        // The widest representable difference must not wrap.
        assert_eq!(InterestRateGuard::abs_delta(0, u32::MAX), u32::MAX);

        // The guard must survive the widest update a fully saturated policy can
        // express, which is where a subtraction would overflow if the ordering
        // test in `abs_delta` were ever removed.
        let config = RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: u32::MAX,
            max_stale_secs: u64::MAX,
        };
        assert_eq!(
            InterestRateGuard::validate_update(
                observation(1, 0, 0, 0),
                observation(1, u32::MAX, UTILIZATION_CAP_BPS, u64::MAX),
                config,
                u64::MAX,
            ),
            Ok(()),
            "the widest policy-permitted update must be accepted without overflow"
        );
    }

    // ── Property 8: chains of updates ────────────────────────────────────────

    /// **Chains of updates stay inside the policy.** Each observation in a
    /// generated chain is validated against the last accepted one, and every
    /// verdict agrees with the policy. This is the realistic shape of the
    /// threat: a rate that drifts one tolerated step at a time rather than
    /// jumping once.
    #[test]
    fn p8_generated_chains_never_accept_a_policy_violation() {
        let config = RateGuardConfig {
            max_rate_bps: 8_000,
            max_delta_bps: 250,
            max_utilization_jump_bps: 1_500,
            max_stale_secs: 300,
        };
        let now = 1_000_000;

        for seed in SEEDS {
            let mut rng = Lcg::new(seed);
            // The chain starts from a fresh in-range observation; each accepted
            // step becomes the next step's baseline, which is how a live rate
            // series is validated in practice.
            let mut previous = observation(1, 4_000, 5_000, now);

            for step in 0..MAX_STEPS {
                // Drawn across the cap and the allowance so both accepted and
                // rejected steps occur, rather than a chain that is rejected
                // from the first observation onwards.
                let rate = rng.in_range(0, 20_000) as u32;
                let utilization = rng.in_range(0, 12_000) as u32;
                let age = rng.in_range(0, 600);
                let next = observation(1, rate, utilization, now - age);

                let verdict = InterestRateGuard::validate_update(
                    previous.clone(),
                    next.clone(),
                    config.clone(),
                    now,
                );
                assert_eq!(
                    verdict,
                    policy_verdict(&previous, &next, &config, now),
                    "seed {seed} step {step}: the guard disagreed with the policy"
                );

                if verdict.is_ok() {
                    // An accepted step must be one the policy permits. Asserted
                    // directly as well as via the oracle, so a failure names the
                    // specific bound that was violated.
                    assert!(
                        next.rate_bps <= config.max_rate_bps,
                        "seed {seed} step {step}: accepted a rate of {} bps over a {} bps cap",
                        next.rate_bps,
                        config.max_rate_bps
                    );
                    assert!(
                        next.utilization_bps <= UTILIZATION_CAP_BPS,
                        "seed {seed} step {step}: accepted utilization of {} bps",
                        next.utilization_bps
                    );
                    assert!(
                        magnitude(previous.rate_bps, next.rate_bps) <= config.max_delta_bps,
                        "seed {seed} step {step}: accepted a rate move of {} bps",
                        magnitude(previous.rate_bps, next.rate_bps)
                    );
                    assert!(
                        magnitude(previous.utilization_bps, next.utilization_bps)
                            <= config.max_utilization_jump_bps,
                        "seed {seed} step {step}: accepted a utilization jump of {} bps",
                        magnitude(previous.utilization_bps, next.utilization_bps)
                    );
                    previous = next;
                }
            }
        }
    }

    // ── Documented gaps ──────────────────────────────────────────────────────

    /// A future-dated observation is never stale. `saturating_sub` floors the age
    /// at zero, so a feed with a skewed clock — or one that chooses its own
    /// timestamps — cannot be aged out, however far ahead it claims to be.
    ///
    /// Pinned as current behaviour rather than asserted as a property: the guard
    /// has no `max_future_secs` bound to test against, and adding one is a
    /// policy change, not a verification.
    #[test]
    fn a_future_dated_observation_is_never_stale() {
        let config = RateGuardConfig {
            max_rate_bps: u32::MAX,
            max_delta_bps: u32::MAX,
            max_utilization_jump_bps: u32::MAX,
            max_stale_secs: 0,
        };
        let now = 1_000;
        let previous = observation(1, 0, 0, now);

        for ahead in [1u64, 60, 1_000_000_000] {
            let next = observation(1, 0, 0, now + ahead);
            assert_eq!(
                InterestRateGuard::validate_update(previous.clone(), next, config.clone(), now),
                Ok(()),
                "an observation {ahead}s in the future reads as age 0 and is accepted"
            );
        }
    }

    /// The `previous` observation is never range-checked. Only `next` is
    /// bounded, so a baseline that is itself out of range is accepted as the
    /// reference point and the jump thresholds are then measured from an
    /// impossible value.
    ///
    /// Concretely: a baseline one basis point above the 100% utilization cap
    /// is accepted, and a subsequent in-range observation is accepted as a
    /// 1 bps "jump" from it.
    ///
    /// Pinned as current behaviour. Bounds-checking the baseline would need a
    /// decision this suite should not make: whether a bad baseline rejects the
    /// update or is discarded so the next update has no baseline at all.
    #[test]
    fn the_previous_observation_is_not_range_checked() {
        let config = RateGuardConfig {
            max_rate_bps: 8_000,
            max_delta_bps: 250,
            max_utilization_jump_bps: 1_500,
            max_stale_secs: 300,
        };
        let now = 1_000_000;
        let poisoned = observation(1, 0, UTILIZATION_CAP_BPS + 1, now);

        // The out-of-range baseline does not by itself reject anything.
        let in_range = observation(1, 0, UTILIZATION_CAP_BPS, now);
        assert_eq!(
            InterestRateGuard::validate_update(poisoned.clone(), in_range, config.clone(), now),
            Ok(()),
            "an out-of-range baseline is accepted, so the jump is measured from an impossible value"
        );

        // `next` is still bounds-checked on its own terms.
        let over_cap = observation(1, 8_001, 0, now);
        assert_eq!(
            InterestRateGuard::validate_update(poisoned, over_cap, config, now),
            Err(RateGuardError::RateOutOfBounds),
            "an out-of-range `next` rate is rejected regardless of the baseline"
        );
    }

    /// A deterministic generator, matching the LCG the `predinex` verification
    /// harness uses. Reproducibility is the point: a failure must be
    /// reconstructible from its seed alone.
    struct Lcg(u64);

    impl Lcg {
        fn new(seed: u64) -> Self {
            Lcg(seed)
        }

        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0
        }

        /// Uniform in `[min, max]`.
        fn in_range(&mut self, min: u64, max: u64) -> u64 {
            if min >= max {
                return min;
            }
            min + (self.next() % (max - min + 1))
        }
    }
}
