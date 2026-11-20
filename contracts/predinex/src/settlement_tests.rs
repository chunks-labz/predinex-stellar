#![cfg(test)]
//! #1422 — Direct unit tests for wager settlement (`settle_pool` +
//! `claim_winnings`).
//!
//! Covers single-winner, multi-winner and no-winner outcomes, exact
//! floor-division remainder (dust) handling for integer payouts, and claims
//! against positions that were already withdrawn (claimed, or cancelled before
//! expiry). Every edge case asserts a typed error instead of a panic.
//!
//! Payout math under test, per winner:
//!   fee    = floor(total_pool * fee_bps / 10_000)
//!   payout = floor(stake * (total_pool - fee) / winning_total)
//! and on the final winning claim the residual
//!   dust   = (total_pool - fee) - sum(payouts)
//! is swept to the treasury so `total_pool == fee + dust + sum(payouts)`.
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, token, Address, Env, String};

const DURATION: u64 = 3600;

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    admin: Address,
    token: Address,
    contract: Address,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();

    let contract = env.register(PredinexContract, ());
    let client: PredinexContractClient<'static> = PredinexContractClient::new(&env, &contract);

    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    client.initialize(&token, &admin, &admin);

    Ctx {
        env,
        client,
        admin,
        token,
        contract,
    }
}

impl Ctx {
    fn set_fee_bps(&self, bps: u32) {
        self.client.set_protocol_fee(&self.admin, &bps);
    }

    fn funded_user(&self, amount: i128) -> Address {
        let user = Address::generate(&self.env);
        token::StellarAssetClient::new(&self.env, &self.token).mint(&user, &amount);
        user
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token).balance(who)
    }

    fn create_pool(&self) -> (u32, Address) {
        let creator = self.funded_user(MIN_CREATOR_DEPOSIT);
        let pool_id = self.client.create_pool(
            &creator,
            &String::from_str(&self.env, "Settlement market"),
            &String::from_str(&self.env, "Settlement unit tests"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &DURATION,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        );
        (pool_id, creator)
    }

    /// Mints exactly `amount` to a fresh user and stakes all of it.
    fn bettor(&self, pool_id: u32, outcome: u32, amount: i128) -> Address {
        let user = self.funded_user(amount);
        self.client
            .place_bet(&user, &pool_id, &outcome, &amount, &None::<Address>);
        user
    }

    fn expire(&self) {
        self.env
            .ledger()
            .with_mut(|li| li.timestamp += DURATION + 1);
    }

    fn settle(&self, pool_id: u32, creator: &Address, outcome: u32) {
        self.expire();
        self.client.settle_pool(creator, &pool_id, &outcome);
    }

    fn payout_state(&self, pool_id: u32) -> PoolPayoutState {
        self.client
            .get_pool_payout_state(&pool_id)
            .expect("payout state should exist after a claim")
    }
}

// ── Single winner ────────────────────────────────────────────────────────────

#[test]
fn single_winner_receives_entire_net_pool() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let winner = ctx.bettor(pool_id, 0, 300);
    let loser = ctx.bettor(pool_id, 1, 700);

    ctx.settle(pool_id, &creator, 0);

    // total 1000, default fee 2% = 20, net 980 -> sole winner takes all of it.
    let paid = ctx.client.claim_winnings(&winner, &pool_id);
    assert_eq!(paid, 980);
    assert_eq!(ctx.balance(&winner), 980);

    let state = ctx.payout_state(pool_id);
    assert!(state.fee_credited);
    assert_eq!(state.claimed_winning_stake, 300);
    assert_eq!(state.paid_out, 980);
    // Fee credited, no dust: 1000 = 20 + 0 + 980.
    assert_eq!(ctx.client.get_treasury_balance(), 20);

    assert_eq!(
        ctx.client.try_claim_winnings(&loser, &pool_id),
        Err(Ok(ContractError::NoWinningsToClaim))
    );
    assert_eq!(ctx.balance(&loser), 0);
}

#[test]
fn single_winner_with_no_opposing_stake_gets_stake_minus_fee() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let winner = ctx.bettor(pool_id, 0, 500);

    ctx.settle(pool_id, &creator, 0);

    // total 500, fee floor(500 * 200 / 10_000) = 10.
    assert_eq!(ctx.client.claim_winnings(&winner, &pool_id), 490);
    assert_eq!(ctx.client.get_treasury_balance(), 10);
}

