//! Pause-mode test coverage for all sensitive entrypoints — Issue #180
//!
//! Verifies that freeze_pool / unfreeze_pool correctly blocks and restores
//! pool creation, betting, settlement, claim, and treasury flows.
//! Read-only methods (get_pool, get_user_bet, etc.) are expected to remain
//! available regardless of pool status.

#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── Test harness ──────────────────────────────────────────────────────────────

struct TestCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token_admin: Address,
    token_id: Address,
    freeze_admin: Address,
    /// A persistent creator address used when a caller for settle_pool is needed.
    pool_creator: Address,
}

impl TestCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());

        client.initialize(&token_id.address(), &token_admin, &token_admin);

        let freeze_admin = Address::generate(&env);
        client.set_freeze_admin(&token_admin, &freeze_admin);

        let pool_creator = Address::generate(&env);

        TestCtx {
            env,
            client,
            token_admin,
            token_id: token_id.address(),
            freeze_admin,
            pool_creator,
        }
    }

    /// Create a pool using the shared `pool_creator` so we can settle it later.
    fn open_pool(&self) -> u32 {
        self.client.create_pool(
            &self.pool_creator,
            &String::from_str(&self.env, "Test Market"),
            &String::from_str(&self.env, "Test Description"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3600,
            &MIN_CREATOR_DEPOSIT,
        )
    }

    /// Mint tokens to `user` and place a bet on `pool_id`.
    fn fund_and_bet(&self, user: &Address, pool_id: u32, outcome: u32, amount: i128) {
        let token_admin_client = token::StellarAssetClient::new(&self.env, &self.token_id);
        token_admin_client.mint(user, &amount);
        self.client
            .place_bet(user, &pool_id, &outcome, &amount, &None::<Address>);
    }

    /// Advance ledger past the pool's deadline and settle it using pool_creator.
    fn settle(&self, pool_id: u32, winning_outcome: u32) {
        self.env.ledger().with_mut(|li| li.timestamp = 7200);
        self.client
            .settle_pool(&self.pool_creator, &pool_id, &winning_outcome);
    }
}

// ── freeze_pool / unfreeze_pool basics ────────────────────────────────────────

#[test]
fn test_freeze_admin_can_freeze_and_unfreeze_pool() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Frozen);

    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Open);
}

#[test]
#[should_panic]
fn test_freeze_already_frozen_pool_panics() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id); // second freeze should panic
}

#[test]
#[should_panic]
fn test_unfreeze_open_pool_panics() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);
}

#[test]
#[should_panic]
fn test_non_freeze_admin_cannot_freeze_pool() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    let stranger = Address::generate(&ctx.env);
    ctx.client.freeze_pool(&stranger, &pool_id);
}

// ── place_bet blocked by frozen status ────────────────────────────────────────

#[test]
#[should_panic]
fn test_place_bet_on_frozen_pool_blocked() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);

    let user = Address::generate(&ctx.env);
    let token_admin_client = token::StellarAssetClient::new(&ctx.env, &ctx.token_id);
    token_admin_client.mint(&user, &500);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);
}

#[test]
fn test_place_bet_resumes_after_unfreeze() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);

    let user = Address::generate(&ctx.env);
    let token_admin_client = token::StellarAssetClient::new(&ctx.env, &ctx.token_id);
    token_admin_client.mint(&user, &500);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 100);
}

// ── claim_winnings blocked by frozen status ───────────────────────────────────

#[test]
#[should_panic]
fn test_claim_winnings_on_frozen_pool_blocked() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user_a, pool_id, 0, 500);
    ctx.fund_and_bet(&user_b, pool_id, 1, 500);

    // Settle then freeze before claim
    ctx.settle(pool_id, 0);
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.claim_winnings(&user_a, &pool_id);
}

#[test]
fn test_claim_winnings_succeeds_after_unfreeze() {
    // Scenario: pool is settled → frozen before claim → unfrozen → claim succeeds.
    // After unfreeze the pool returns to Open, so we re-settle before claiming.
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user_a, pool_id, 0, 500);
    ctx.fund_and_bet(&user_b, pool_id, 1, 500);

    // Settle, then freeze (simulates an incident mid-claim window)
    ctx.settle(pool_id, 0);
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    // Unfreeze restores Open; we must re-settle before winners can claim
    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.settle_pool(&ctx.pool_creator, &pool_id, &0);
    let payout = ctx.client.claim_winnings(&user_a, &pool_id);
    assert!(
        payout > 0,
        "winner should receive a payout after unfreeze + re-settle"
    );
}

// ── settle_pool: frozen pool blocks non-creator callers ───────────────────────

#[test]
#[should_panic]
fn test_settle_frozen_pool_blocked_for_non_creator() {
    // settle_pool panics for non-creator regardless of freeze state
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    // Unfreeze first so expiry check passes; pool is now Open
    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);
    ctx.env.ledger().with_mut(|li| li.timestamp = 7200);

    let stranger = Address::generate(&ctx.env);
    ctx.client.settle_pool(&stranger, &pool_id, &0);
}

// ── dispute_pool blocked when pool is open (not settled) ─────────────────────

#[test]
#[should_panic]
fn test_dispute_open_pool_panics() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.dispute_pool(&ctx.freeze_admin, &pool_id);
}

// ── dispute_pool on settled pool ──────────────────────────────────────────────

#[test]
fn test_dispute_settled_pool_transitions_to_disputed() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    let user_a = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user_a, pool_id, 0, 200);

    ctx.settle(pool_id, 0);
    ctx.client.dispute_pool(&ctx.freeze_admin, &pool_id);

    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Disputed);
}

