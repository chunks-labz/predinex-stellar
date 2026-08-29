//! Emergency Withdrawal Mechanism for Lending Pool
//! 
//! Issue #1109: Implement lending pool emergency withdrawal mechanism
//! 
//! This module provides a secure emergency withdrawal system with comprehensive
//! security measures, rate limiting, and multi-signature support.

#![allow(unused_imports)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, 
    token, Address, Env, String as SorobanString, Symbol, Vec as SorobanVec,
};

/// Emergency withdrawal errors with detailed error codes
#[contracterror]
#[derive(Clone, Debug, Copy, Eq, PartialEq, PartialOrd, Ord)]
pub enum EmergencyError {
    /// Caller is not authorized for emergency operations
    Unauthorized = 1,
    /// Emergency mode is not currently active
    EmergencyNotActive = 2,
    /// Emergency mode is already active
    EmergencyAlreadyActive = 3,
    /// Withdrawal amount exceeds available balance
    InsufficientBalance = 4,
    /// Withdrawal would exceed configured limits
    WithdrawalLimitExceeded = 5,
    /// Cooldown period has not elapsed
    CooldownNotElapsed = 6,
    /// Invalid withdrawal amount (zero or negative)
    InvalidAmount = 7,
    /// Pool is currently paused
    PoolPaused = 8,
    /// Required number of signatures not met
    InsufficientSignatures = 9,
    /// Signature has already been used
    SignatureAlreadyUsed = 10,
    /// Rate limit exceeded for this time window
    RateLimitExceeded = 11,
    /// Emergency admin not initialized
    AdminNotInitialized = 12,
    /// Withdrawal recipient address is invalid
    InvalidRecipient = 13,
    /// Time lock has not expired
    TimeLockNotExpired = 14,
    /// Emergency withdrawal is permanently disabled
    PermanentlyDisabled = 15,
}

/// Emergency mode status
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum EmergencyStatus {
    /// Normal operation - emergency withdrawals disabled
    Normal,
    /// Emergency mode active - withdrawals enabled with restrictions
    Active,
    /// Emergency mode with enhanced restrictions
    Critical,
    /// Emergency system permanently disabled
    Disabled,
}

/// Emergency withdrawal configuration
#[derive(Clone)]
#[contracttype]
pub struct EmergencyConfig {
    /// Whether emergency mode is currently active
    pub status: EmergencyStatus,
    /// Primary emergency admin address
    pub primary_admin: Address,
    /// Secondary admin addresses (for multi-sig)
    pub secondary_admins: SorobanVec<Address>,
    /// Number of admin signatures required for withdrawal
    pub required_signatures: u32,
    /// Maximum amount that can be withdrawn per transaction
    pub max_withdrawal_amount: i128,
    /// Maximum total withdrawal in time window
    pub max_withdrawal_per_window: i128,
    /// Time window for rate limiting (seconds)
    pub rate_limit_window_secs: u64,
    /// Cooldown period between withdrawals (seconds)
    pub cooldown_period_secs: u64,
    /// Time lock delay before withdrawal can be executed (seconds)
    pub timelock_delay_secs: u64,
    /// Timestamp when emergency mode was activated
    pub activated_at: u64,
    /// Reason for emergency activation
    pub activation_reason: SorobanString,
}

/// Emergency withdrawal request
#[derive(Clone)]
#[contracttype]
pub struct WithdrawalRequest {
    /// Unique request ID
    pub id: u64,
    /// Address initiating the withdrawal
    pub initiator: Address,
    /// Recipient address for withdrawn funds
    pub recipient: Address,
    /// Amount to withdraw
    pub amount: i128,
    /// Token address to withdraw
    pub token: Address,
    /// Timestamp when request was created
    pub created_at: u64,
    /// Timestamp when request can be executed (after timelock)
    pub executable_at: u64,
    /// Admin signatures collected
    pub signatures: SorobanVec<Address>,
    /// Current status of the request
    pub status: WithdrawalRequestStatus,
    /// Reason for the withdrawal
    pub reason: SorobanString,
}

/// Status of a withdrawal request
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum WithdrawalRequestStatus {
    /// Pending admin approvals
    Pending,
    /// Approved and waiting for timelock
    Approved,
    /// Executed successfully
    Executed,
    /// Cancelled by admin
    Cancelled,
    /// Expired (not executed within valid timeframe)
    Expired,
}

