//! Gas cost benchmarks for core contract operations — Issue #430
//!
//! Each bench_ test runs the target operation and prints a
//! "BENCH <op> <instructions>" line parsed by the CI workflow.

#![cfg(test)]

extern crate std;
use std::eprintln;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};

struct BenchCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token_id: Address,
}

impl BenchCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();

        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);

        let treasury = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env
            .register_stellar_asset_contract_v2(token_admin.clone())
            .address();

        client.initialize(&token_id, &treasury, &treasury);

        BenchCtx {
            env,
            client,
            token_id,
        }
    }

    fn mint(&self, user: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.token_id).mint(user, &amount);
    }

    fn make_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "Benchmark Market"),
            &String::from_str(&self.env, "A benchmark pool for gas measurement"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &3600,
            &MIN_CREATOR_DEPOSIT,
        )
    }

    fn measure<F: FnOnce()>(env: &Env, op: &str, f: F) {
        env.cost_estimate().budget().reset_default();
        f();
        let instructions = env.cost_estimate().resources().instructions;
        eprintln!("BENCH {} {}", op, instructions);
    }
}

#[test]
fn bench_create_pool() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    BenchCtx::measure(&ctx.env, "create_pool", || {
        ctx.make_pool(&creator);
    });
}

#[test]
fn bench_place_bet() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);
    let pool_id = ctx.make_pool(&creator);
    ctx.mint(&user, 10_000);
    BenchCtx::measure(&ctx.env, "place_bet", || {
        ctx.client
            .place_bet(&user, &pool_id, &0, &1_000, &None::<Address>);
    });
}

#[test]
fn bench_settle_pool() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    let user_a = Address::generate(&ctx.env);
    let user_b = Address::generate(&ctx.env);
    let pool_id = ctx.make_pool(&creator);
    ctx.mint(&user_a, 10_000);
    ctx.mint(&user_b, 10_000);
    ctx.client
        .place_bet(&user_a, &pool_id, &0, &5_000, &None::<Address>);
    ctx.client
        .place_bet(&user_b, &pool_id, &1, &5_000, &None::<Address>);
    ctx.env.ledger().with_mut(|l| l.timestamp = 7200);
    BenchCtx::measure(&ctx.env, "settle_pool", || {
        ctx.client.settle_pool(&creator, &pool_id, &0);
    });
}

#[test]
fn bench_claim_winnings() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    let winner = Address::generate(&ctx.env);
    let loser = Address::generate(&ctx.env);
    let pool_id = ctx.make_pool(&creator);
    ctx.mint(&winner, 10_000);
    ctx.mint(&loser, 10_000);
    ctx.client
        .place_bet(&winner, &pool_id, &0, &5_000, &None::<Address>);
    ctx.client
        .place_bet(&loser, &pool_id, &1, &5_000, &None::<Address>);
    ctx.env.ledger().with_mut(|l| l.timestamp = 7200);
    ctx.client.settle_pool(&creator, &pool_id, &0);
    BenchCtx::measure(&ctx.env, "claim_winnings", || {
        ctx.client.claim_winnings(&winner, &pool_id);
    });
}

#[test]
fn bench_cancel_bet() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    let user = Address::generate(&ctx.env);
    let pool_id = ctx.make_pool(&creator);
    ctx.mint(&user, 10_000);
    ctx.client
        .place_bet(&user, &pool_id, &0, &2_000, &None::<Address>);
    BenchCtx::measure(&ctx.env, "cancel_bet", || {
        ctx.client.cancel_bet(&user, &pool_id, &0, &1_000);
    });
}
