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

        if now < operation.submitted_at + config.min_order_delay_secs {
            return Err(MevGuardError::DelayNotElapsed);
        }

        let impact_bps = ((operation.amount * 10_000) / quote.liquidity_depth) as u32;
        if impact_bps > config.max_price_impact_bps {
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

        Ok(((delta * 10_000) / expected) as u32)
    }
}