// ── Multiple winners ─────────────────────────────────────────────────────────

#[test]
fn multiple_winners_split_net_pool_pro_rata() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let a = ctx.bettor(pool_id, 0, 100);
    let b = ctx.bettor(pool_id, 0, 300);
    let _c = ctx.bettor(pool_id, 1, 600);

    ctx.settle(pool_id, &creator, 0);

    // net 980 split 100:300 over a 400 winning side.
    assert_eq!(ctx.client.claim_winnings(&a, &pool_id), 245);
    assert_eq!(ctx.client.claim_winnings(&b, &pool_id), 735);

    let state = ctx.payout_state(pool_id);
    assert_eq!(state.claimed_winning_stake, 400);
    assert_eq!(state.paid_out, 980);
    assert_eq!(ctx.client.get_treasury_balance(), 20);
}

#[test]
fn fee_is_credited_once_across_multiple_claims() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let a = ctx.bettor(pool_id, 0, 250);
    let b = ctx.bettor(pool_id, 0, 250);
    let _l = ctx.bettor(pool_id, 1, 500);

    ctx.settle(pool_id, &creator, 0);

    ctx.client.claim_winnings(&a, &pool_id);
    assert_eq!(ctx.client.get_treasury_balance(), 20);
    ctx.client.claim_winnings(&b, &pool_id);
    // Still 20: the fee is not credited a second time on the next claim.
    assert_eq!(ctx.client.get_treasury_balance(), 20);
}

// ── No winners ───────────────────────────────────────────────────────────────

#[test]
fn settling_to_an_outcome_nobody_backed_is_rejected() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let a = ctx.bettor(pool_id, 0, 400);
    let _b = ctx.bettor(pool_id, 0, 600);

    ctx.expire();
    assert_eq!(
        ctx.client.try_settle_pool(&creator, &pool_id, &1),
        Err(Ok(ContractError::NoWinningBets))
    );

    // The pool stays open, nothing was recorded and no one can claim.
    let pool = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(pool.status, PoolStatus::Open);
    assert!(ctx.client.get_pool_payout_state(&pool_id).is_none());
    assert_eq!(
        ctx.client.try_claim_winnings(&a, &pool_id),
        Err(Ok(ContractError::PoolNotSettled))
    );
    assert_eq!(ctx.client.get_treasury_balance(), 0);
}

#[test]
fn losers_cannot_claim_and_leave_payout_state_untouched() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let _w = ctx.bettor(pool_id, 0, 100);
    let l1 = ctx.bettor(pool_id, 1, 100);
    let l2 = ctx.bettor(pool_id, 1, 200);

    ctx.settle(pool_id, &creator, 0);

    for loser in [&l1, &l2] {
        assert_eq!(
            ctx.client.try_claim_winnings(loser, &pool_id),
            Err(Ok(ContractError::NoWinningsToClaim))
        );
    }
    assert!(ctx.client.get_pool_payout_state(&pool_id).is_none());
    assert_eq!(ctx.client.get_treasury_balance(), 0);
}

// ── Rounding / remainder ─────────────────────────────────────────────────────

#[test]
fn remainder_is_swept_to_treasury_only_on_final_claim() {
    let ctx = setup();
    ctx.set_fee_bps(0);
    let (pool_id, creator) = ctx.create_pool();
    let w1 = ctx.bettor(pool_id, 0, 10);
    let w2 = ctx.bettor(pool_id, 0, 10);
    let w3 = ctx.bettor(pool_id, 0, 10);
    let _l = ctx.bettor(pool_id, 1, 1);

    ctx.settle(pool_id, &creator, 0);

    // net 31 over 30 winning stake: each floor(10 * 31 / 30) = 10.
    assert_eq!(ctx.client.claim_winnings(&w1, &pool_id), 10);
    assert_eq!(ctx.client.get_treasury_balance(), 0);
    assert_eq!(ctx.client.claim_winnings(&w2, &pool_id), 10);
    assert_eq!(ctx.client.get_treasury_balance(), 0);
    assert_eq!(ctx.client.claim_winnings(&w3, &pool_id), 10);
    // Final claim sweeps exactly the 1-unit remainder.
    assert_eq!(ctx.client.get_treasury_balance(), 1);
    assert_eq!(ctx.payout_state(pool_id).paid_out, 30);
}

