//! Interest-rate manipulation guard for lending pools.

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
