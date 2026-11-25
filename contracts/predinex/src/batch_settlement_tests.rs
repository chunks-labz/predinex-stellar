//! Partial-fill behaviour for batched settlement and payouts — Issue #1598.
//!
//! A batch may contain markets that cannot be settled/paid yet. Those entries
//! must be skipped without blocking the rest of the batch, must stay claimable
//! once they become eligible, and a successful payout must never happen twice.

#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, String, Vec};

struct BatchCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token: Address,
    admin: Address,
    creator: Address,
}

impl BatchCtx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        let client = PredinexContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token = token_id.address();
        let admin = token_admin.clone();
        client.initialize(&token, &admin, &admin);

        let creator = Address::generate(&env);
        token::StellarAssetClient::new(&env, &token).mint(&creator, &(MIN_CREATOR_DEPOSIT * 100));

        BatchCtx {
            env,
            client,
            token,
            admin,
            creator,
        }
    }

    fn create_pool(&self, label: &str, duration: u64) -> u32 {
        self.client.create_pool(
            &self.creator,
            &String::from_str(&self.env, label),
            &String::from_str(&self.env, "Partial batch settlement coverage"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &duration,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }

    fn fund_and_bet(&self, user: &Address, pool_id: u32, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.token).mint(user, &amount);
        self.client
            .place_bet(user, &pool_id, &0, &amount, &None::<Address>);
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(who)
    }
}

/// A settlement batch with one eligible and one not-yet-eligible market must
/// record one success and one skip. The skipped market keeps its Open status,
/// can be settled later, and its winner can still claim.
#[test]
fn batch_settlement_partial_fill_keeps_skipped_market_claimable() {
    let ctx = BatchCtx::new();
    let eligible = ctx.create_pool("Eligible market", 3_600);
    let deferred = ctx.create_pool("Deferred market", 7_200);

    let winner = Address::generate(&ctx.env);
    ctx.fund_and_bet(&winner, eligible, 500);
    ctx.fund_and_bet(&winner, deferred, 500);

    // Only the first market has expired at this point.
    ctx.env.ledger().with_mut(|li| li.timestamp = 3_601);

    let mut requests: Vec<PoolSettleRequest> = Vec::new(&ctx.env);
    requests.push_back(PoolSettleRequest {
        pool_id: eligible,
        winning_outcome: 0,
    });
    requests.push_back(PoolSettleRequest {
        pool_id: deferred,
        winning_outcome: 0,
    });

    let results = ctx.client.settle_pools(&ctx.admin, &requests);
    assert_eq!(results.results.len(), 2);
    assert!(!results.truncated);
    let first = results.results.get(0).unwrap();
    let second = results.results.get(1).unwrap();
    assert_eq!(first.pool_id, eligible);
    assert!(first.success, "expired market must settle");
    assert_eq!(first.error_code, 0);
    assert_eq!(second.pool_id, deferred);
    assert!(!second.success, "unexpired market must be skipped");
    assert_ne!(second.error_code, 0, "skip must carry a typed error code");

    assert_eq!(
        ctx.client.get_pool(&eligible).unwrap().status,
        PoolStatus::Settled(0)
    );
    assert_eq!(
        ctx.client.get_pool(&deferred).unwrap().status,
        PoolStatus::Open,
        "skipped market must not be mutated"
    );

    // The skipped market remains settleable once it expires.
    ctx.env.ledger().with_mut(|li| li.timestamp = 7_201);
    ctx.client.settle_pool(&ctx.creator, &deferred, &0);
    assert_eq!(
        ctx.client.get_pool(&deferred).unwrap().status,
        PoolStatus::Settled(0)
    );

    // Both markets are now claimable through a payout batch.
    let mut ids: Vec<u32> = Vec::new(&ctx.env);
    ids.push_back(eligible);
    ids.push_back(deferred);
    let claims = ctx.client.claim_all_winnings(&winner, &ids);
    assert_eq!(claims.results.len(), 2);
    assert_eq!(claims.results.get(0).unwrap().error_code, 0);
    assert_eq!(claims.results.get(1).unwrap().error_code, 0);
    assert!(claims.results.get(0).unwrap().amount > 0);
    assert!(claims.results.get(1).unwrap().amount > 0);
}

/// A payout batch where only some markets can pay out must transfer only the
/// successful payouts. Re-running the batch must be idempotent: the already
/// paid market is rejected and the winner's balance does not change again.
#[test]
fn batch_payout_partial_fill_is_idempotent() {
    let ctx = BatchCtx::new();
    let payable = ctx.create_pool("Payable market", 3_600);
    let not_yet_payable = ctx.create_pool("Not-yet-payable market", 7_200);

    let winner = Address::generate(&ctx.env);
    ctx.fund_and_bet(&winner, payable, 1_000);
    ctx.fund_and_bet(&winner, not_yet_payable, 1_000);

    ctx.env.ledger().with_mut(|li| li.timestamp = 3_601);
    ctx.client.settle_pool(&ctx.creator, &payable, &0);

    let mut ids: Vec<u32> = Vec::new(&ctx.env);
    ids.push_back(payable);
    ids.push_back(not_yet_payable);

    let before = ctx.balance(&winner);
    let first = ctx.client.claim_all_winnings(&winner, &ids);
    let first_amount = first.results.get(0).unwrap().amount;
    assert!(first_amount > 0, "settled market must pay out");
    assert_eq!(first.results.get(0).unwrap().error_code, 0);
    assert_eq!(first.results.get(1).unwrap().amount, 0);
    assert_ne!(first.results.get(1).unwrap().error_code, 0);
    assert_eq!(ctx.balance(&winner), before + first_amount);

    // Repeating the exact same batch must not pay the successful market twice.
    let after_first = ctx.balance(&winner);
    let second = ctx.client.claim_all_winnings(&winner, &ids);
    assert_eq!(second.results.get(0).unwrap().amount, 0);
    assert_ne!(second.results.get(0).unwrap().error_code, 0);
    assert_eq!(ctx.balance(&winner), after_first);
}

#[test]
fn batch_trades_commit_together_and_roll_back_a_late_failure() {
    let ctx = BatchCtx::new();
    let first = ctx.create_pool("First", 3_600);
    let second = ctx.create_pool("Second", 3_600);
    let user = Address::generate(&ctx.env);
    ctx.fund_and_bet(&user, first, 100);
    token::StellarAssetClient::new(&ctx.env, &ctx.token).mint(&user, &1_000);
    let escrow = ctx.balance(&ctx.client.address);
    let trades = |outcome| soroban_sdk::vec![
        &ctx.env,
        TradeRequest { pool_id: first, bet_token: None, outcome: 0, amount: 200 },
        TradeRequest { pool_id: second, bet_token: None, outcome, amount: 300 },
    ];

    assert_eq!(ctx.client.try_place_bets(&user, &trades(2)), Err(Ok(ContractError::InvalidOutcome)));
    assert_eq!(ctx.balance(&user), 1_000);
    assert_eq!(ctx.balance(&ctx.client.address), escrow);
    assert_eq!(ctx.client.get_user_bet(&first, &user).unwrap().total_bet, 100);
    assert!(ctx.client.get_user_bet(&second, &user).is_none());

    ctx.client.place_bets(&user, &trades(1));
    assert_eq!(ctx.balance(&user), 500);
    assert_eq!(ctx.balance(&ctx.client.address), escrow + 500);
    assert_eq!(ctx.client.get_user_bet(&first, &user).unwrap().total_bet, 300);
    assert_eq!(ctx.client.get_user_bet(&second, &user).unwrap().total_bet, 300);
}