#[test]
fn remainder_and_fee_reconcile_exactly_with_total_pool() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let w1 = ctx.bettor(pool_id, 0, 7);
    let w2 = ctx.bettor(pool_id, 0, 7);
    let w3 = ctx.bettor(pool_id, 0, 7);
    let _l = ctx.bettor(pool_id, 1, 79);

    ctx.settle(pool_id, &creator, 0);

    // total 100, fee 2, net 98; each floor(7 * 98 / 21) = 32 (98/3 = 32.67).
    let contract_before = ctx.balance(&ctx.contract);
    let p1 = ctx.client.claim_winnings(&w1, &pool_id);
    assert_eq!(p1, 32);
    assert_eq!(
        ctx.client.get_treasury_balance(),
        2,
        "fee only after first claim"
    );
    let p2 = ctx.client.claim_winnings(&w2, &pool_id);
    let p3 = ctx.client.claim_winnings(&w3, &pool_id);
    assert_eq!((p2, p3), (32, 32));

    // dust = 98 - 96 = 2 -> treasury = fee 2 + dust 2.
    assert_eq!(ctx.client.get_treasury_balance(), 4);
    assert_eq!(2 + 2 + p1 + p2 + p3, 100);
    // Exactly the payouts left the contract.
    assert_eq!(contract_before - ctx.balance(&ctx.contract), 96);
}

#[test]
fn uneven_stakes_remainder_is_independent_of_claim_order() {
    for larger_first in [true, false] {
        let ctx = setup();
        ctx.set_fee_bps(0);
        let (pool_id, creator) = ctx.create_pool();
        let small = ctx.bettor(pool_id, 0, 1);
        let large = ctx.bettor(pool_id, 0, 2);
        let _l = ctx.bettor(pool_id, 1, 4);

        ctx.settle(pool_id, &creator, 0);

        // net 7 over 3: floor(1*7/3) = 2, floor(2*7/3) = 4, dust 1.
        let (first, second) = if larger_first {
            (&large, &small)
        } else {
            (&small, &large)
        };
        ctx.client.claim_winnings(first, &pool_id);
        assert_eq!(ctx.client.get_treasury_balance(), 0);
        ctx.client.claim_winnings(second, &pool_id);

        assert_eq!(ctx.balance(&small), 2);
        assert_eq!(ctx.balance(&large), 4);
        assert_eq!(ctx.client.get_treasury_balance(), 1);
    }
}

#[test]
fn fee_rounds_down_to_zero_on_tiny_pools() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let w = ctx.bettor(pool_id, 0, 3);
    let _l = ctx.bettor(pool_id, 1, 1);

    ctx.settle(pool_id, &creator, 0);

    // fee floor(4 * 200 / 10_000) = 0 -> the winner gets the whole pool.
    assert_eq!(ctx.client.claim_winnings(&w, &pool_id), 4);
    assert_eq!(ctx.client.get_treasury_balance(), 0);
}

#[test]
fn large_stakes_pay_out_exactly_without_overflow() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let stake: i128 = 1_000_000_000_000_000_000; // 1e18 base units
    let w1 = ctx.bettor(pool_id, 0, stake);
    let w2 = ctx.bettor(pool_id, 0, stake * 2);
    let _l = ctx.bettor(pool_id, 1, stake * 3);

    ctx.settle(pool_id, &creator, 0);

    let total = stake * 6;
    let fee = total * 200 / 10_000;
    let net = total - fee;
    let p1 = ctx.client.claim_winnings(&w1, &pool_id);
    let p2 = ctx.client.claim_winnings(&w2, &pool_id);
    assert_eq!(p1, stake * net / (stake * 3));
    assert_eq!(p2, stake * 2 * net / (stake * 3));
    assert_eq!(ctx.client.get_treasury_balance(), fee + (net - p1 - p2));
}

// ── Already-withdrawn positions ──────────────────────────────────────────────

#[test]
fn second_claim_after_withdrawal_is_rejected_without_paying() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let w = ctx.bettor(pool_id, 0, 100);
    let _l = ctx.bettor(pool_id, 1, 100);

    ctx.settle(pool_id, &creator, 0);
    assert_eq!(ctx.client.claim_winnings(&w, &pool_id), 196);
    assert_eq!(
        ctx.client.get_claim_status(&pool_id, &w),
        ClaimStatus::AlreadyClaimed
    );

    let treasury = ctx.client.get_treasury_balance();
    assert_eq!(
        ctx.client.try_claim_winnings(&w, &pool_id),
        Err(Ok(ContractError::NoBetFound))
    );
    assert_eq!(ctx.balance(&w), 196);
    assert_eq!(ctx.client.get_treasury_balance(), treasury);
    assert_eq!(ctx.payout_state(pool_id).paid_out, 196);
}

