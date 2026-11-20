//! TWAP oracle guard for lending pool price updates.

#![allow(dead_code)]

use soroban_sdk::{contracttype, String as SorobanString, Vec as SorobanVec};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum OracleError {
    InvalidPrice,
    InvalidLiquidity,
    InsufficientSamples,
    WindowTooShort,
    StaleSample,
    PriceDeviationExceeded,
    ArithmeticOverflow,
}

#[derive(Clone)]
#[contracttype]
pub struct OracleSample {
    pub pair: SorobanString,
    pub price: i128,
    pub liquidity: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct TwapConfig {
    pub min_samples: u32,
    pub min_window_secs: u64,
    pub max_sample_age_secs: u64,
    pub max_deviation_bps: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct TwapReading {
    pub price: i128,
    pub sample_count: u32,
    pub window_secs: u64,
}

pub struct TwapOracle;

impl TwapOracle {
    pub fn compute_twap(
        samples: SorobanVec<OracleSample>,
        config: TwapConfig,
        now: u64,
    ) -> Result<TwapReading, OracleError> {
        if samples.len() < config.min_samples {
            return Err(OracleError::InsufficientSamples);
        }

        let first = samples.first().ok_or(OracleError::InsufficientSamples)?;
        let last = samples.last().ok_or(OracleError::InsufficientSamples)?;
        let window_secs = last.timestamp.saturating_sub(first.timestamp);
        if window_secs < config.min_window_secs {
            return Err(OracleError::WindowTooShort);
        }

        let mut weighted_sum = 0i128;
        let mut total_liquidity = 0i128;
        for sample in samples.iter() {
            if sample.price <= 0 {
                return Err(OracleError::InvalidPrice);
            }
            if sample.liquidity <= 0 {
                return Err(OracleError::InvalidLiquidity);
            }
            if now.saturating_sub(sample.timestamp) > config.max_sample_age_secs {
                return Err(OracleError::StaleSample);
            }

            weighted_sum = weighted_sum
                .checked_add(sample.price.checked_mul(sample.liquidity).ok_or(OracleError::ArithmeticOverflow)?)
                .ok_or(OracleError::ArithmeticOverflow)?;
            total_liquidity = total_liquidity
                .checked_add(sample.liquidity)
                .ok_or(OracleError::ArithmeticOverflow)?;
        }

        Ok(TwapReading {
            price: weighted_sum / total_liquidity,
            sample_count: samples.len(),
            window_secs,
        })
    }

    pub fn validate_spot_price(
        spot_price: i128,
        twap_price: i128,
        max_deviation_bps: u32,
    ) -> Result<u32, OracleError> {
        if spot_price <= 0 || twap_price <= 0 {
            return Err(OracleError::InvalidPrice);
        }

        let delta = if spot_price >= twap_price {
            spot_price - twap_price
        } else {
            twap_price - spot_price
        };
        let deviation_bps = delta
            .checked_mul(10_000)
            .ok_or(OracleError::PriceDeviationExceeded)?
            .checked_div(twap_price)
            .ok_or(OracleError::InvalidPrice)?;

        if deviation_bps > i128::from(max_deviation_bps) {
            return Err(OracleError::PriceDeviationExceeded);
        }

        Ok(deviation_bps as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_deviation_that_does_not_fit_u32() {
        let result = TwapOracle::validate_spot_price(4_294_967_296, 1, u32::MAX);
        assert_eq!(result, Err(OracleError::PriceDeviationExceeded));
    }
}
