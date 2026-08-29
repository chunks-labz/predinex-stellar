//! Regulated Institutional Compliance Contract for Stellar/Soroban Lending Pools.
//!
//! Provides institutional KYC/KYB tiering, OFAC sanction list screening, jurisdiction filtering,
//! rolling 24-hour daily volume limits, freeze controls, and audit event logs.

#![no_std]

pub mod types;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol, Vec,
};
use types::{
    ComplianceAction, ComplianceError, ComplianceRecord, ComplianceTier,
    ComplianceVerificationResult, JurisdictionRule,
};

/// 24 hours in seconds for rolling volume window.
pub const ROLLING_WINDOW_SECONDS: u64 = 86_400;

/// Default daily volume limits by tier (in USD scaled by 1e7)
pub const TIER1_DEFAULT_DAILY_LIMIT: i128 = 10_000 * 10_000_000; // $10,000
pub const TIER2_DEFAULT_DAILY_LIMIT: i128 = 250_000 * 10_000_000; // $250,000
pub const TIER3_DEFAULT_DAILY_LIMIT: i128 = 10_000_000 * 10_000_000; // $10,000,000

const AUDIT_EVENT: Symbol = symbol_short!("cmp_audit");

#[contracttype]
pub enum DataKey {
    Admin,
    Officer(Address),
    Record(Address),
    Jurisdiction(u32),
}

#[contract]
pub struct ComplianceContract;