#[test]
fn fully_cancelled_winning_position_cannot_claim() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let withdrawn = ctx.bettor(pool_id, 0, 400);
    let stayer = ctx.bettor(pool_id, 0, 100);
    let _l = ctx.bettor(pool_id, 1, 500);

    // Withdraw the whole position before expiry.
    ctx.client.cancel_bet(&withdrawn, &pool_id, &0, &400);
    assert_eq!(ctx.balance(&withdrawn), 400);

    ctx.settle(pool_id, &creator, 0);

    assert_eq!(
        ctx.client.try_claim_winnings(&withdrawn, &pool_id),
        Err(Ok(ContractError::NoWinningsToClaim))
    );
    // The remaining winner takes the full net pool: total 600, fee 12, net 588.
    assert_eq!(ctx.client.claim_winnings(&stayer, &pool_id), 588);
    assert_eq!(ctx.client.get_treasury_balance(), 12);
    assert_eq!(ctx.balance(&withdrawn), 400);
}

#[test]
fn partially_cancelled_position_is_paid_on_remaining_stake() {
    let ctx = setup();
    ctx.set_fee_bps(0);
    let (pool_id, creator) = ctx.create_pool();
    let partial = ctx.bettor(pool_id, 0, 300);
    let other = ctx.bettor(pool_id, 0, 100);
    let _l = ctx.bettor(pool_id, 1, 101);

    ctx.client.cancel_bet(&partial, &pool_id, &0, &100);

    ctx.settle(pool_id, &creator, 0);

    // Remaining winning stake 200 + 100 = 300, net 401.
    // partial: floor(200 * 401 / 300) = 267; other: floor(100 * 401 / 300) = 133.
    assert_eq!(ctx.client.claim_winnings(&partial, &pool_id), 267);
    assert_eq!(ctx.client.claim_winnings(&other, &pool_id), 133);
    assert_eq!(ctx.balance(&partial), 100 + 267);
    // dust = 401 - 400 = 1.
    assert_eq!(ctx.client.get_treasury_balance(), 1);
    assert_eq!(ctx.payout_state(pool_id).claimed_winning_stake, 300);
}

// ── Edge inputs: typed errors, never panics ──────────────────────────────────

#[test]
fn claim_edge_inputs_return_errors_instead_of_panicking() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let w = ctx.bettor(pool_id, 0, 100);
    let stranger = Address::generate(&ctx.env);

    assert_eq!(
        ctx.client.try_claim_winnings(&w, &999),
        Err(Ok(ContractError::PoolNotFound))
    );
    assert_eq!(
        ctx.client.try_claim_winnings(&w, &pool_id),
        Err(Ok(ContractError::PoolNotSettled))
    );

    ctx.settle(pool_id, &creator, 0);

    assert_eq!(
        ctx.client.try_claim_winnings(&stranger, &pool_id),
        Err(Ok(ContractError::NoBetFound))
    );
    assert_eq!(
        ctx.client.try_settle_pool(&creator, &pool_id, &0),
        Err(Ok(ContractError::PoolAlreadySettled))
    );
}

#[test]
fn settle_edge_inputs_return_errors_instead_of_panicking() {
    let ctx = setup();
    let (pool_id, creator) = ctx.create_pool();
    let _w = ctx.bettor(pool_id, 0, 100);

    assert_eq!(
        ctx.client.try_settle_pool(&creator, &pool_id, &0),
        Err(Ok(ContractError::PoolNotExpired))
    );
    ctx.expire();
    assert_eq!(
        ctx.client.try_settle_pool(&creator, &pool_id, &2),
        Err(Ok(ContractError::InvalidOutcome))
    );
    assert_eq!(
        ctx.client.try_settle_pool(&creator, &pool_id, &u32::MAX),
        Err(Ok(ContractError::InvalidOutcome))
    );
    assert_eq!(
        ctx.client.try_settle_pool(&creator, &999, &0),
        Err(Ok(ContractError::PoolNotFound))
    );
    let outsider = Address::generate(&ctx.env);
    assert_eq!(
        ctx.client.try_settle_pool(&outsider, &pool_id, &0),
        Err(Ok(ContractError::Unauthorized))
    );
}
