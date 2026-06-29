// src/pool.rs
//! High-performance, tiered-fee pool contract for Soroban.
//!
//! Supports volume-based fee tiers, a fallback flat fee, and optional fee manager delegation.
//! All operations are fully validated and emit structured events for off-chain indexing

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, log, vec, Env, Address, Vec, Symbol,
};

/// Maximum number of fee tiers allowed by governance.
const MAX_TIERS: u32 = 5;
/// Basis points denominator (100% = 10000 bps).
pub const BPS_DENOMINATOR: u32 = 10_000;
/// Maximum allowed fee in basis points.
pub const MAX_FEE_BPS: u32 = BPS_DENOMINATOR;

/// Contract error codes – each variant is explicit and self‑documenting.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    /// Contract is already initialized.
    AlreadyInitialized = 1,
    /// Fee tier thresholds are invalid – unsorted, duplicate, or negative.
    InvalidTierThresholds = 2,
    /// More than the maximum allowed number of fee tiers.
    TooManyTiers = 3,
    /// Fee basis points value is out of range (0–10000).
    InvalidFeeBps = 4,
    /// Fee manager contract address is not set when required.
    FeeManagerNotSet = 5,
    /// Volume cannot be negative.
    NegativeVolume = 6,
    /// Contract not yet initialized.
    NotInitialized = 7,
}

/// A single fee tier: a volume threshold and the corresponding fee in bps.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct FeeTier {
    /// Minimum volume (in units of the traded asset) that must be met to activate this tier.
    pub volume_threshold: i128,
    /// Fee in basis points (0–10000) applied when volume meets or exceeds this threshold.
    pub fee_bps: u32,
}

/// Contract storage key enum – ensures type‑safe access to persistent state.
#[derive(Clone, Debug)]
#[contracttype]
pub enum DataKey {
    /// Whether the contract has been initialized.
    Initialized,
    /// Default flat fee in bps (fallback when no tier matches).
    DefaultBps,
    /// Address of the fee manager contract (optional delegation).
    FeeManager,
    /// List of fee tiers stored in ascending order of `volume_threshold`.
    FeeTiers,
}

/// The pool contract supporting both a flat default fee and volume‑based tiered fees.
#[contract]
pub struct Pool;

#[contractimpl]
impl Pool {
    // ──────────────────────────────────────────────
    // Initialization
    // ──────────────────────────────────────────────

    /// Initialize the pool with a default flat fee.
    ///
    /// Can only be called once. Emits no event (event emission is the caller's responsibility).
    ///
    /// # Arguments
    ///
    /// * `default_bps` – Default fee in basis points (0–10000).
    ///
    /// # Errors
    ///
    /// * `PoolError::AlreadyInitialized` – if the contract is already initialized.
    /// * `PoolError::InvalidFeeBps` – if `default_bps` is greater than 10000.
    ///
    /// # Events
    ///
    /// None.
    pub fn initialize(env: Env, default_bps: u32) -> Result<(), PoolError> {
        // ── Guard: prevent re‑initialization ──
        if env.storage().instance().has(&DataKey::Initialized) {
            log!(&env, "error", "Contract already initialized");
            return Err(PoolError::AlreadyInitialized);
        }

        // ── Validate fee ──
        if default_bps > MAX_FEE_BPS {
            log!(
                &env,
                "error",
                "Invalid default fee: {} bps (max {})",
                default_bps,
                MAX_FEE_BPS
            );
            return Err(PoolError::InvalidFeeBps);
        }

        // ── Write state ──
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::DefaultBps, &default_bps);
        env.storage()
            .instance()
            .set(&DataKey::FeeTiers, &Vec::new(&env));

