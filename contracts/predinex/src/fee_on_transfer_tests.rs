//! Regression coverage for fee-on-transfer collateral tokens — Issue #1597.
//!
//! A fee-on-transfer token delivers less than the requested amount to the
//! receiver. The contract must never record more collateral than it actually
//! holds, otherwise later LP withdrawals and winner payouts short-balance.
//! These tests use a minimal test-only SEP-41-style token whose `transfer`
//! deducts a fixed fee from the delivered amount.

#![cfg(test)]
use super::*;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, testutils::Address as _, Address, Env,
};

const FEE_BPS: i128 = 100; // 1%

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
enum FeeTokenError {
    InsufficientBalance = 1,
}

#[contracttype]
#[derive(Clone)]
enum FeeTokenKey {
    FeeBps,
    Balance(Address),
}

#[contract]
struct FeeOnTransferToken;

#[contractimpl]
impl FeeOnTransferToken {
    pub fn set_fee_bps(env: Env, fee_bps: i128) {
        env.storage().instance().set(&FeeTokenKey::FeeBps, &fee_bps);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        assert!(amount > 0, "mint amount must be positive");
        let key = FeeTokenKey::Balance(to);
        let balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&key, &(balance.checked_add(amount).unwrap()));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&FeeTokenKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        assert!(amount >= 0, "transfer amount must not be negative");

        let fee_bps: i128 = env
            .storage()
            .instance()
            .get(&FeeTokenKey::FeeBps)
            .unwrap_or(0);
        let fee = amount.checked_mul(fee_bps).unwrap() / 10_000;
        let delivered = amount.checked_sub(fee).unwrap();

        let from_key = FeeTokenKey::Balance(from.clone());
        let from_balance: i128 = env.storage().persistent().get(&from_key).unwrap_or(0);
        if from_balance < amount {
            panic_with_error!(&env, FeeTokenError::InsufficientBalance);
        }
        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));

        let to_key = FeeTokenKey::Balance(to);
        let to_balance: i128 = env.storage().persistent().get(&to_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&to_key, &(to_balance.checked_add(delivered).unwrap()));
    }
}

struct FeeCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token: Address,
    token_client: FeeOnTransferTokenClient<'static>,
    admin: Address,
}

impl FeeCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        let client = PredinexContractClient::new(&env, &contract_id);

        let token = env.register(FeeOnTransferToken, ());
        let token_client = FeeOnTransferTokenClient::new(&env, &token);
        token_client.set_fee_bps(&FEE_BPS);

        let admin = Address::generate(&env);
        client.initialize(&token, &admin, &admin);

        FeeCtx {
            env,
            client,
            token,
            token_client,
            admin,
        }
    }

    fn create_pool(&self, creator: &Address, amount: i128) -> u32 {
        self.token_client.mint(creator, &(amount * 10));
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Fee-on-transfer market"),
            &String::from_str(&self.env, "Collateral regression coverage"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3600,
            &amount,
            &None::<u64>,
        )
    }
}

fn expected_received(requested: i128) -> i128 {
    requested - (requested * FEE_BPS / 10_000)
}

/// The creator-deposit path must not record a gross balance when the collateral
/// token deducted a fee. After creation, no market accounting claims more than
/// the contract actually holds.
#[test]
fn fee_on_transfer_creator_deposit_does_not_overstate_pool_balances() {
    let ctx = FeeCtx::new();
    let creator = Address::generate(&ctx.env);
    let deposit = MIN_CREATOR_DEPOSIT;

    let pool_id = ctx.create_pool(&creator, deposit);
    let net = expected_received(deposit);

    // The contract received the net amount, and the creator paid the gross
    // amount (the fee is retained by the token contract).
    assert_eq!(ctx.token_client.balance(&ctx.admin), 0);
    assert_eq!(ctx.token_client.balance(&creator), deposit * 10 - deposit);
    assert_eq!(ctx.token_client.balance(&ctx.client.address), net);

    // No pool-level balance is inflated by the gross deposit: every recorded
    // figure is <= the tokens that actually arrived.
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.total_a, 0);
    assert_eq!(pool.total_b, 0);
    assert_eq!(ctx.client.get_total_lp_liquidity(&pool_id), 0);
    assert!(ctx.client.get_treasury_balance() <= net);
}

/// The add-liquidity path must record the net amount received from a
/// fee-on-transfer token, so `get_total_lp_liquidity` never exceeds the
/// contract's actual token balance.
#[test]
fn fee_on_transfer_liquidity_deposit_records_received_amount() {
    let ctx = FeeCtx::new();
    let creator = Address::generate(&ctx.env);
    let deposit = MIN_CREATOR_DEPOSIT;
    let pool_id = ctx.create_pool(&creator, deposit);

    let lp = Address::generate(&ctx.env);
    let requested = 20_000i128;
    ctx.token_client.mint(&lp, &requested);
    ctx.client.deposit_liquidity(&lp, &pool_id, &requested);

    let net_lp = expected_received(requested);
    assert_eq!(
        ctx.client.get_total_lp_liquidity(&pool_id),
        net_lp,
        "LP accounting must use the amount that actually arrived"
    );
    assert_eq!(
        ctx.token_client.balance(&ctx.client.address),
        expected_received(deposit) + net_lp,
        "recorded liquidity must match the contract's real balance"
    );
}

/// When several LPs deposit, shares must be priced from the net amounts; a
/// fee-on-transfer token must not let the second depositor mint shares against
/// collateral the contract never received.
#[test]
fn fee_on_transfer_liquidity_shares_use_received_amounts() {
    let ctx = FeeCtx::new();
    let creator = Address::generate(&ctx.env);
    let pool_id = ctx.create_pool(&creator, MIN_CREATOR_DEPOSIT);

    let lp_a = Address::generate(&ctx.env);
    let lp_b = Address::generate(&ctx.env);
    let first = 10_000i128;
    let second = 20_000i128;
    ctx.token_client.mint(&lp_a, &first);
    ctx.token_client.mint(&lp_b, &second);

    let shares_a = ctx.client.deposit_liquidity(&lp_a, &pool_id, &first);
    let shares_b = ctx.client.deposit_liquidity(&lp_b, &pool_id, &second);

    assert_eq!(shares_a, expected_received(first));
    assert_eq!(
        shares_b,
        expected_received(second),
        "shares must be minted against net collateral, not the requested amount"
    );
    assert_eq!(
        ctx.client.get_total_lp_liquidity(&pool_id),
        expected_received(first) + expected_received(second)
    );
}