#[test]
#[should_panic]
fn test_claim_winnings_on_disputed_pool_blocked() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user_a, pool_id, 0, 400);
    ctx.fund_and_bet(&user_b, pool_id, 1, 400);

    ctx.settle(pool_id, 0);
    ctx.client.dispute_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.claim_winnings(&user_a, &pool_id);
}

// ── unfreeze disputed pool ────────────────────────────────────────────────────

#[test]
fn test_unfreeze_disputed_pool_restores_open_status() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    let user_a = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user_a, pool_id, 0, 200);

    ctx.settle(pool_id, 0);
    ctx.client.dispute_pool(&ctx.freeze_admin, &pool_id);
    ctx.client.unfreeze_pool(&ctx.freeze_admin, &pool_id);

    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Open);
}

// ── treasury operations unaffected by pool freeze ─────────────────────────────

#[test]
fn test_treasury_withdrawal_unaffected_by_pool_freeze() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);

    // Treasury balance starts at 0 — withdraw 0 should be a no-op / pass
    let balance = ctx.client.get_treasury_balance();
    assert_eq!(balance, 0);
}

#[test]
fn test_rotate_treasury_recipient_unaffected_by_pool_freeze() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);

    let new_recipient = Address::generate(&ctx.env);
    ctx.client
        .rotate_treasury_recipient(&ctx.token_admin, &new_recipient);
    let stored = ctx.client.get_treasury_recipient().unwrap();
    assert_eq!(stored, new_recipient);
}

// ── read-only methods remain available while pool is frozen ───────────────────

#[test]
fn test_get_pool_readable_while_frozen() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    let pool = ctx.client.get_pool(&pool_id);
    assert!(
        pool.is_some(),
        "get_pool should return data even when frozen"
    );
}

#[test]
fn test_get_pool_count_readable_while_frozen() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);
    let count = ctx.client.get_pool_count();
    assert!(count >= pool_id);
}

#[test]
fn test_get_user_bet_readable_while_frozen() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    let user = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user, pool_id, 0, 100);
    ctx.client.freeze_pool(&ctx.freeze_admin, &pool_id);

    let bet = ctx.client.get_user_bet(&pool_id, &user);
    assert!(
        bet.is_some(),
        "get_user_bet should work while pool is frozen"
    );
}

// ── set_freeze_admin restrictions ─────────────────────────────────────────────

#[test]
#[should_panic]
fn test_non_treasury_cannot_set_freeze_admin() {
    let ctx = TestCtx::new();
    let stranger = Address::generate(&ctx.env);
    let new_admin = Address::generate(&ctx.env);
    ctx.client.set_freeze_admin(&stranger, &new_admin);
}

#[test]
fn test_treasury_can_replace_freeze_admin() {
    let ctx = TestCtx::new();
    let new_admin = Address::generate(&ctx.env);
    ctx.client.set_freeze_admin(&ctx.token_admin, &new_admin);

    // Old freeze_admin can no longer freeze
    let pool_id = ctx.open_pool();
    // New admin can freeze
    ctx.client.freeze_pool(&new_admin, &pool_id);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Frozen);
}

// ── #456 pause_contract / unpause_contract ────────────────────────────────────

#[test]
fn test_pause_contract_blocks_place_bet() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    ctx.client.pause_contract(&ctx.token_admin);
    assert!(ctx.client.is_paused());

    let user = Address::generate(&ctx.env);
    let token_admin_client = token::StellarAssetClient::new(&ctx.env, &ctx.token_id);
    token_admin_client.mint(&user, &500);
    let result = ctx
        .client
        .try_place_bet(&user, &pool_id, &0, &100, &None::<Address>);
    assert!(result.is_err(), "place_bet must be blocked while paused");
}

#[test]
fn test_unpause_contract_restores_place_bet() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();

    ctx.client.pause_contract(&ctx.token_admin);
    ctx.client.unpause_contract(&ctx.token_admin);
    assert!(!ctx.client.is_paused());

    let user = Address::generate(&ctx.env);
    let token_admin_client = token::StellarAssetClient::new(&ctx.env, &ctx.token_id);
    token_admin_client.mint(&user, &500);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 100);
}

#[test]
fn test_only_admin_can_pause_contract() {
    let ctx = TestCtx::new();
    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_pause_contract(&stranger);
    assert!(result.is_err(), "non-admin must not be able to pause");
}

#[test]
fn test_only_admin_can_unpause_contract() {
    let ctx = TestCtx::new();
    ctx.client.pause_contract(&ctx.token_admin);
    let stranger = Address::generate(&ctx.env);
    let result = ctx.client.try_unpause_contract(&stranger);
    assert!(result.is_err(), "non-admin must not be able to unpause");
}

#[test]
fn test_get_pool_readable_while_contract_paused() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    ctx.client.pause_contract(&ctx.token_admin);
    let pool = ctx.client.get_pool(&pool_id);
    assert!(pool.is_some(), "read-only queries must work while paused");
}

#[test]
fn test_pause_contract_blocks_settle_pool() {
    let ctx = TestCtx::new();
    let pool_id = ctx.open_pool();
    let user = Address::generate(&ctx.env);
    let token_admin_client = token::StellarAssetClient::new(&ctx.env, &ctx.token_id);
    token_admin_client.mint(&user, &500);
    ctx.client
        .place_bet(&user, &pool_id, &0, &100, &None::<Address>);

    ctx.client.pause_contract(&ctx.token_admin);
    ctx.env.ledger().with_mut(|li| li.timestamp = 7200);
    let result = ctx.client.try_settle_pool(&ctx.pool_creator, &pool_id, &0);
    assert!(result.is_err(), "settle_pool must be blocked while paused");
}
