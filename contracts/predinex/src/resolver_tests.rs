//! Malformed resolution-spec commitment coverage — Issue #1599.
//!
//! The resolver validates a spec's salt and network id *before* it writes any
//! registration state. A malformed commitment must revert with a typed error
//! and leave both the registration counter and the per-market spec untouched.
//!
//! The resolver registry used here is a test-only contract: this crate does not
//! ship an on-chain resolver entrypoint, so the regression harness models the
//! registration boundary the issue describes.

#![cfg(test)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, testutils::Address as _, Address, BytesN,
    Env, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum ResolverError {
    InvalidSalt = 1,
    InvalidNetworkId = 2,
    AlreadyRegistered = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolutionSpec {
    market_id: u32,
    salt: BytesN<32>,
    network_id: String,
}

#[contracttype]
#[derive(Clone)]
enum ResolverKey {
    Spec(u32),
    Count,
}

#[contract]
struct ResolutionSpecResolver;

#[contractimpl]
impl ResolutionSpecResolver {
    /// Register a resolution spec after validating its commitment fields.
    /// Validation intentionally runs before *any* storage write so an invalid
    /// spec cannot leave partial market state behind.
    pub fn register(env: Env, caller: Address, spec: ResolutionSpec) -> Result<(), ResolverError> {
        caller.require_auth();

        let salt = spec.salt.to_array();
        if !salt.iter().any(|byte| *byte != 0) {
            return Err(ResolverError::InvalidSalt);
        }

        let public = String::from_str(&env, "public");
        let testnet = String::from_str(&env, "testnet");
        if spec.network_id != public && spec.network_id != testnet {
            return Err(ResolverError::InvalidNetworkId);
        }

        if env
            .storage()
            .persistent()
            .has(&ResolverKey::Spec(spec.market_id))
        {
            return Err(ResolverError::AlreadyRegistered);
        }

        let count: u32 = env
            .storage()
            .persistent()
            .get(&ResolverKey::Count)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&ResolverKey::Spec(spec.market_id), &spec);
        env.storage()
            .persistent()
            .set(&ResolverKey::Count, &(count.checked_add(1).unwrap()));
        Ok(())
    }

    pub fn is_registered(env: Env, market_id: u32) -> bool {
        env.storage()
            .persistent()
            .has(&ResolverKey::Spec(market_id))
    }

    pub fn registration_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&ResolverKey::Count)
            .unwrap_or(0)
    }

    pub fn get_spec(env: Env, market_id: u32) -> Option<ResolutionSpec> {
        env.storage()
            .persistent()
            .get(&ResolverKey::Spec(market_id))
    }
}

struct ResolverCtx {
    env: Env,
    client: ResolutionSpecResolverClient<'static>,
    caller: Address,
}

impl ResolverCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(ResolutionSpecResolver, ());
        let client = ResolutionSpecResolverClient::new(&env, &id);
        let caller = Address::generate(&env);
        ResolverCtx {
            env,
            client,
            caller,
        }
    }

    fn spec(&self, market_id: u32, salt_byte: u8, network: &str) -> ResolutionSpec {
        ResolutionSpec {
            market_id,
            salt: BytesN::from_array(&self.env, &[salt_byte; 32]),
            network_id: String::from_str(&self.env, network),
        }
    }
}

#[test]
fn resolver_accepts_a_well_formed_spec_commitment() {
    let ctx = ResolverCtx::new();
    let spec = ctx.spec(1, 0xAB, "public");

    ctx.client.register(&ctx.caller, &spec);

    assert_eq!(ctx.client.registration_count(), 1);
    assert!(ctx.client.is_registered(&1));
    assert_eq!(ctx.client.get_spec(&1), Some(spec));
}

#[test]
fn resolver_rejects_invalid_salt_before_mutating_market_state() {
    let ctx = ResolverCtx::new();
    // Seed one valid registration so we can prove an invalid spec does not
    // touch either the counter or any per-market state.
    ctx.client
        .register(&ctx.caller, &ctx.spec(1, 0xAB, "testnet"));

    let bad_salt = ctx.spec(2, 0, "testnet");
    let result = ctx.client.try_register(&ctx.caller, &bad_salt);
    assert_eq!(result, Err(Ok(ResolverError::InvalidSalt)));

    assert_eq!(ctx.client.registration_count(), 1);
    assert!(!ctx.client.is_registered(&2));
    assert_eq!(ctx.client.get_spec(&2), None);
}

#[test]
fn resolver_rejects_invalid_network_id_before_mutating_market_state() {
    let ctx = ResolverCtx::new();
    let bad_network = ctx.spec(7, 0xAB, "not-a-stellar-network");

    let result = ctx.client.try_register(&ctx.caller, &bad_network);
    assert_eq!(result, Err(Ok(ResolverError::InvalidNetworkId)));

    assert_eq!(ctx.client.registration_count(), 0);
    assert!(!ctx.client.is_registered(&7));
    assert_eq!(ctx.client.get_spec(&7), None);
}

#[test]
fn resolver_registration_succeeds_after_both_malformed_attempts() {
    let ctx = ResolverCtx::new();

    assert_eq!(
        ctx.client
            .try_register(&ctx.caller, &ctx.spec(9, 0, "public")),
        Err(Ok(ResolverError::InvalidSalt))
    );
    assert_eq!(
        ctx.client
            .try_register(&ctx.caller, &ctx.spec(9, 0xAB, "unknown")),
        Err(Ok(ResolverError::InvalidNetworkId))
    );
    assert_eq!(ctx.client.registration_count(), 0);

    let valid = ctx.spec(9, 0xAB, "public");
    ctx.client.register(&ctx.caller, &valid);
    assert_eq!(ctx.client.registration_count(), 1);
    assert_eq!(ctx.client.get_spec(&9), Some(valid));
}
