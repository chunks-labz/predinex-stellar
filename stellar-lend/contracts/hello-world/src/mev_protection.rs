//! Sandwich attack protection for lending pool operations.

#![allow(dead_code)]

use soroban_sdk::contracttype;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum MevGuardError {
    InvalidAmount,
    LiquidityUnavailable,
    QuoteStale,
    DelayNotElapsed,
    PriceImpactExceeded,
    SlippageExceeded,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct MevGuardConfig {
    pub max_price_impact_bps: u32,
    pub max_slippage_bps: u32,
    pub min_order_delay_secs: u64,
    pub stale_quote_secs: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct LendingQuote {
    pub quoted_price: i128,
    pub execution_price: i128,
    pub liquidity_depth: i128,
    pub observed_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct LendingOperation {
    pub amount: i128,
    pub submitted_at: u64,
}

pub struct MevProtection;

impl MevProtection {
    pub fn validate_operation(
        operation: LendingOperation,
        quote: LendingQuote,
        config: MevGuardConfig,
        now: u64,
    ) -> Result<(), MevGuardError> {
        if operation.amount <= 0 {
            return Err(MevGuardError::InvalidAmount);
        }

        if quote.liquidity_depth <= 0 {
            return Err(MevGuardError::LiquidityUnavailable);
        }

        if now.saturating_sub(quote.observed_at) > config.stale_quote_secs {
            return Err(MevGuardError::QuoteStale);
        }

        let eligible_at = operation
            .submitted_at
            .checked_add(config.min_order_delay_secs)
            .ok_or(MevGuardError::DelayNotElapsed)?;
        if now < eligible_at {
            return Err(MevGuardError::DelayNotElapsed);
        }

        // Keep the calculation wide until after the cap comparison. Casting
        // an attacker-controlled ratio to u32 could wrap large impacts to 0.
        let impact_bps = operation
            .amount
            .checked_mul(10_000)
            .ok_or(MevGuardError::PriceImpactExceeded)?
            .checked_div(quote.liquidity_depth)
            .ok_or(MevGuardError::LiquidityUnavailable)?;
        if impact_bps > i128::from(config.max_price_impact_bps) {
            return Err(MevGuardError::PriceImpactExceeded);
        }

        let slippage_bps = Self::price_delta_bps(quote.quoted_price, quote.execution_price)?;
        if slippage_bps > config.max_slippage_bps {
            return Err(MevGuardError::SlippageExceeded);
        }

        Ok(())
    }

    fn price_delta_bps(expected: i128, actual: i128) -> Result<u32, MevGuardError> {
        if expected <= 0 || actual <= 0 {
            return Err(MevGuardError::SlippageExceeded);
        }

        let delta = if expected >= actual {
            expected - actual
        } else {
            actual - expected
        };

        let bps = delta
            .checked_mul(10_000)
            .ok_or(MevGuardError::SlippageExceeded)?
            .checked_div(expected)
            .ok_or(MevGuardError::SlippageExceeded)?;
        if bps > i128::from(u32::MAX) {
            return Err(MevGuardError::SlippageExceeded);
        }
        Ok(bps as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> MevGuardConfig {
        MevGuardConfig {
            max_price_impact_bps: 100,
            max_slippage_bps: 100,
            min_order_delay_secs: 60,
            stale_quote_secs: 3_600,
        }
    }

    #[test]
    fn rejects_large_impact_before_narrowing() {
        let result = MevProtection::validate_operation(
            LendingOperation {
                amount: 4_294_967_296,
                submitted_at: 0,
            },
            LendingQuote {
                quoted_price: 100,
                execution_price: 100,
                liquidity_depth: 10_000,
                observed_at: 100,
            },
            config(),
            60,
        );
        assert_eq!(result, Err(MevGuardError::PriceImpactExceeded));
    }

    #[test]
    fn rejects_delay_timestamp_overflow() {
        let result = MevProtection::validate_operation(
            LendingOperation {
                amount: 1,
                submitted_at: u64::MAX,
            },
            LendingQuote {
                quoted_price: 100,
                execution_price: 100,
                liquidity_depth: 1_000,
                observed_at: 0,
            },
            config(),
            100,
        );
        assert_eq!(result, Err(MevGuardError::DelayNotElapsed));
    }
}
