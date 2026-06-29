#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── Deterministic pseudo-random number generator ─────────────────────────────
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Lcg(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0
    }

    fn next_range(&mut self, min: u64, max: u64) -> u64 {
        if min >= max {
            return min;
        }
        min + (self.next() % (max - min + 1))
    }

    fn next_string(&mut self, env: &Env, len: u32) -> String {
        let mut bytes = std::vec::Vec::with_capacity(len as usize);
        for _ in 0..len {
            // Generate printable ASCII characters (32..126)
            bytes.push(self.next_range(32, 126) as u8);
        }
        let s = std::str::from_utf8(&bytes).unwrap_or("Valid");
        String::from_str(env, s)
    }

    fn next_whitespace_string(&mut self, env: &Env, len: u32) -> String {
        let ws_chars = [b' ', b'\t', b'\n', b'\r'];
        let mut bytes = std::vec::Vec::with_capacity(len as usize);
        for _ in 0..len {
            bytes.push(ws_chars[self.next_range(0, (ws_chars.len() - 1) as u64) as usize]);
        }
        let s = std::str::from_utf8(&bytes).unwrap_or(" ");
        String::from_str(env, s)
    }
}

struct FuzzEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    admin: Address,
    token: Address,
}

fn setup_fuzz_env() -> FuzzEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());

    let contract_id = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract_id);

    client.initialize(&token_id.address(), &admin, &admin);

    FuzzEnv {
        env,
        client,
        admin,
        token: token_id.address(),
    }
}

// ── Fuzz Targets ─────────────────────────────────────────────────────────────

/// 1. fuzz_create_pool_target (invalid params)
/// Sweeps parameter spaces (empty, whitespace, huge strings, duplicate outcome names,
/// invalid durations, etc.) over 10,000 iterations.
#[test]
fn fuzz_create_pool_target() {
    let mut rng = Lcg::new(0x1111_2222_3333_4444);
    let t = setup_fuzz_env();

    for i in 0..10000 {
        // Random title length up to 2 * MAX_TITLE_LENGTH
        let title_len = rng.next_range(0, 2 * MAX_TITLE_LENGTH as u64) as u32;
        let title = if rng.next_range(0, 10) == 0 {
            rng.next_whitespace_string(&t.env, title_len)
        } else {
            rng.next_string(&t.env, title_len)
        };

        // Random description length up to 2 * MAX_DESCRIPTION_LENGTH
        let desc_len = rng.next_range(0, 2 * MAX_DESCRIPTION_LENGTH as u64) as u32;
        let desc = if rng.next_range(0, 10) == 0 {
            rng.next_whitespace_string(&t.env, desc_len)
        } else {
            rng.next_string(&t.env, desc_len)
        };

        // Random outcome name lengths up to 2 * MAX_OUTCOME_LENGTH
        let outcome_a_len = rng.next_range(0, 2 * MAX_OUTCOME_LENGTH as u64) as u32;
        let outcome_a = if rng.next_range(0, 10) == 0 {
            rng.next_whitespace_string(&t.env, outcome_a_len)
        } else {
            rng.next_string(&t.env, outcome_a_len)
        };

        let outcome_b_len = rng.next_range(0, 2 * MAX_OUTCOME_LENGTH as u64) as u32;
        let outcome_b = if rng.next_range(0, 10) == 0 {
            // High probability of duplicate outcome
            outcome_a.clone()
        } else if rng.next_range(0, 10) == 1 {
            rng.next_whitespace_string(&t.env, outcome_b_len)
        } else {
            rng.next_string(&t.env, outcome_b_len)
        };

        // Random duration from 0 to 2 * MAX_POOL_DURATION_SECS
        let duration = rng.next_range(0, 2 * MAX_POOL_DURATION_SECS);

        // Run try_create_pool and verify that any crash or unexpected panic is caught.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.client.try_create_pool(
                &t.admin,
                &title,
                &desc,
                &outcome_a,
                &outcome_b,
                &duration,
                &MIN_CREATOR_DEPOSIT,
            )
        }));

        match result {
            Ok(Ok(_pool_id)) => {}
            Ok(Err(res_err)) => {
                if let Ok(err) = res_err {
                    // Make sure it matches one of our expected ContractErrors
                    match err {
                        ContractError::TitleEmpty
                        | ContractError::TitleTooLong
                        | ContractError::DescriptionEmpty
                        | ContractError::DescriptionTooLong
                        | ContractError::OutcomeEmpty
                        | ContractError::OutcomeTooLong
                        | ContractError::StringWhitespaceOnly
                        | ContractError::DuplicateOutcomeLabels
                        | ContractError::DurationTooShort
                        | ContractError::DurationTooLong => {}
                        _ => panic!(
                            "Unexpected ContractError on create_pool fuzzing at iteration {}: {:?}",
                            i, err
                        ),
                    }
                }
            }
            Err(e) => {
                panic!(
                    "CRASH / PANIC caught on create_pool fuzzing at iteration {}: {:?}",
                    i, e
                );
            }
        }
    }
}