        log!(&env, "info", "Pool initialized with default fee: {} bps", default_bps);
        Ok(())
    }

    /// Ensure the contract has been initialized. Calling from public functions that require it.
    fn check_initialized(env: &Env) -> Result<(), PoolError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            log!(&env, "error", "Contract not initialized");
            return Err(PoolError::NotInitialized);
        }
        Ok(())
    }

    // ──────────────────────────────────────────────
    // Fee manager (optional delegation)
    // ──────────────────────────────────────────────

    /// Set the fee manager contract address. Pass `None` to clear the delegate.
    ///
    /// # Arguments
    ///
    /// * `fee_manager` – Optional address of the fee manager contract.
    ///
    /// # Events
    ///
    /// Emits `fee_manager_updated` with the new value.
    pub fn set_fee_manager(env: Env, fee_manager: Option<Address>) {
        env.storage()
            .instance()
            .set(&DataKey::FeeManager, &fee_manager);

        let event_payload = (Symbol::new(&env, "fee_manager_updated"), fee_manager.clone());
        env.events().publish(event_payload);

        log!(&env, "info", "Fee manager set to {:?}", fee_manager);
    }

    /// Retrieve the current fee manager address.
    ///
    /// # Returns
    ///
    /// `Option<Address>` – The fee manager address, or `None` if not set.
    pub fn fee_manager(env: &Env) -> Option<Address> {
        env.storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::FeeManager)
            .unwrap_or(None)
    }

    // ──────────────────────────────────────────────
    // Default fee accessor
    // ──────────────────────────────────────────────

    /// Get the default flat fee in bps.
    ///
    /// # Returns
    ///
    /// `u32` – The default fee in basis points. Returns `0` if contract is not initialized.
    pub fn default_bps(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::DefaultBps)
            .unwrap_or(0)
    }

    // ──────────────────────────────────────────────
    // Fee tiers
    // ──────────────────────────────────────────────

    /// Retrieve the current list of fee tiers.
    ///
    /// # Returns
    ///
    /// `Vec<FeeTier>` – Sorted list of tiers. Empty if no tiers configured.
    pub fn fee_tiers(env: &Env) -> Vec<FeeTier> {
        env.storage()
            .instance()
            .get::<_, Vec<FeeTier>>(&DataKey::FeeTiers)
            .unwrap_or(Vec::new(env))
    }

    /// Set volume‑based fee tiers.
    ///
    /// Replaces any existing tiers. Validates:
    /// - At most 5 tiers.
    /// - Tiers are sorted by `volume_threshold` in strictly increasing order (no duplicates).
    /// - Each `fee_bps` is in the range 0–10000.
    /// - Thresholds are non‑negative.
    ///
    /// # Arguments
    ///
    /// * `tiers` – A vector of `FeeTier` structs to store.
    ///
    /// # Errors
    ///
    /// * `PoolError::NotInitialized` – if the contract has not been initialized.
    /// * `PoolError::TooManyTiers` – if more than 5 tiers are provided.
    /// * `PoolError::InvalidFeeBps` – if any fee exceeds 10000.
    /// * `PoolError::InvalidTierThresholds` – if thresholds are negative, unsorted, or duplicate.
    ///
    /// # Events
    ///
    /// Emits `fee_tiers_updated` with the new list of tiers.
    pub fn set_volume_fee_tiers(env: Env, tiers: Vec<FeeTier>) -> Result<(), PoolError> {
        Self::check_initialized(&env)?;

        // ── Validate count ──
        if tiers.len() > MAX_TIERS {
            log!(
                &env,
                "error",
                "Too many fee tiers: {} (max {})",
                tiers.len(),
                MAX_TIERS
            );
            return Err(PoolError::TooManyTiers);
        }

        // ── Validate each tier ──
        let mut prev_threshold: Option<i128> = None;
        for (idx, tier) in tiers.iter().enumerate() {
            // Validate fee bps
            if tier.fee_bps > MAX_FEE_BPS {
                log!(
                    &env,
                    "error",
                    "Tier {}: invalid fee bps: {} (max {})",
                    idx,
                    tier.fee_bps,
                    MAX_FEE_BPS
                );
                return Err(PoolError::InvalidFeeBps);
            }

            // Validate threshold non‑negative
            if tier.volume_threshold < 0 {
                log!(
                    &env,
                    "error",
                    "Tier {}: negative threshold: {}",
                    idx,
                    tier.volume_threshold
                );
                return Err(PoolError::InvalidTierThresholds);
            }

            // Validate strictly increasing order
            if let Some(prev) = prev_threshold {
                if tier.volume_threshold <= prev {
                    log!(
                        &env,
                        "error",
                        "Tier {}: threshold {} not greater than previous {}",
                        idx,
                        tier.volume_threshold,
                        prev
                    );
                    return Err(PoolError::InvalidTierThresholds);
                }
            }
            prev_threshold = Some(tier.volume_threshold);
        }

        // ── Store tiers ──
        env.storage().instance().set(&DataKey::FeeTiers, &tiers);

        // ── Emit event ──
        let event_payload = (Symbol::new(&env, "fee_tiers_updated"), tiers.clone());
        env.events().publish(event_payload);

        log!(&env, "info", "Fee tiers updated (count: {})", tiers.len());
        Ok(())
    }

    // ──────────────────────────────────────────────
    // Fee computation (applied at settlement)
    // ─────────���────────────────────────────────────

    /// Compute the fee in basis points for a given volume, using the configured tiered logic.
    ///
    /// The algorithm:
    /// 1. If no tiers are configured, returns the default fee.
    /// 2. Iterates tiers from highest threshold to lowest; returns the fee of the first tier
    ///    whose threshold is ≤ volume. This gives the correct tier for volumes that meet or
    ///    exceed a threshold (higher thresholds take precedence).
    /// 3. If no tier matches (volume below the first tier’s threshold), returns the default fee.
    /// 4. Negative volume triggers an error.
    ///
    /// # Arguments
    ///
    /// * `volume` – The traded volume (must be ≥ 0).
    ///
    /// # Returns
    ///
    /// `Result<u32, PoolError>` – The applicable fee in basis points, or an error.
    ///
    /// # Errors
    ///
    /// * `PoolError::NotInitialized` – if the contract has not been initialized.
    /// * `PoolError::NegativeVolume` – if `volume` is negative.
    pub fn compute_fee_for_volume(env: &Env, volume: i128) -> Result<u32, PoolError> {
        Self::check_initialized(env)?;

        if volume < 0 {
            log!(&env, "error", "Negative volume: {}", volume);
            return Err(PoolError::NegativeVolume);
        }

        // Get default fee (safe to unwrap because initialized)
        let default_fee: u32 = env
            .storage()
            .instance()
            .get(&DataKey::DefaultBps)
            .unwrap_or(0);

        // Get tiers (empty if none configured)
        let tiers: Vec<FeeTier> = env
            .storage()
            .instance()
            .get(&DataKey::FeeTiers)
            .unwrap_or(Vec::new(env));

        // ── Iterate tiers in reverse order (highest threshold first) ──
        for tier in tiers.iter().rev() {
            if volume >= tier.volume_threshold {
                log!(
                    &env,
                    "info",
                    "Fee tier matched: threshold={}, fee_bps={}",
                    tier.volume_threshold,
                    tier.fee_bps
                );
                return Ok(tier.fee_bps);
            }
        }

        // No tier matched → fallback to default
        log!(&env, "info", "No tier matched, using default fee: {} bps", default_fee);
        Ok(default_fee)
    }
}