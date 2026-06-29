//! Custom error types for the Wave Pool contract.
//!
//! This module defines all possible errors that can be raised by the contract.
//! Errors are returned as `u32` codes via Soroban's `#[contracterror]` macro,
//! which provides gas-efficient serialization and conversion.
//!
//! # Error handling philosophy
//! - All errors are explicit and documented.
//! - Overflow conditions are caught using checked arithmetic (see `checked_volume_add`).
//! - Authorization failures are isolated from business logic errors.
//! - Pool lifecycle violations are clearly separated.

use soroban_sdk::contracterror;
use core::fmt;

/// All possible errors that can be raised by the Wave Pool contract.
///
/// Each variant corresponds to a unique `u32` error code.
/// The `#[contracterror]` attribute automatically derives:
/// - `TryFrom<u32>` / `Into<u32>` for efficient host function interaction
/// - `Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`
/// - A basic display implementation (use `fmt::Display` for custom messages).
#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ContractError {
    /// Arithmetic overflow occurred during a cumulative volume update.
    ///
    /// Raised when `checked_add` or `checked_mul` fails on volume counters.
    /// Design ensures overflow is never silently truncated.
    Overflow = 1,

    /// An operation was attempted on a pool that does not exist.
    ///
    /// Typically occurs when `pool_id` references a pool that was never created
    /// or was already removed.
    PoolNotFound = 2,

    /// The caller is not authorized to perform the requested action.
    ///
    /// This error is thrown when the contract detects that the invoking
    /// account does not have the required permissions (e.g., not the admin).
    Unauthorized = 3,

    /// A bet amount is invalid (e.g., zero or negative).
    ///
    /// Bets must be strictly positive integers. Future versions may enforce
    /// minimum or maximum amounts via configuration.
    InvalidBetAmount = 4,

    /// The pool is not in an active state for betting or settlement.
    ///
    /// Betting is only allowed when the pool is in `Active` status.
    /// Settlement requires pool to be in `Resolved` or equivalent terminal state.
    PoolNotActive = 5,

    /// Settlement was attempted but the pool outcome is already resolved.
    ///
    /// Prevents re-settlement or double-spending of rewards.
    AlreadySettled = 6,

    /// An attempt to claim was made with invalid proof or data.
    ///
    /// Could indicate incorrect oracle data, malformed proof, or unauthorized claim.
    InvalidClaimData = 7,

    /// Internal state inconsistency detected.
    ///
    /// This is a catch-all for unexpected invariants (e.g., missing mapping entry).
    /// Should never occur in normal operation; indicates a bug or storage corruption.
    InternalError = 8,
}

impl fmt::Display for ContractError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ContractError::Overflow => write!(f, "Arithmetic overflow occurred"),
            ContractError::PoolNotFound => write!(f, "Pool not found"),
            ContractError::Unauthorized => write!(f, "Unauthorized caller"),
            ContractError::InvalidBetAmount => write!(f, "Invalid bet amount (must be positive)"),
            ContractError::PoolNotActive => write!(f, "Pool is not active"),
            ContractError::AlreadySettled => write!(f, "Pool already settled"),
            ContractError::InvalidClaimData => write!(f, "Invalid claim data or proof"),
            ContractError::InternalError => write!(f, "Internal contract error"),
        }
    }
}

/// Convenience conversion from `ContractError` to `soroban_sdk::Error`.
/// Enables use with the `?` operator in Soroban functions returning `Result<_, Error>`.
impl From<ContractError> for soroban_sdk::Error {
    fn from(e: ContractError) -> Self {
        soroban_sdk::Error::from(&e)
    }
}

// Safety: The contract uses checked arithmetic everywhere.
// See `checked_volume_add` in the pool logic for overflow protection.