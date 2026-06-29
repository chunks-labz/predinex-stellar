//! #457 — Performance benchmark suite for contract operations.
//!
//! Measures wall-clock time for critical contract operations under realistic
//! load conditions. Results are written to `benchmark-results.json` for CI
//! trend tracking.
//!
//! Run with: `make benchmark`  (or `cargo test --release bench_ -- --nocapture`)

#![cfg(test)]

extern crate std;

use super::*;
use crate::alloc::string::ToString;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String,
};
use std::{
    fs,
    time::{Duration, Instant},
};

// ── Benchmark harness ─────────────────────────────────────────────────────────

struct BenchResult {
    operation: &'static str,
    iterations: u32,
    total_ms: f64,
    avg_ms: f64,
}

impl BenchResult {
    fn to_json(&self) -> alloc::string::String {
        alloc::format!(
            r#"{{"operation":"{op}","iterations":{iter},"total_wall_ms":{total:.3},"avg_wall_ms":{avg:.3},"gas_units":null}}"#,
            op = self.operation,
            iter = self.iterations,
            total = self.total_ms,
            avg = self.avg_ms,
        )
    }

    fn print_row(&self) {
        std::println!(
            "  {:<52} {:>5} iters  {:>8.3} ms avg  {:>10.3} ms total",
            self.operation,
            self.iterations,
            self.avg_ms,
            self.total_ms
        );
    }
}

fn bench<F: FnMut()>(operation: &'static str, iterations: u32, mut f: F) -> BenchResult {
    f(); // warm-up
    let start = Instant::now();
    for _ in 0..iterations {
        f();
    }
    let elapsed: Duration = start.elapsed();
    let total_ms = elapsed.as_secs_f64() * 1000.0;
    BenchResult {
        operation,
        iterations,
        total_ms,
        avg_ms: total_ms / iterations as f64,
    }
}

struct BenchCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token_admin: Address,
    token_id: Address,
}

impl BenchCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PredinexContract, ());
        let client: PredinexContractClient<'static> =
            PredinexContractClient::new(&env, &contract_id);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        client.initialize(&token_id.address(), &token_admin, &token_admin);
        BenchCtx {
            env,
            client,
            token_admin,
            token_id: token_id.address(),
        }
    }

    fn mint(&self, user: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.token_id).mint(user, &amount);
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "BTC above 100k?"),
            &String::from_str(&self.env, "Will BTC exceed $100k by year end?"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &86400,
            &MIN_CREATOR_DEPOSIT,
        )
    }
}

fn append_result(result: &BenchResult) {
    let path = "benchmark-results.json";
    let entry = result.to_json();

    let mut entries: alloc::vec::Vec<alloc::string::String> = alloc::vec![];
    if let Ok(existing) = fs::read_to_string(path) {
        let trimmed = existing.trim();
        if trimmed.starts_with('[') && trimmed.len() > 2 {
            let inner = trimmed[1..trimmed.len() - 1].trim();
            if !inner.is_empty() {
                // Split on object boundaries
                let mut depth = 0i32;
                let mut start = 0usize;
                for (i, c) in inner.char_indices() {
                    match c {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                entries.push(inner[start..=i].trim().to_string());
                                start = i + 1;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    entries.push(entry);
    let json = alloc::format!("[\n{}\n]\n", entries.join(",\n"));
    let _ = fs::write(path, json);
}

// ── B1: Pool creation latency ─────────────────────────────────────────────────

#[test]
fn bench_b1_pool_creation_2_outcomes() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000);

    let result = bench("pool_creation_2_outcomes", 20, || {
        ctx.create_pool(&creator);
    });

    result.print_row();
    append_result(&result);
}

// ── B2: Trade throughput — 10 LPs ─────────────────────────────────────────────

#[test]
fn bench_b2_trade_throughput_10_lps() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000);
    let pool_id = ctx.create_pool(&creator);

    let users: alloc::vec::Vec<Address> = (0..10)
        .map(|_| {
            let u = Address::generate(&ctx.env);
            ctx.mint(&u, 10_000_000);
            u
        })
        .collect();

    let mut idx = 0usize;
    let result = bench("trade_throughput_10_lps", 50, || {
        let user = &users[idx % users.len()];
        ctx.client
            .place_bet(user, &pool_id, &(idx as u32 % 2), &1_000, &None::<Address>);
        idx += 1;
    });

    result.print_row();
    append_result(&result);
}

// ── B3: Trade throughput — 100 LPs ────────────────────────────────────────────

#[test]
fn bench_b3_trade_throughput_100_lps() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000);
    let pool_id = ctx.create_pool(&creator);

    let users: alloc::vec::Vec<Address> = (0..100)
        .map(|_| {
            let u = Address::generate(&ctx.env);
            ctx.mint(&u, 10_000_000);
            u
        })
        .collect();

    let mut idx = 0usize;
    let result = bench("trade_throughput_100_lps", 100, || {
        let user = &users[idx % users.len()];
        ctx.client
            .place_bet(user, &pool_id, &(idx as u32 % 2), &1_000, &None::<Address>);
        idx += 1;
    });

    result.print_row();
    append_result(&result);
}

