//! Types and data structures for regulated institutional compliance on Stellar/Soroban.

#![no_std]

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Vec};

/// Error codes for institutional compliance operations.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ComplianceError {
    /// Caller is not authorized compliance officer or admin
    Unauthorized = 1,
    /// Invalid parameters supplied
    InvalidParameter = 2,
    /// Address is not KYC verified (Tier 0)
    UnverifiedParticipant = 3,
    /// Participant KYC verification has expired
    KycExpired = 4,
    /// Address is on the sanctions / blocked list (e.g. OFAC)
    SanctionedAddress = 5,
    /// Address is temporarily frozen by compliance officer
    AddressFrozen = 6,
    /// Transaction exceeds 24-hour daily volume limit for participant tier
    DailyLimitExceeded = 7,
    /// Jurisdiction is restricted or prohibited
    RestrictedJurisdiction = 8,
    /// Accreditation is required for this action
    AccreditationRequired = 9,
    /// Math overflow during volume tracking
    MathOverflow = 10,
    /// Compliance record not found for address
    RecordNotFound = 11,
}

/// Regulatory compliance tier for institutional participants.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ComplianceTier {
    /// Tier 0: Unverified (No transactions permitted)
    Tier0Unverified = 0,
    /// Tier 1: Retail Verified (Standard KYC, max 10k USD/day)
    Tier1Retail = 1,
    /// Tier 2: Accredited Investor (Accredited KYC, max 250k USD/day)
    Tier2Accredited = 2,
    /// Tier 3: Institutional Qualified (Full KYB/AML, max 10M USD/day)
    Tier3Institutional = 3,
}

/// Compliance action category.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ComplianceAction {
    Deposit = 1,
    Borrow = 2,
    Repay = 3,
    Withdraw = 4,
    Liquidate = 5,
    Transfer = 6,
}

/// Institutional compliance profile stored per participant address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComplianceRecord {
    pub participant: Address,
    pub tier: ComplianceTier,
    pub kyc_expiry: u64,
    pub jurisdiction_code: u32,
    pub is_sanctioned: bool,
    pub is_frozen: bool,
    pub daily_volume_limit_usd: i128,
    pub daily_volume_used_usd: i128,
    pub last_reset_timestamp: u64,
}

/// Jurisdiction compliance rule.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JurisdictionRule {
    pub country_code: u32,
    pub is_blocked: bool,
    pub max_allowed_tier: ComplianceTier,
}

/// Outcome of a compliance verification check.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComplianceVerificationResult {
    pub is_allowed: bool,
    pub participant: Address,
    pub tier: ComplianceTier,
    pub daily_remaining_usd: i128,
    pub error_code: u32,
}