#[contractimpl]
impl ComplianceContract {
    /// Initializes the compliance contract with an administrator.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ComplianceError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ComplianceError::Unauthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Officer(admin), &true);
        Ok(())
    }

    /// Sets compliance officer role for an address.
    pub fn set_officer(env: Env, admin: Address, officer: Address, active: bool) -> Result<(), ComplianceError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ComplianceError::Unauthorized)?;
        if admin != stored_admin {
            return Err(ComplianceError::Unauthorized);
        }

        env.storage().instance().set(&DataKey::Officer(officer), &active);
        Ok(())
    }

    /// Registers or updates KYC/AML compliance profile for a participant.
    pub fn register_participant(
        env: Env,
        officer: Address,
        participant: Address,
        tier: ComplianceTier,
        kyc_expiry: u64,
        jurisdiction_code: u32,
        custom_daily_limit_usd: i128,
        current_time: u64,
    ) -> Result<(), ComplianceError> {
        officer.require_auth();
        let is_officer: bool = env
            .storage()
            .instance()
            .get(&DataKey::Officer(officer.clone()))
            .unwrap_or(false);
        if !is_officer {
            return Err(ComplianceError::Unauthorized);
        }

        if kyc_expiry <= current_time && tier as u32 > 0 {
            return Err(ComplianceError::KycExpired);
        }

        let daily_limit = if custom_daily_limit_usd > 0 {
            custom_daily_limit_usd
        } else {
            match tier {
                ComplianceTier::Tier0Unverified => 0,
                ComplianceTier::Tier1Retail => TIER1_DEFAULT_DAILY_LIMIT,
                ComplianceTier::Tier2Accredited => TIER2_DEFAULT_DAILY_LIMIT,
                ComplianceTier::Tier3Institutional => TIER3_DEFAULT_DAILY_LIMIT,
            }
        };

        let record = ComplianceRecord {
            participant: participant.clone(),
            tier,
            kyc_expiry,
            jurisdiction_code,
            is_sanctioned: false,
            is_frozen: false,
            daily_volume_limit_usd: daily_limit,
            daily_volume_used_usd: 0,
            last_reset_timestamp: current_time,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Record(participant), &record);
        Ok(())
    }

    /// Flags an address on the sanctions / black list.
    pub fn set_sanctions(
        env: Env,
        officer: Address,
        participant: Address,
        is_sanctioned: bool,
    ) -> Result<(), ComplianceError> {
        officer.require_auth();
        let is_officer: bool = env
            .storage()
            .instance()
            .get(&DataKey::Officer(officer))
            .unwrap_or(false);
        if !is_officer {
            return Err(ComplianceError::Unauthorized);
        }

        let mut record: ComplianceRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Record(participant.clone()))
            .ok_or(ComplianceError::RecordNotFound)?;

        record.is_sanctioned = is_sanctioned;
        env.storage()
            .persistent()
            .set(&DataKey::Record(participant), &record);
        Ok(())
    }

    /// Sets frozen status for an address (temporary compliance hold).
    pub fn set_frozen(
        env: Env,
        officer: Address,
        participant: Address,
        is_frozen: bool,
    ) -> Result<(), ComplianceError> {
        officer.require_auth();
        let is_officer: bool = env
            .storage()
            .instance()
            .get(&DataKey::Officer(officer))
            .unwrap_or(false);
        if !is_officer {
            return Err(ComplianceError::Unauthorized);
        }

        let mut record: ComplianceRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Record(participant.clone()))
            .ok_or(ComplianceError::RecordNotFound)?;

        record.is_frozen = is_frozen;
        env.storage()
            .persistent()
            .set(&DataKey::Record(participant), &record);
        Ok(())
    }

    /// Sets jurisdiction policy (country allow/block and tier caps).
    pub fn set_jurisdiction(
        env: Env,
        officer: Address,
        country_code: u32,
        is_blocked: bool,
        max_allowed_tier: ComplianceTier,
    ) -> Result<(), ComplianceError> {
        officer.require_auth();
        let is_officer: bool = env
            .storage()
            .instance()
            .get(&DataKey::Officer(officer))
            .unwrap_or(false);
        if !is_officer {
            return Err(ComplianceError::Unauthorized);
        }

        let rule = JurisdictionRule {
            country_code,
            is_blocked,
            max_allowed_tier,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Jurisdiction(country_code), &rule);
        Ok(())
    }

    /// Verifies if a transaction adheres to institutional compliance rules and records the volume.
    ///
    /// # Checks Performed:
    /// 1. Address exists and is not Tier 0 (Unverified).
    /// 2. KYC expiration is in the future.
    /// 3. Address is not flagged on sanctions list.
    /// 4. Address is not frozen.
    /// 5. Jurisdiction is not blocked and participant tier does not exceed jurisdiction cap.
    /// 6. Transaction amount does not exceed remaining rolling 24-hour limit.
    pub fn verify_transaction(
        env: Env,
        participant: Address,
        action: ComplianceAction,
        amount_usd: i128,
        current_time: u64,
    ) -> Result<ComplianceVerificationResult, ComplianceError> {
        if amount_usd < 0 {
            return Err(ComplianceError::InvalidParameter);
        }

        let record_opt: Option<ComplianceRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Record(participant.clone()));

        let mut record = match record_opt {
            Some(r) => r,
            None => {
                return Ok(ComplianceVerificationResult {
                    is_allowed: false,
                    participant,
                    tier: ComplianceTier::Tier0Unverified,
                    daily_remaining_usd: 0,
                    error_code: ComplianceError::UnverifiedParticipant as u32,
                });
            }
        };

        // Check Tier 0
        if record.tier == ComplianceTier::Tier0Unverified {
            return Ok(ComplianceVerificationResult {
                is_allowed: false,
                participant,
                tier: record.tier,
                daily_remaining_usd: 0,
                error_code: ComplianceError::UnverifiedParticipant as u32,
            });
        }

        // Check KYC Expiry
        if current_time >= record.kyc_expiry {
            return Ok(ComplianceVerificationResult {
                is_allowed: false,
                participant,
                tier: record.tier,
                daily_remaining_usd: 0,
                error_code: ComplianceError::KycExpired as u32,
            });
        }

        // Check Sanctions
        if record.is_sanctioned {
            return Ok(ComplianceVerificationResult {
                is_allowed: false,
                participant,
                tier: record.tier,
                daily_remaining_usd: 0,
                error_code: ComplianceError::SanctionedAddress as u32,
            });
        }

        // Check Frozen
        if record.is_frozen {
            return Ok(ComplianceVerificationResult {
                is_allowed: false,
                participant,
                tier: record.tier,
                daily_remaining_usd: 0,
                error_code: ComplianceError::AddressFrozen as u32,
            });
        }

        // Check Jurisdiction
        let jur_rule_opt: Option<JurisdictionRule> = env
            .storage()
            .persistent()
            .get(&DataKey::Jurisdiction(record.jurisdiction_code));
        if let Some(jur_rule) = jur_rule_opt {
            if jur_rule.is_blocked || (record.tier as u32 > jur_rule.max_allowed_tier as u32) {
                return Ok(ComplianceVerificationResult {
                    is_allowed: false,
                    participant,
                    tier: record.tier,
                    daily_remaining_usd: 0,
                    error_code: ComplianceError::RestrictedJurisdiction as u32,
                });
            }
        }

        // Reset rolling window if 24 hours elapsed
        if current_time.saturating_sub(record.last_reset_timestamp) >= ROLLING_WINDOW_SECONDS {
            record.daily_volume_used_usd = 0;
            record.last_reset_timestamp = current_time;
        }

        let new_daily_volume = record
            .daily_volume_used_usd
            .checked_add(amount_usd)
            .ok_or(ComplianceError::MathOverflow)?;

        if new_daily_volume > record.daily_volume_limit_usd {
            let remaining = (record.daily_volume_limit_usd - record.daily_volume_used_usd).max(0);
            return Ok(ComplianceVerificationResult {
                is_allowed: false,
                participant,
                tier: record.tier,
                daily_remaining_usd: remaining,
                error_code: ComplianceError::DailyLimitExceeded as u32,
            });
        }

        // Update used volume
        record.daily_volume_used_usd = new_daily_volume;
        let remaining = record.daily_volume_limit_usd - new_daily_volume;

        env.storage()
            .persistent()
            .set(&DataKey::Record(participant.clone()), &record);

        // Emit audit event
        env.events().publish(
            (AUDIT_EVENT, participant.clone()),
            (action as u32, amount_usd, current_time),
        );

        Ok(ComplianceVerificationResult {
            is_allowed: true,
            participant,
            tier: record.tier,
            daily_remaining_usd: remaining,
            error_code: 0,
        })
    }

    /// Queries compliance record for an address.
    pub fn get_record(env: Env, participant: Address) -> Result<ComplianceRecord, ComplianceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Record(participant))
            .ok_or(ComplianceError::RecordNotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events};
    use soroban_sdk::Env;

    #[test]
    fn test_compliance_workflow() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);

        // Register user as Tier 2 Accredited
        let expiry = 1_800_000_000;
        let now = 1_700_000_000;
        client.register_participant(
            &admin,
            &user,
            &ComplianceTier::Tier2Accredited,
            &expiry,
            &840, // USA
            &0,   // default limit ($250,000)
            &now,
        );

        // Verify valid transaction of $50,000
        let res = client.verify_transaction(
            &user,
            &ComplianceAction::Deposit,
            &(50_000 * 10_000_000),
            &now,
        );
        assert!(res.is_allowed);
        assert_eq!(res.error_code, 0);

        // Verify exceeding remaining limit
        let res2 = client.verify_transaction(
            &user,
            &ComplianceAction::Deposit,
            &(250_000 * 10_000_000),
            &now,
        );
        assert!(!res2.is_allowed);
        assert_eq!(res2.error_code, ComplianceError::DailyLimitExceeded as u32);

        // Sanction user
        client.set_sanctions(&admin, &user, &true);
        let res3 = client.verify_transaction(
            &user,
            &ComplianceAction::Deposit,
            &(1_000 * 10_000_000),
            &now,
        );
        assert!(!res3.is_allowed);
        assert_eq!(res3.error_code, ComplianceError::SanctionedAddress as u32);
    }
}