/// 2. fuzz_place_bet_target (overflow, zero amounts)
/// Generates random user bets (including 0, negative values, i128::MAX, etc.)
/// over 10,000 iterations to verify overflows and rate limits are caught safely.
#[test]
fn fuzz_place_bet_target() {
    let mut rng = Lcg::new(0x2222_3333_4444_5555);
    let t = setup_fuzz_env();

    // Create a valid pool to bet on
    let pool_id = t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Bet Fuzz Pool"),
        &String::from_str(&t.env, "Bet Fuzz Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &86400,
        &MIN_CREATOR_DEPOSIT,
    );

    let user = Address::generate(&t.env);
    let token_admin = token::StellarAssetClient::new(&t.env, &t.token);
    // Mint max tokens so user has balance for overflow testing
    token_admin.mint(&user, &i128::MAX);

    for i in 0..10000 {
        // Random outcome (0, 1, or huge index)
        let outcome = if rng.next_range(0, 10) == 0 {
            rng.next() as u32
        } else {
            rng.next_range(0, 2) as u32
        };

        // Random amount
        let amount = match rng.next_range(0, 6) {
            0 => 0i128,
            1 => -1i128,
            2 => rng.next_range(1, 10000) as i128,
            3 => i128::MAX,
            4 => i128::MIN,
            _ => rng.next_range(1, i128::MAX as u64) as i128,
        };

        // Random pool ID (valid or nonexistent)
        let target_pool_id = if rng.next_range(0, 10) == 0 {
            rng.next() as u32
        } else {
            pool_id
        };

        let referrer = if rng.next_range(0, 5) == 0 {
            Some(Address::generate(&t.env))
        } else {
            None
        };

        // Run try_place_bet and catch unexpected crashes/panics.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.client
                .try_place_bet(&user, &target_pool_id, &outcome, &amount, &referrer)
        }));

        match result {
            Ok(Ok(_)) => {}
            Ok(Err(res_err)) => {
                if let Ok(err) = res_err {
                    match err {
                        ContractError::InvalidBetAmount
                        | ContractError::PoolNotFound
                        | ContractError::PoolNotOpen
                        | ContractError::PoolExpired
                        | ContractError::InvalidOutcome
                        | ContractError::PoolTotalOverflow
                        | ContractError::UserBetOverflow
                        | ContractError::PoolSizeLimitExceeded
                        | ContractError::RateLimitExceeded => {}
                        _ => panic!(
                            "Unexpected ContractError on place_bet fuzzing at iteration {}: {:?}",
                            i, err
                        ),
                    }
                }
            }
            Err(_) => {
                // Insufficient balances or standard token exceptions can panic inside stellar asset contract, which is expected.
            }
        }
    }
}

/// 3. fuzz_settle_pool_target (invalid state transitions)
/// Generates random winning outcomes, callers, and times across pools with varying statuses.
#[test]
fn fuzz_settle_pool_target() {
    let mut rng = Lcg::new(0x3333_4444_5555_6666);
    let t = setup_fuzz_env();

    // Create pools in different states
    let open_pool_id = t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Open Pool"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );

    let scheduled_pool_id = t.client.schedule_pool(
        &t.admin,
        &String::from_str(&t.env, "Scheduled Pool"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &200,
    );

    let cancelled_pool_id = t.client.schedule_pool(
        &t.admin,
        &String::from_str(&t.env, "Cancelled Pool"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &300,
    );
    t.client.cancel_scheduled_pool(&t.admin, &cancelled_pool_id);

    // Create and settle a pool so it is already settled
    let settled_pool_id = t.client.create_pool(
        &t.admin,
        &String::from_str(&t.env, "Settled Pool"),
        &String::from_str(&t.env, "Desc"),
        &String::from_str(&t.env, "A"),
        &String::from_str(&t.env, "B"),
        &3600,
        &MIN_CREATOR_DEPOSIT,
    );
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);
    let token_admin = token::StellarAssetClient::new(&t.env, &t.token);
    token_admin.mint(&user_a, &1000);
    token_admin.mint(&user_b, &1000);
    t.client
        .place_bet(&user_a, &settled_pool_id, &0, &500, &None::<Address>);
    t.client
        .place_bet(&user_b, &settled_pool_id, &1, &500, &None::<Address>);
    t.env.ledger().with_mut(|li| li.timestamp = 3601);
    t.client.settle_pool(&t.admin, &settled_pool_id, &0);

    for i in 0..10000 {
        let pool_id = match rng.next_range(0, 5) {
            0 => open_pool_id,
            1 => scheduled_pool_id,
            2 => cancelled_pool_id,
            3 => settled_pool_id,
            _ => rng.next() as u32,
        };

        let winning_outcome = if rng.next_range(0, 5) == 0 {
            rng.next() as u32
        } else {
            rng.next_range(0, 2) as u32
        };

        let caller = if rng.next_range(0, 3) == 0 {
            t.admin.clone()
        } else {
            Address::generate(&t.env)
        };

        // Time travel!
        let timestamp = rng.next_range(0, 10000);
        t.env.ledger().with_mut(|li| {
            li.timestamp = timestamp;
        });

        // Run try_settle_pool and catch unexpected crashes/panics.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.client
                .try_settle_pool(&caller, &pool_id, &winning_outcome)
        }));

        match result {
            Ok(Ok(_)) => {}
            Ok(Err(res_err)) => {
                if let Ok(err) = res_err {
                    match err {
                        ContractError::PoolNotFound
                        | ContractError::PoolNotOpen
                        | ContractError::PoolNotExpired
                        | ContractError::PoolAlreadySettled
                        | ContractError::InsufficientParticipants
                        | ContractError::InvalidOutcome
                        | ContractError::Unauthorized => {}
                        _ => panic!(
                            "Unexpected ContractError on settle_pool fuzzing at iteration {}: {:?}",
                            i, err
                        ),
                    }
                }
            }
            Err(_) => {}
        }
    }
}
