//! Regulated Institutional Compliance Contract for Stellar/Soroban Lending Pools.
//!
//! Provides institutional KYC/KYB tiering, OFAC sanction list screening, jurisdiction filtering,
//! rolling 24-hour daily volume limits, freeze controls, and audit event logs.

#![no_std]

pub mod types;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};
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
        env.storage()
            .instance()
            .set(&DataKey::Officer(admin), &true);
        Ok(())
    }

    /// Sets compliance officer role for an address.
    pub fn set_officer(
        env: Env,
        admin: Address,
        officer: Address,
        active: bool,
    ) -> Result<(), ComplianceError> {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ComplianceError::Unauthorized)?;
        if admin != stored_admin {
            return Err(ComplianceError::Unauthorized);
        }

        env.storage()
            .instance()
            .set(&DataKey::Officer(officer), &active);
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
    /// Only an authenticated compliance officer may call this: the call writes the
    /// participant's rolling volume back to storage and appends to the audit log, so
    /// leaving it open would let anyone reset another participant's 24-hour limit or
    /// forge audit events attributed to them. The evaluation clock is the ledger
    /// timestamp, never a caller-supplied one — a caller-chosen `current_time` would
    /// let a future date roll the window early and a past date dodge an expired KYC.
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
        officer: Address,
        participant: Address,
        action: ComplianceAction,
        amount_usd: i128,
    ) -> Result<ComplianceVerificationResult, ComplianceError> {
        Self::require_officer(&env, &officer)?;
        let current_time = env.ledger().timestamp();

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

    /// Asserts that `officer` authorized this call and currently holds the
    /// compliance officer role.
    fn require_officer(env: &Env, officer: &Address) -> Result<(), ComplianceError> {
        officer.require_auth();
        let is_officer: bool = env
            .storage()
            .instance()
            .get(&DataKey::Officer(officer.clone()))
            .unwrap_or(false);
        if !is_officer {
            return Err(ComplianceError::Unauthorized);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
    use soroban_sdk::xdr::ContractEventBody;
    use soroban_sdk::{Env, TryFromVal, Val};

    /// Ledger timestamp used by the tests. KYC is registered with a later expiry
    /// so the participant stays compliant at this instant.
    const NOW: u64 = 1_700_000_000;
    const KYC_EXPIRY: u64 = 1_800_000_000;

    const USD: i128 = 10_000_000; // amounts are USD scaled by 1e7

    /// Registers `user` as an accredited (Tier 2, $250k/day) participant.
    fn register_accredited(client: &ComplianceContractClient, officer: &Address, user: &Address) {
        client.register_participant(
            officer,
            user,
            &ComplianceTier::Tier2Accredited,
            &KYC_EXPIRY,
            &840, // USA
            &0,   // default limit ($250,000)
            &NOW,
        );
    }

    /// Decodes the payload of the last event emitted by `contract_id`.
    fn last_event_data(env: &Env, contract_id: &Address) -> (u32, i128, u64) {
        let events = env.events().all().filter_by_contract(contract_id);
        let event = events.events().last().expect("an event was emitted");
        let ContractEventBody::V0(body) = &event.body;
        let val = <Val as TryFromVal<Env, soroban_sdk::xdr::ScVal>>::try_from_val(env, &body.data)
            .expect("event data decodes to a Val");
        <(u32, i128, u64) as TryFromVal<Env, Val>>::try_from_val(env, &val)
            .expect("event data is (action, amount, timestamp)")
    }

    #[test]
    fn test_compliance_workflow() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);

        // Register user as Tier 2 Accredited
        register_accredited(&client, &admin, &user);

        // Verify valid transaction of $50,000
        let res =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(50_000 * USD));
        assert!(res.is_allowed);
        assert_eq!(res.error_code, 0);

        // Verify exceeding remaining limit
        let res2 =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(250_000 * USD));
        assert!(!res2.is_allowed);
        assert_eq!(res2.error_code, ComplianceError::DailyLimitExceeded as u32);

        // Sanction user
        client.set_sanctions(&admin, &user, &true);
        let res3 =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(1_000 * USD));
        assert!(!res3.is_allowed);
        assert_eq!(res3.error_code, ComplianceError::SanctionedAddress as u32);
    }

    /// A non-officer must not be able to spend another participant's allowance.
    #[test]
    fn verify_transaction_rejects_non_officer() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let outsider = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        register_accredited(&client, &admin, &user);

        let result = client.try_verify_transaction(
            &outsider,
            &user,
            &ComplianceAction::Deposit,
            &(1_000 * USD),
        );
        assert!(
            matches!(result, Err(Ok(ComplianceError::Unauthorized))),
            "non-officer must be rejected, got {result:?}"
        );

        // The rejected call must not have consumed any of the participant's limit.
        assert_eq!(client.get_record(&user).daily_volume_used_usd, 0);
    }

    /// `require_auth` is genuinely enforced: with nothing authorized, even the admin
    /// cannot move another address's volume.
    #[test]
    fn verify_transaction_requires_auth() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        register_accredited(&client, &admin, &user);

        // Drop the blanket auth mock: nothing is authorized anymore.
        env.mock_auths(&[]);

        let result = client.try_verify_transaction(
            &admin,
            &user,
            &ComplianceAction::Deposit,
            &(1_000 * USD),
        );
        assert!(result.is_err(), "unauthenticated call must fail");
        assert_eq!(client.get_record(&user).daily_volume_used_usd, 0);
    }

    /// A revoked officer loses the ability to move volume and emit audit events.
    #[test]
    fn verify_transaction_rejects_revoked_officer() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let officer = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        client.set_officer(&admin, &officer, &true);
        register_accredited(&client, &admin, &user);

        client.set_officer(&admin, &officer, &false);

        let result = client.try_verify_transaction(
            &officer,
            &user,
            &ComplianceAction::Deposit,
            &(1_000 * USD),
        );
        assert!(
            matches!(result, Err(Ok(ComplianceError::Unauthorized))),
            "revoked officer must be rejected, got {result:?}"
        );
    }

    /// The rolling 24h window advances with ledger time; no caller argument can roll
    /// it early to re-consume an exhausted allowance.
    #[test]
    fn verify_transaction_uses_ledger_time() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        register_accredited(&client, &admin, &user);

        // Burn the full $250,000 daily allowance.
        let exhausted =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(250_000 * USD));
        assert!(exhausted.is_allowed);
        assert_eq!(exhausted.daily_remaining_usd, 0);

        // Still inside the window: the next deposit is rejected.
        env.ledger().set_timestamp(NOW + ROLLING_WINDOW_SECONDS - 1);
        let blocked =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(1_000 * USD));
        assert!(!blocked.is_allowed);
        assert_eq!(
            blocked.error_code,
            ComplianceError::DailyLimitExceeded as u32
        );

        // The window has elapsed: the allowance is restored.
        env.ledger().set_timestamp(NOW + ROLLING_WINDOW_SECONDS);
        let refreshed =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(1_000 * USD));
        assert!(refreshed.is_allowed);
        assert_eq!(refreshed.daily_remaining_usd, 249_000 * USD);
    }

    /// KYC expiry is judged against the ledger clock, not a value the caller picks,
    /// so no stale timestamp can revive an expired verification.
    #[test]
    fn verify_transaction_rejects_kyc_expired_at_ledger_time() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        register_accredited(&client, &admin, &user);

        env.ledger().set_timestamp(KYC_EXPIRY);

        let expired =
            client.verify_transaction(&admin, &user, &ComplianceAction::Deposit, &(1_000 * USD));
        assert!(!expired.is_allowed);
        assert_eq!(expired.error_code, ComplianceError::KycExpired as u32);
    }

    /// The audit event records the ledger timestamp, so a caller cannot forge a
    /// backdated or future-dated compliance record.
    #[test]
    fn verify_transaction_audit_event_uses_ledger_time() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(NOW);

        let contract_id = env.register(ComplianceContract, ());
        let client = ComplianceContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.initialize(&admin);
        register_accredited(&client, &admin, &user);

        client.verify_transaction(&admin, &user, &ComplianceAction::Borrow, &(1_000 * USD));

        assert_eq!(
            last_event_data(&env, &contract_id),
            (ComplianceAction::Borrow as u32, 1_000 * USD, NOW)
        );
    }
}