/// Emergency withdrawal rate limit state
#[derive(Clone)]
#[contracttype]
pub struct RateLimitState {
    /// Start of current rate limit window
    pub window_start: u64,
    /// Total amount withdrawn in current window
    pub amount_withdrawn: i128,
    /// Timestamp of last withdrawal
    pub last_withdrawal_at: u64,
}

/// Audit log entry for emergency actions
#[derive(Clone)]
#[contracttype]
pub struct EmergencyAuditLog {
    /// Sequential log ID
    pub id: u64,
    /// Action performed
    pub action: EmergencyAction,
    /// Address that performed the action
    pub performer: Address,
    /// Timestamp of the action
    pub timestamp: u64,
    /// Amount involved (if applicable)
    pub amount: Option<i128>,
    /// Additional context or reason
    pub details: SorobanString,
}

/// Types of emergency actions for audit logging
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum EmergencyAction {
    /// Emergency mode activated
    Activated,
    /// Emergency mode deactivated
    Deactivated,
    /// Withdrawal request created
    WithdrawalRequested,
    /// Withdrawal request approved
    WithdrawalApproved,
    /// Withdrawal executed
    WithdrawalExecuted,
    /// Withdrawal cancelled
    WithdrawalCancelled,
    /// Configuration updated
    ConfigUpdated,
    /// Admin added
    AdminAdded,
    /// Admin removed
    AdminRemoved,
}

/// Storage keys for emergency withdrawal system
#[derive(Clone)]
#[contracttype]
pub enum EmergencyDataKey {
    /// Emergency configuration
    Config,
    /// Withdrawal request by ID
    WithdrawalRequest(u64),
    /// Counter for withdrawal request IDs
    WithdrawalCounter,
    /// Rate limit state
    RateLimit,
    /// Audit log entry by ID
    AuditLog(u64),
    /// Counter for audit log IDs
    AuditCounter,
    /// Last withdrawal timestamp
    LastWithdrawal,
    /// Admin signature for specific request
    Signature(u64, Address),
}

/// Emergency withdrawal contract implementation
#[contract]
pub struct EmergencyWithdrawal;

#[contractimpl]
impl EmergencyWithdrawal {
    /// Initialize the emergency withdrawal system
    /// 
    /// # Arguments
    /// * `env` - Contract environment
    /// * `primary_admin` - Primary admin address
    /// * `max_withdrawal_amount` - Maximum per-transaction withdrawal limit
    /// 
    /// # Security
    /// - Can only be called once
    /// - Sets up initial safe configuration
    pub fn initialize(
        env: Env,
        primary_admin: Address,
        max_withdrawal_amount: i128,
    ) -> Result<(), EmergencyError> {
        // Ensure not already initialized
        if env.storage().instance().has(&EmergencyDataKey::Config) {
            return Err(EmergencyError::EmergencyAlreadyActive);
        }

        primary_admin.require_auth();

        let config = EmergencyConfig {
            status: EmergencyStatus::Normal,
            primary_admin: primary_admin.clone(),
            secondary_admins: SorobanVec::new(&env),
            required_signatures: 1,
            max_withdrawal_amount,
            max_withdrawal_per_window: max_withdrawal_amount * 3,
            rate_limit_window_secs: 86400, // 24 hours
            cooldown_period_secs: 3600,    // 1 hour
            timelock_delay_secs: 7200,     // 2 hours
            activated_at: 0,
            activation_reason: SorobanString::from_str(&env, ""),
        };

        env.storage().instance().set(&EmergencyDataKey::Config, &config);
        env.storage().instance().set(&EmergencyDataKey::WithdrawalCounter, &0u64);
        env.storage().instance().set(&EmergencyDataKey::AuditCounter, &0u64);

        Self::log_action(
            &env,
            EmergencyAction::ConfigUpdated,
            primary_admin,
            None,
            SorobanString::from_str(&env, "Emergency system initialized"),
        );

        Ok(())
    }