// ── B4–B6: Settlement cost vs participant count ───────────────────────────────

fn run_settlement_bench(name: &'static str, participant_count: usize) {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000_000);

    // Create iterations+1 pools (extra one for the bench() warm-up call)
    let iterations = 5u32;
    let pool_ids: alloc::vec::Vec<u32> = (0..iterations + 1)
        .map(|_| {
            let pool_id = ctx.create_pool(&creator);
            for i in 0..participant_count {
                let user = Address::generate(&ctx.env);
                ctx.mint(&user, 10_000);
                ctx.client
                    .place_bet(&user, &pool_id, &(i as u32 % 2), &1_000, &None::<Address>);
            }
            pool_id
        })
        .collect();

    ctx.env.ledger().with_mut(|li| li.timestamp = 200_000);

    let mut idx = 0usize;
    let result = bench(name, iterations, || {
        ctx.client.settle_pool(&creator, &pool_ids[idx], &0);
        idx += 1;
    });

    result.print_row();
    append_result(&result);
}

#[test]
fn bench_b4_settlement_10_participants() {
    run_settlement_bench("settlement_cost_10_participants", 10);
}

#[test]
fn bench_b5_settlement_50_participants() {
    run_settlement_bench("settlement_cost_50_participants", 50);
}

#[test]
fn bench_b6_settlement_100_participants() {
    run_settlement_bench("settlement_cost_100_participants", 100);
}

// ── B7: Concurrent deposit surge — 50 LPs ────────────────────────────────────

#[test]
fn bench_b7_concurrent_deposit_surge_50_lps() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000);

    let result = bench("concurrent_deposit_surge_50_lps", 3, || {
        let pool_id = ctx.create_pool(&creator);
        for i in 0..50u32 {
            let user = Address::generate(&ctx.env);
            ctx.mint(&user, 10_000);
            ctx.client
                .place_bet(&user, &pool_id, &(i % 2), &1_000, &None::<Address>);
        }
    });

    result.print_row();
    append_result(&result);
}

// ── B8: Claim winnings throughput ─────────────────────────────────────────────

#[test]
fn bench_b8_claim_winnings_throughput() {
    let ctx = BenchCtx::new();
    let creator = Address::generate(&ctx.env);
    ctx.mint(&creator, 1_000_000_000);
    let pool_id = ctx.create_pool(&creator);

    let winners: alloc::vec::Vec<Address> = (0..20)
        .map(|_| {
            let u = Address::generate(&ctx.env);
            ctx.mint(&u, 10_000);
            ctx.client
                .place_bet(&u, &pool_id, &0, &1_000, &None::<Address>);
            u
        })
        .collect();
    for _ in 0..10 {
        let u = Address::generate(&ctx.env);
        ctx.mint(&u, 10_000);
        ctx.client
            .place_bet(&u, &pool_id, &1, &1_000, &None::<Address>);
    }
    ctx.env.ledger().with_mut(|li| li.timestamp = 200_000);
    ctx.client.settle_pool(&creator, &pool_id, &0);

    // Measure each claim individually (no warm-up to avoid double-claim)
    let start = std::time::Instant::now();
    for winner in &winners {
        ctx.client.claim_winnings(winner, &pool_id);
    }
    let elapsed = start.elapsed();
    let total_ms = elapsed.as_secs_f64() * 1000.0;
    let iterations = winners.len() as u32;
    let result = BenchResult {
        operation: "claim_winnings_throughput",
        iterations,
        total_ms,
        avg_ms: total_ms / iterations as f64,
    };

    result.print_row();
    append_result(&result);
}
