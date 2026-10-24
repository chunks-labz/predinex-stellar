#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReferralError {
    InvalidAddress = 1,
    AlreadyRecorded = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Referral(Address),
}

#[contract]
pub struct Referral;

#[contractimpl]
impl Referral {
    /// Records an immutable referrer for a user and emits an auditable event.
    pub fn record_referral(env: Env, referrer: Address, referred: Address) {
        if referrer == referred {
            panic_with_error!(&env, ReferralError::InvalidAddress);
        }
        referred.require_auth();
        let key = DataKey::Referral(referred.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, ReferralError::AlreadyRecorded);
        }
        env.storage().persistent().set(&key, &referrer);
        env.events().publish(
            (Symbol::new(&env, "referral_recorded"), referred),
            referrer,
        );
    }

    pub fn get_referrer(env: Env, referred: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Referral(referred))
    }
}