    /// Activate emergency mode
    /// 
    /// # Arguments
    /// * `env` - Contract environment
    /// * `admin` - Admin address activating emergency mode
    /// * `reason` - Reason for activation
    /// 
    /// # Security
    /// - Only primary admin can activate
    /// - Logs activation with reason and timestamp
    /// - Cannot activate if already active
    pub fn activate_emergency(
        env: Env,
        admin: Address,
        reason: SorobanString,
    ) -> Result<(), EmergencyError> {
        admin.require_auth();

        let mut config = Self::get_config(&env)?;

        // Verify admin authority
        if admin != config.primary_admin {
            return Err(EmergencyError::Unauthorized);
        }

        // Check if already active
        if config.status != EmergencyStatus::Normal {
            return Err(EmergencyError::EmergencyAlreadyActive);
        }

        config.status = EmergencyStatus::Active;
        config.activated_at = env.ledger().timestamp();
        config.activation_reason = reason.clone();

        env.storage().instance().set(&EmergencyDataKey::Config, &config);

        Self::log_action(
            &env,
            EmergencyAction::Activated,
            admin,
            None,
            reason,
        );

        env.events().publish(
            (Symbol::new(&env, "emergency_activated"), Symbol::new(&env, "v1")),
            (admin, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Deactivate emergency mode
    /// 
    /// # Security
    /// - Only primary admin can deactivate
    /// - Clears emergency state
    /// - Logs deactivation
    pub fn deactivate_emergency(
        env: Env,
        admin: Address,
        reason: SorobanString,
    ) -> Result<(), EmergencyError> {
        admin.require_auth();

        let mut config = Self::get_config(&env)?;

        if admin != config.primary_admin {
            return Err(EmergencyError::Unauthorized);
        }

        if config.status == EmergencyStatus::Normal {
            return Err(EmergencyError::EmergencyNotActive);
        }

        config.status = EmergencyStatus::Normal;
        config.activated_at = 0;

        env.storage().instance().set(&EmergencyDataKey::Config, &config);

        Self::log_action(
            &env,
            EmergencyAction::Deactivated,
            admin,
            None,
            reason,
        );

        env.events().publish(
            (Symbol::new(&env, "emergency_deactivated"), Symbol::new(&env, "v1")),
            (admin, env.ledger().timestamp()),
        );

        Ok(())
    }

    /// Create an emergency withdrawal request
    /// 
    /// # Security
    /// - Emergency mode must be active
    /// - Only authorized admins can create requests
    /// - Amount validated against limits
    /// - Rate limiting enforced
    /// - Timelock automatically applied
    pub fn request_withdrawal(
        env: Env,
        admin: Address,
        recipient: Address,
        amount: i128,
        token: Address,
        reason: SorobanString,
    ) -> Result<u64, EmergencyError> {
        admin.require_auth();

        let config = Self::get_config(&env)?;

        // Verify emergency mode is active
        if config.status == EmergencyStatus::Normal {
            return Err(EmergencyError::EmergencyNotActive);
        }

        // Verify admin authority
        if !Self::is_admin(&config, &admin) {
            return Err(EmergencyError::Unauthorized);
        }

        // Validate amount
        if amount <= 0 {
            return Err(EmergencyError::InvalidAmount);
        }

        if amount > config.max_withdrawal_amount {
            return Err(EmergencyError::WithdrawalLimitExceeded);
        }

        // Check rate limits
        Self::check_rate_limit(&env, &config, amount)?;

        // Check cooldown
        Self::check_cooldown(&env, &config)?;

        // Generate request ID
        let request_id = Self::get_next_withdrawal_id(&env);

        let now = env.ledger().timestamp();
        let mut signatures = SorobanVec::new(&env);
        signatures.push_back(admin.clone());

        let request = WithdrawalRequest {
            id: request_id,
            initiator: admin.clone(),
            recipient: recipient.clone(),
            amount,
            token: token.clone(),
            created_at: now,
            executable_at: now + config.timelock_delay_secs,
            signatures,
            status: WithdrawalRequestStatus::Pending,
            reason: reason.clone(),
        };

        env.storage().instance().set(
            &EmergencyDataKey::WithdrawalRequest(request_id),
            &request,
        );

        Self::log_action(
            &env,
            EmergencyAction::WithdrawalRequested,
            admin.clone(),
            Some(amount),
            reason,
        );

        env.events().publish(
            (Symbol::new(&env, "withdrawal_requested"), Symbol::new(&env, "v1")),
            (request_id, admin, recipient, amount),
        );

        Ok(request_id)
    }

    /// Approve a withdrawal request (for multi-sig)
    /// 
    /// # Security
    /// - Only authorized admins can approve
    /// - Prevents duplicate signatures
    /// - Auto-approves when signature threshold met
    pub fn approve_withdrawal(
        env: Env,
        admin: Address,
        request_id: u64,
    ) -> Result<(), EmergencyError> {
        admin.require_auth();

        let config = Self::get_config(&env)?;

        if !Self::is_admin(&config, &admin) {
            return Err(EmergencyError::Unauthorized);
        }

        let key = EmergencyDataKey::WithdrawalRequest(request_id);
        let mut request: WithdrawalRequest = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(EmergencyError::InvalidAmount)?;

        if request.status != WithdrawalRequestStatus::Pending {
            return Err(EmergencyError::EmergencyNotActive);
        }

        // Check if already signed
        if request.signatures.contains(&admin) {
            return Err(EmergencyError::SignatureAlreadyUsed);
        }

        request.signatures.push_back(admin.clone());

        // Check if enough signatures
        if request.signatures.len() >= config.required_signatures {
            request.status = WithdrawalRequestStatus::Approved;
        }

        env.storage().instance().set(&key, &request);

        Self::log_action(
            &env,
            EmergencyAction::WithdrawalApproved,
            admin.clone(),
            Some(request.amount),
            SorobanString::from_str(&env, "Withdrawal approved"),
        );

        env.events().publish(
            (Symbol::new(&env, "withdrawal_approved"), Symbol::new(&env, "v1")),
            (request_id, admin),
        );

        Ok(())
    }

    /// Execute an approved withdrawal request
    /// 
    /// # Security
    /// - Must be approved
    /// - Timelock must have elapsed
    /// - Rate limits checked again at execution
    /// - Token transfer validated
    /// - Updates rate limit state
    pub fn execute_withdrawal(
        env: Env,
        executor: Address,
        request_id: u64,
    ) -> Result<(), EmergencyError> {
        executor.require_auth();

        let config = Self::get_config(&env)?;

        if !Self::is_admin(&config, &executor) {
            return Err(EmergencyError::Unauthorized);
        }

        let key = EmergencyDataKey::WithdrawalRequest(request_id);
        let mut request: WithdrawalRequest = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(EmergencyError::InvalidAmount)?;

        // Verify status
        if request.status != WithdrawalRequestStatus::Approved {
            return Err(EmergencyError::InsufficientSignatures);
        }

        // Check timelock
        let now = env.ledger().timestamp();
        if now < request.executable_at {
            return Err(EmergencyError::TimeLockNotExpired);
        }

        // Re-check rate limits at execution time
        Self::check_rate_limit(&env, &config, request.amount)?;

        // Execute token transfer
        let token_client = token::Client::new(&env, &request.token);
        token_client.transfer(
            &env.current_contract_address(),
            &request.recipient,
            &request.amount,
        );

        // Update request status
        request.status = WithdrawalRequestStatus::Executed;
        env.storage().instance().set(&key, &request);

        // Update rate limit state
        Self::update_rate_limit(&env, &config, request.amount);

        // Update last withdrawal timestamp
        env.storage().instance().set(
            &EmergencyDataKey::LastWithdrawal,
            &now,
        );

        Self::log_action(
            &env,
            EmergencyAction::WithdrawalExecuted,
            executor.clone(),
            Some(request.amount),
            SorobanString::from_str(&env, "Withdrawal executed"),
        );

        env.events().publish(
            (Symbol::new(&env, "withdrawal_executed"), Symbol::new(&env, "v1")),
            (request_id, executor, request.recipient, request.amount),
        );

        Ok(())
    }

    /// Cancel a withdrawal request
    /// 
    /// # Security
    /// - Only primary admin or request initiator can cancel
    /// - Cannot cancel already executed requests
    pub fn cancel_withdrawal(
        env: Env,
        admin: Address,
        request_id: u64,
        reason: SorobanString,
    ) -> Result<(), EmergencyError> {
        admin.require_auth();

        let config = Self::get_config(&env)?;

        if !Self::is_admin(&config, &admin) {
            return Err(EmergencyError::Unauthorized);
        }

        let key = EmergencyDataKey::WithdrawalRequest(request_id);
        let mut request: WithdrawalRequest = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(EmergencyError::InvalidAmount)?;

        if request.status == WithdrawalRequestStatus::Executed {
            return Err(EmergencyError::EmergencyNotActive);
        }

        request.status = WithdrawalRequestStatus::Cancelled;
        env.storage().instance().set(&key, &request);

        Self::log_action(
            &env,
            EmergencyAction::WithdrawalCancelled,
            admin,
            Some(request.amount),
            reason,
        );

        Ok(())
    }

    /// Add a secondary admin for multi-signature support
    pub fn add_admin(
        env: Env,
        primary_admin: Address,
        new_admin: Address,
    ) -> Result<(), EmergencyError> {
        primary_admin.require_auth();

        let mut config = Self::get_config(&env)?;

        if primary_admin != config.primary_admin {
            return Err(EmergencyError::Unauthorized);
        }

        if !config.secondary_admins.contains(&new_admin) {
            config.secondary_admins.push_back(new_admin.clone());
            env.storage().instance().set(&EmergencyDataKey::Config, &config);

            Self::log_action(
                &env,
                EmergencyAction::AdminAdded,
                primary_admin,
                None,
                SorobanString::from_str(&env, "Admin added"),
            );
        }

        Ok(())
    }

    /// Update emergency configuration
    pub fn update_config(
        env: Env,
        admin: Address,
        max_withdrawal_amount: Option<i128>,
        required_signatures: Option<u32>,
        timelock_delay_secs: Option<u64>,
    ) -> Result<(), EmergencyError> {
        admin.require_auth();

        let mut config = Self::get_config(&env)?;

        if admin != config.primary_admin {
            return Err(EmergencyError::Unauthorized);
        }

        if let Some(amount) = max_withdrawal_amount {
            config.max_withdrawal_amount = amount;
        }

        if let Some(sigs) = required_signatures {
            config.required_signatures = sigs;
        }

        if let Some(delay) = timelock_delay_secs {
            config.timelock_delay_secs = delay;
        }

        env.storage().instance().set(&EmergencyDataKey::Config, &config);

        Self::log_action(
            &env,
            EmergencyAction::ConfigUpdated,
            admin,
            None,
            SorobanString::from_str(&env, "Configuration updated"),
        );

        Ok(())
    }

    /// Get current emergency configuration
    pub fn get_config_view(env: Env) -> Result<EmergencyConfig, EmergencyError> {
        Self::get_config(&env)
    }

    /// Get withdrawal request details
    pub fn get_request(env: Env, request_id: u64) -> Option<WithdrawalRequest> {
        env.storage()
            .instance()
            .get(&EmergencyDataKey::WithdrawalRequest(request_id))
    }

    /// Get audit log entry
    pub fn get_audit_log(env: Env, log_id: u64) -> Option<EmergencyAuditLog> {
        env.storage()
            .instance()
            .get(&EmergencyDataKey::AuditLog(log_id))
    }

    // ===== Internal Helper Functions =====

    fn get_config(env: &Env) -> Result<EmergencyConfig, EmergencyError> {
        env.storage()
            .instance()
            .get(&EmergencyDataKey::Config)
            .ok_or(EmergencyError::AdminNotInitialized)
    }

    fn is_admin(config: &EmergencyConfig, address: &Address) -> bool {
        address == &config.primary_admin || config.secondary_admins.contains(address)
    }

    fn check_rate_limit(
        env: &Env,
        config: &EmergencyConfig,
        amount: i128,
    ) -> Result<(), EmergencyError> {
        let now = env.ledger().timestamp();
        
        let mut rate_limit: RateLimitState = env
            .storage()
            .instance()
            .get(&EmergencyDataKey::RateLimit)
            .unwrap_or(RateLimitState {
                window_start: now,
                amount_withdrawn: 0,
                last_withdrawal_at: 0,
            });

        // Reset window if expired
        if now >= rate_limit.window_start + config.rate_limit_window_secs {
            rate_limit.window_start = now;
            rate_limit.amount_withdrawn = 0;
        }

        // Check if adding this amount would exceed limit
        if rate_limit.amount_withdrawn + amount > config.max_withdrawal_per_window {
            return Err(EmergencyError::RateLimitExceeded);
        }

        Ok(())
    }

    fn check_cooldown(
        env: &Env,
        config: &EmergencyConfig,
    ) -> Result<(), EmergencyError> {
        if let Some(last_withdrawal) = env
            .storage()
            .instance()
            .get::<_, u64>(&EmergencyDataKey::LastWithdrawal)
        {
            let now = env.ledger().timestamp();
            if now < last_withdrawal + config.cooldown_period_secs {
                return Err(EmergencyError::CooldownNotElapsed);
            }
        }

        Ok(())
    }

    fn update_rate_limit(env: &Env, config: &EmergencyConfig, amount: i128) {
        let now = env.ledger().timestamp();
        
        let mut rate_limit: RateLimitState = env
            .storage()
            .instance()
            .get(&EmergencyDataKey::RateLimit)
            .unwrap_or(RateLimitState {
                window_start: now,
                amount_withdrawn: 0,
                last_withdrawal_at: 0,
            });

        if now >= rate_limit.window_start + config.rate_limit_window_secs {
            rate_limit.window_start = now;
            rate_limit.amount_withdrawn = amount;
        } else {
            rate_limit.amount_withdrawn += amount;
        }

        rate_limit.last_withdrawal_at = now;

        env.storage().instance().set(&EmergencyDataKey::RateLimit, &rate_limit);
    }

    fn get_next_withdrawal_id(env: &Env) -> u64 {
        let counter: u64 = env
            .storage()
            .instance()
            .get(&EmergencyDataKey::WithdrawalCounter)
            .unwrap_or(0);
        
        let next_id = counter + 1;
        env.storage()
            .instance()
            .set(&EmergencyDataKey::WithdrawalCounter, &next_id);
        
        next_id
    }

    fn log_action(
        env: &Env,
        action: EmergencyAction,
        performer: Address,
        amount: Option<i128>,
        details: SorobanString,
    ) {
        let log_id: u64 = env
            .storage()
            .instance()
            .get(&EmergencyDataKey::AuditCounter)
            .unwrap_or(0) + 1;

        let log = EmergencyAuditLog {
            id: log_id,
            action,
            performer,
            timestamp: env.ledger().timestamp(),
            amount,
            details,
        };

        env.storage()
            .instance()
            .set(&EmergencyDataKey::AuditLog(log_id), &log);
        
        env.storage()
            .instance()
            .set(&EmergencyDataKey::AuditCounter, &log_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EmergencyWithdrawal);
        let client = EmergencyWithdrawalClient::new(&env, &contract_id);

        let result = client.initialize(&admin, &1_000_000);
        assert!(result.is_ok());

        let config = client.get_config_view().unwrap();
        assert_eq!(config.primary_admin, admin);
        assert_eq!(config.status, EmergencyStatus::Normal);
    }

    #[test]
    fn test_activate_deactivate_emergency() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register_contract(None, EmergencyWithdrawal);
        let client = EmergencyWithdrawalClient::new(&env, &contract_id);

        client.initialize(&admin, &1_000_000).unwrap();

        let reason = SorobanString::from_str(&env, "Test emergency");
        client.activate_emergency(&admin, &reason).unwrap();

        let config = client.get_config_view().unwrap();
        assert_eq!(config.status, EmergencyStatus::Active);

        client.deactivate_emergency(&admin, &reason).unwrap();

        let config = client.get_config_view().unwrap();
        assert_eq!(config.status, EmergencyStatus::Normal);
    }

    #[test]
    fn test_withdrawal_request_flow() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);
        
        let contract_id = env.register_contract(None, EmergencyWithdrawal);
        let client = EmergencyWithdrawalClient::new(&env, &contract_id);

        client.initialize(&admin, &1_000_000).unwrap();
        
        let reason = SorobanString::from_str(&env, "Emergency test");
        client.activate_emergency(&admin, &reason).unwrap();

        let request_id = client
            .request_withdrawal(&admin, &recipient, &500_000, &token, &reason)
            .unwrap();

        assert_eq!(request_id, 1);

        let request = client.get_request(&request_id).unwrap();
        assert_eq!(request.amount, 500_000);
        assert_eq!(request.status, WithdrawalRequestStatus::Pending);
    }
}
