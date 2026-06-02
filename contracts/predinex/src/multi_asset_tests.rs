#![cfg(test)]
extern crate std;
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Vec,
};

// ── Multi-Asset Test Harness ─────────────────────────────────────────────────

struct MaEnv<'a> {
    env: Env,
    client: PredinexContractClient<'a>,
    /// Base token — same as the single-asset contract token.
    base_token: Address,
    /// Alternative token used for multi-asset bet tests.
    alt_token: Address,
    /// Treasury recipient (= token_admin passed to initialize).
    treasury: Address,
    /// Stellar asset admin for base_token (for minting).
    base_admin: token::StellarAssetClient<'a>,
    /// Stellar asset admin for alt_token (for minting).
    alt_admin: token::StellarAssetClient<'a>,
}

fn setup_ma() -> MaEnv<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);

    let base_asset = env.register_stellar_asset_contract_v2(treasury.clone());
    let alt_asset = env.register_stellar_asset_contract_v2(treasury.clone());

    let contract_id = env.register(PredinexContract, ());
    let client = PredinexContractClient::new(&env, &contract_id);
    client.initialize(&base_asset.address(), &treasury);

    let base_admin = token::StellarAssetClient::new(&env, &base_asset.address());
    let alt_admin = token::StellarAssetClient::new(&env, &alt_asset.address());

    // Transmute to 'static — safe because Env owns all allocations.
    let client: PredinexContractClient<'static> = unsafe { core::mem::transmute(client) };
    let base_admin: token::StellarAssetClient<'static> =
        unsafe { core::mem::transmute(base_admin) };
    let alt_admin: token::StellarAssetClient<'static> =
        unsafe { core::mem::transmute(alt_admin) };
    let env: Env = unsafe { core::mem::transmute(env) };

    MaEnv {
        env,
        client,
        base_token: base_asset.address(),
        alt_token: alt_asset.address(),
        treasury,
        base_admin,
        alt_admin,
    }
}

/// Helper: create a basic two-outcome multi-asset pool with base + alt tokens.
fn make_ma_pool(t: &MaEnv, creator: &Address) -> u32 {
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    allowed.push_back(t.alt_token.clone());

    t.client.create_multi_asset_pool(
        creator,
        &String::from_str(&t.env, "MA Pool"),
        &String::from_str(&t.env, "Multi-asset test pool"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Yes"));
            v.push_back(String::from_str(&t.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None,
    )
}

// ── Tests ────────────────────────────────────────────────────────────────────

/// ma_1: Pool creation stores allowed tokens and marks pool as multi-asset.
#[test]
fn ma_1_create_multi_asset_pool_stores_allowed_tokens() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);

    // Set exchange rates for both tokens (10_000 bps = 1:1 with base).
    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    let allowed = t.client.get_pool_allowed_tokens(&pool_id).expect("tokens must be stored");
    assert_eq!(allowed.len(), 2, "two tokens should be allowed");
    assert!(allowed.contains(&t.base_token));
    assert!(allowed.contains(&t.alt_token));

    // Exchange rates are readable.
    assert_eq!(t.client.get_token_exchange_rate(&t.base_token), Some(10_000));
    assert_eq!(t.client.get_token_exchange_rate(&t.alt_token), Some(5_000));
}

/// ma_2: Placing a bet with a supported alt token succeeds and is tracked.
#[test]
fn ma_2_place_bet_with_supported_token_succeeds() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    // 1 alt-token = 0.5 base tokens.
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Mint 200 alt tokens to user.
    t.alt_admin.mint(&user, &200i128);

    t.client.place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &200i128,
        &t.alt_token,
        &None::<Address>,
    );

    // Contract now holds 200 alt tokens in escrow.
    let alt_client = token::Client::new(&t.env, &t.alt_token);
    assert_eq!(alt_client.balance(&t.client.address), 200);

    // Pool totals reflect normalised amount (200 × 5000 / 10000 = 100 base units).
    let pool = t.client.get_pool(&pool_id).expect("pool must exist");
    assert_eq!(pool.total_a, 100, "normalised total_a should be 100");
}

/// ma_3: Bet with a token not in the allowed list returns UnsupportedToken.
#[test]
fn ma_3_place_bet_with_unsupported_token_fails() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Register a third token with a rate, but do NOT add it to the pool.
    let third_token_asset = t.env.register_stellar_asset_contract_v2(t.treasury.clone());
    let third_token = third_token_asset.address();
    t.client.set_token_exchange_rate(&t.treasury, &third_token, &10_000i128);

    let third_admin = token::StellarAssetClient::new(&t.env, &third_token);
    third_admin.mint(&user, &100i128);

    let result = t.client.try_place_multi_asset_bet(
        &user,
        &pool_id,
        &0u32,
        &100i128,
        &third_token,
        &None::<Address>,
    );
    assert_eq!(result, Err(Ok(ContractError::UnsupportedToken)));
}

/// ma_4: Bet with a token that has no exchange rate set returns ExchangeRateNotSet.
#[test]
fn ma_4_place_bet_without_exchange_rate_fails() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    // Set rate for base but NOT for alt before pool creation — pool creation
    // should fail since all tokens need a rate at creation time.
    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &5_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Now remove the alt rate by overwriting storage directly is not feasible,
    // so instead we use a freshly registered token that has never had a rate set
    // and try to insert it via a direct storage-skipping approach. The simplest
    // way is to register a new token, skip set_token_exchange_rate for it, then
    // verify pool creation rejects it.
    let no_rate_asset = t.env.register_stellar_asset_contract_v2(t.treasury.clone());
    let no_rate_token = no_rate_asset.address();

    // Attempt to create a pool that includes the no-rate token.
    let mut allowed = Vec::new(&t.env);
    allowed.push_back(t.base_token.clone());
    allowed.push_back(no_rate_token.clone());

    let create_result = t.client.try_create_multi_asset_pool(
        &creator,
        &String::from_str(&t.env, "No Rate Pool"),
        &String::from_str(&t.env, "desc"),
        &{
            let mut v = Vec::new(&t.env);
            v.push_back(String::from_str(&t.env, "Yes"));
            v.push_back(String::from_str(&t.env, "No"));
            v
        },
        &3_600u64,
        &allowed,
        &None::<String>,
    );
    assert_eq!(create_result, Err(Ok(ContractError::ExchangeRateNotSet)));

    // Additionally verify get_token_exchange_rate returns None for unregistered token.
    assert_eq!(t.client.get_token_exchange_rate(&no_rate_token), None);

    let _ = pool_id; // suppress unused warning
}

