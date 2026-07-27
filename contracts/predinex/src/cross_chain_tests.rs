//! Tests for the cross-chain pool mirroring system — Issue #716
//!
//! Coverage:
//!  - create pool mirror
//!  - settle mirror from source chain
//!  - duplicate mirror creation rejected
//!  - bridge timeout enforcement
//!  - config: bridge timeout and dispute window
//!  - view functions for mirror and unified ID

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

struct CrossChainCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    admin: Address,
    token_id: Address,
}

impl CrossChainCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_asset = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_id = token_asset.address();
        client.initialize(&token_id, &token_admin, &token_admin);

        CrossChainCtx {
            env,
            client,
            admin: token_admin,
            token_id,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        let sac = StellarAssetClient::new(&self.env, &self.token_id);
        sac.mint(to, &amount);
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Cross-Chain Pool"),
            &String::from_str(&self.env, "A cross-chain mirrored pool"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3_600,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }
}

#[test]
fn test_create_pool_mirror() {
    let ctx = CrossChainCtx::new();
    let pool_id = ctx.create_pool(&ctx.admin);
    let bridge = Address::generate(&ctx.env);

    let unified_id = ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Ethereum,
        &bridge,
    );

    assert_eq!(unified_id, 1);

    let mirror = ctx.client.get_pool_mirror(&pool_id).unwrap();
    assert_eq!(mirror.source_pool_id, pool_id);
    assert_eq!(mirror.unified_pool_id, 1);
    assert_eq!(mirror.source_chain, ChainId::Stellar);
    assert_eq!(mirror.target_chain, ChainId::Ethereum);
    assert!(!mirror.is_settled);
}

#[test]
fn test_mirror_by_unified_id() {
    let ctx = CrossChainCtx::new();
    let pool_id = ctx.create_pool(&ctx.admin);
    let bridge = Address::generate(&ctx.env);

    let unified_id = ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Polygon,
        &bridge,
    );

    let mirror = ctx.client.get_mirror_by_unified_id(&unified_id).unwrap();
    assert_eq!(mirror.source_pool_id, pool_id);
    assert_eq!(mirror.target_chain, ChainId::Polygon);
}

#[test]
#[should_panic(expected = "Error(Contract, #69)")]
fn test_duplicate_mirror_rejected() {
    let ctx = CrossChainCtx::new();
    let pool_id = ctx.create_pool(&ctx.admin);
    let bridge = Address::generate(&ctx.env);

    ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Ethereum,
        &bridge,
    );
    // Second mirror for same pool should fail
    ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Polygon,
        &bridge,
    );
}

#[test]
fn test_settle_mirror_from_source() {
    let ctx = CrossChainCtx::new();
    let pool_id = ctx.create_pool(&ctx.admin);
    let bridge = Address::generate(&ctx.env);

    ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Ethereum,
        &bridge,
    );

    ctx.client
        .settle_mirror_from_source(&ctx.admin, &pool_id, &0);

    let mirror = ctx.client.get_pool_mirror(&pool_id).unwrap();
    assert!(mirror.is_settled);
    assert_eq!(mirror.winning_outcome, Some(0));
}

#[test]
fn test_set_bridge_timeout() {
    let ctx = CrossChainCtx::new();
    ctx.client.set_bridge_timeout(&ctx.admin, &7200);
    assert_eq!(ctx.client.get_bridge_timeout(), 7200);
}

#[test]
fn test_set_cross_chain_dispute_window() {
    let ctx = CrossChainCtx::new();
    ctx.client
        .set_cross_chain_dispute_window(&ctx.admin, &172_800);
    assert_eq!(ctx.client.get_cross_chain_dispute_window(), 172_800);
}

#[test]
#[should_panic(expected = "Error(Contract, #72)")]
fn test_bridge_timeout_exceeded() {
    let ctx = CrossChainCtx::new();
    let pool_id = ctx.create_pool(&ctx.admin);
    let bridge = Address::generate(&ctx.env);

    ctx.client.set_bridge_timeout(&ctx.admin, &3600);
    ctx.client.create_pool_mirror(
        &ctx.admin,
        &pool_id,
        &ChainId::Stellar,
        &ChainId::Ethereum,
        &bridge,
    );

    // Advance time past bridge timeout
    ctx.env.ledger().with_mut(|l| l.timestamp = 10_000);

    ctx.client
        .settle_mirror_from_source(&ctx.admin, &pool_id, &0);
}

#[test]
fn test_default_bridge_timeout() {
    let ctx = CrossChainCtx::new();
    assert_eq!(ctx.client.get_bridge_timeout(), 86_400); // 24 hours
}

#[test]
fn test_default_cross_chain_dispute_window() {
    let ctx = CrossChainCtx::new();
    let expected = 7 * 24 * 3600u64; // 7 days = DISPUTE_WINDOW_SECS
    assert_eq!(ctx.client.get_cross_chain_dispute_window(), expected);
}