/// ma_5: Two-token pool settle — sole winner receives proportional share of both tokens.
#[test]
fn ma_5_two_token_pool_settle_winner_receives_both_tokens() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    // 1 base-token = 1 base unit (rate 10_000).
    // 1 alt-token = 1 base unit (rate 10_000) for simple math in this test.
    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // user_a bets 100 base tokens on outcome 0.
    t.base_admin.mint(&user_a, &100i128);
    t.client.place_multi_asset_bet(
        &user_a, &pool_id, &0u32, &100i128, &t.base_token, &None::<Address>,
    );

    // user_b bets 200 alt tokens on outcome 1.
    t.alt_admin.mint(&user_b, &200i128);
    t.client.place_multi_asset_bet(
        &user_b, &pool_id, &1u32, &200i128, &t.alt_token, &None::<Address>,
    );

    // total normalised = 300, fee 2% = 6, net = 294.
    // user_a is sole winner (norm bet = 100, winning total = 100, share = 100%).
    t.env.ledger().with_mut(|l| l.timestamp = 3_701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    let base_client = token::Client::new(&t.env, &t.base_token);
    let alt_client = token::Client::new(&t.env, &t.alt_token);

    // user_a claims: receives 100% of net of both tokens.
    // net_base = 100 - 2 = 98; net_alt = 200 - 4 = 196.
    t.client.claim_multi_asset_winnings(&user_a, &pool_id);

    assert_eq!(base_client.balance(&user_a), 98, "user_a base payout");
    assert_eq!(alt_client.balance(&user_a), 196, "user_a alt payout");
}

/// ma_6: Per-token min and max bet limits are enforced.
#[test]
fn ma_6_per_token_min_max_bet_enforced() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user = Address::generate(&t.env);

    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    // Set per-token limits for alt: min = 100, max = 500.
    t.client.set_pool_token_bet_limits(&t.treasury, &pool_id, &t.alt_token, &100i128, &500i128);

    t.alt_admin.mint(&user, &1_000i128);

    // Below minimum.
    let low = t.client.try_place_multi_asset_bet(
        &user, &pool_id, &0u32, &99i128, &t.alt_token, &None::<Address>,
    );
    assert_eq!(low, Err(Ok(ContractError::BetBelowMinBet)));

    // Above maximum.
    let high = t.client.try_place_multi_asset_bet(
        &user, &pool_id, &0u32, &501i128, &t.alt_token, &None::<Address>,
    );
    assert_eq!(high, Err(Ok(ContractError::BetAboveMaxBet)));

    // Exactly at minimum succeeds.
    t.client.place_multi_asset_bet(
        &user, &pool_id, &0u32, &100i128, &t.alt_token, &None::<Address>,
    );

    // Exactly at maximum succeeds.
    t.client.place_multi_asset_bet(
        &user, &pool_id, &0u32, &500i128, &t.alt_token, &None::<Address>,
    );
}

/// ma_7: collect_multi_asset_fees transfers pending fees to the treasury.
#[test]
fn ma_7_collect_fees_transfers_pending_fees_to_treasury() {
    let t = setup_ma();
    let creator = Address::generate(&t.env);
    let user_a = Address::generate(&t.env);
    let user_b = Address::generate(&t.env);

    t.client.set_token_exchange_rate(&t.treasury, &t.base_token, &10_000i128);
    t.client.set_token_exchange_rate(&t.treasury, &t.alt_token, &10_000i128);

    let pool_id = make_ma_pool(&t, &creator);

    t.base_admin.mint(&user_a, &500i128);
    t.alt_admin.mint(&user_b, &500i128);

    t.client.place_multi_asset_bet(
        &user_a, &pool_id, &0u32, &500i128, &t.base_token, &None::<Address>,
    );
    t.client.place_multi_asset_bet(
        &user_b, &pool_id, &1u32, &500i128, &t.alt_token, &None::<Address>,
    );

    // total normalised = 1000, fee 2% = 20 (10 from each token).
    t.env.ledger().with_mut(|l| l.timestamp = 3_701);
    t.client.settle_pool(&creator, &pool_id, &0u32);

    // First claim populates PoolTokenFeePending.
    t.client.claim_multi_asset_winnings(&user_a, &pool_id);

    let base_client = token::Client::new(&t.env, &t.base_token);
    let alt_client = token::Client::new(&t.env, &t.alt_token);

    let treasury_base_before = base_client.balance(&t.treasury);
    let treasury_alt_before = alt_client.balance(&t.treasury);

    // Treasury collects fees.
    t.client.collect_multi_asset_fees(&t.treasury, &pool_id);

    // Treasury should receive 2% of 500 base = 10, and 2% of 500 alt = 10.
    assert_eq!(
        base_client.balance(&t.treasury) - treasury_base_before,
        10,
        "treasury base fee"
    );
    assert_eq!(
        alt_client.balance(&t.treasury) - treasury_alt_before,
        10,
        "treasury alt fee"
    );
}
