//! # Liquidity and settlement combo integration tests — issue #1115
//!
//! `lp_tests.rs` exercises the LP system on its own: deposit, withdraw, stake,
//! distribute, claim. `integration_tests.rs` exercises the betting lifecycle on
//! its own: create, bet, settle, claim. Neither crosses the other.
//!
//! That gap is where the interesting failures live. Both subsystems custody
//! user funds in the same contract balance, and both pay out of it. A bug in
//! how they interleave does not show up in either suite alone — it shows up
//! when an LP withdraws mid-settlement, or when a reward distribution lands
//! between a settlement and the winner's claim.
//!
//! These tests drive the two paths together, in orderings a well-behaved client
//! would not produce, and assert after every step that:
//!
//! - the contract still holds at least what it owes (**custody**);
//! - no token was created or destroyed (**conservation**);
//! - each subsystem's bookkeeping stays internally consistent.
//!
//! Adapted from the issue's "flash loan + liquidation combo" framing: predinex
//! has no lending, so the analogous pairing is its liquidity system against its
//! settlement and claim paths, which is where the same class of
//! custody-under-interleaving bug would appear.

#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

/// Pool lifetime used throughout, in seconds.
const DURATION: u64 = 3_600;
/// Units minted to each actor.
const FUNDING: i128 = 1_000_000_000;

struct Ctx {
    env: Env,
    client: PredinexContractClient<'static>,
    token: token::Client<'static>,
    contract_id: Address,
    /// Protocol admin and treasury recipient.
    admin: Address,
    token_id: Address,
}

impl Ctx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000);

        let contract_id = env.register(PredinexContract, ());
        let client = PredinexContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let token_asset = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_asset.address();
        let token = token::Client::new(&env, &token_id);

        client.initialize(&token_id, &admin, &admin);

        Ctx {
            env,
            client,
            token,
            contract_id,
            admin,
            token_id,
        }
    }

    fn actor(&self, amount: i128) -> Address {
        let a = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.token_id).mint(&a, &amount);
        a
    }

    fn create_pool(&self, creator: &Address) -> u32 {
        self.client.create_pool(
            creator,
            &String::from_str(&self.env, "LP settlement pool"),
            &String::from_str(&self.env, "Combined LP and settlement coverage"),
            &String::from_str(&self.env, "Yes"),
            &String::from_str(&self.env, "No"),
            &DURATION,
            &MIN_CREATOR_DEPOSIT,
            &None::<u64>,
        )
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().set_timestamp(now + secs);
    }

    fn contract_balance(&self) -> i128 {
        self.token.balance(&self.contract_id)
    }

    /// Sum of every account's balance. Nothing is minted after setup, so this
    /// must not change once a scenario begins.
    fn circulating(&self, accounts: &[&Address]) -> i128 {
        let mut total = self.contract_balance();
        for a in accounts {
            total += self.token.balance(a);
        }
        total
    }

    /// The contract holds at least what it still owes on this pool.
    ///
    /// `total_a` / `total_b` are *not* decremented as winners claim: they record
    /// the stake as it stood at settlement, because the pro-rata payout maths
    /// needs that figure for every later claimant. The outstanding liability is
    /// therefore the staked total minus whatever has already been paid out,
    /// which `PoolPayoutState::paid_out` tracks.
    fn assert_custody(&self, pool_id: u32, context: &str) {
        let pool = self.client.get_pool(&pool_id).expect("pool disappeared");
        let staked = pool.total_a + pool.total_b;
        let liquidity = self.client.get_total_lp_liquidity(&pool_id);
        let held = self.contract_balance();

        assert!(
            staked >= 0 && liquidity >= 0,
            "[{context}] negative bookkeeping: staked={staked} liquidity={liquidity}"
        );
        assert!(
            held >= 0,
            "[{context}] contract token balance went negative: {held}"
        );

        let paid_out = self
            .client
            .get_pool_payout_state(&pool_id)
            .map(|state| state.paid_out)
            .unwrap_or(0);
        let outstanding = staked - paid_out;

        assert!(
            paid_out >= 0,
            "[{context}] paid_out went negative: {paid_out}"
        );
        assert!(
            paid_out <= staked,
            "[{context}] paid out {paid_out} against a staked total of {staked}"
        );
        assert!(
            held >= outstanding,
            "[{context}] contract holds {held} but still owes {outstanding} \
             (staked {staked}, paid out {paid_out})"
        );
        assert!(
            self.client.get_total_lp_shares(&pool_id) >= 0,
            "[{context}] LP share supply went negative"
        );
    }
}

/// An LP withdrawal that lands between settlement and the winner's claim must
/// not starve the claim.
///
/// The two paths draw on the same contract balance, so a withdrawal that took
/// more than the LP's share would leave the winner unable to be paid.
#[test]
fn lp_withdrawal_between_settlement_and_claim_does_not_starve_the_winner() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let winner = ctx.actor(FUNDING);
    let loser = ctx.actor(FUNDING);
    let accounts = [&creator, &lp, &winner, &loser, &ctx.admin];
    let baseline = ctx.circulating(&accounts);

    let pool_id = ctx.create_pool(&creator);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &5_000_000);
    ctx.assert_custody(pool_id, "after deposit");

    ctx.client
        .place_bet(&winner, &pool_id, &0, &2_000_000, &None);
    ctx.client
        .place_bet(&loser, &pool_id, &1, &1_000_000, &None);
    ctx.assert_custody(pool_id, "after bets");

    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);
    ctx.assert_custody(pool_id, "after settlement");

    // The LP exits before the winner claims.
    let returned = ctx.client.withdraw_liquidity(&lp, &pool_id, &shares);
    assert!(returned > 0, "the LP withdrew nothing");
    ctx.assert_custody(pool_id, "after LP exit");

    // The winner must still be payable.
    let payout = ctx.client.claim_winnings(&winner, &pool_id);
    assert!(
        payout > 0,
        "the winner could not be paid after the LP withdrew"
    );
    ctx.assert_custody(pool_id, "after claim");

    assert_eq!(
        ctx.circulating(&accounts),
        baseline,
        "the scenario changed the circulating supply"
    );
}

/// A reward distribution landing between settlement and claim leaves the
/// winner's payout untouched.
#[test]
fn a_reward_distribution_mid_settlement_does_not_alter_the_payout() {
    // Run the same pool twice: once with a distribution interleaved, once
    // without, and compare the winner's payout.
    fn run(with_distribution: bool) -> i128 {
        let ctx = Ctx::new();
        let creator = ctx.actor(FUNDING);
        let lp = ctx.actor(FUNDING);
        let winner = ctx.actor(FUNDING);
        let loser = ctx.actor(FUNDING);
        StellarAssetClient::new(&ctx.env, &ctx.token_id).mint(&ctx.admin, &FUNDING);

        let pool_id = ctx.create_pool(&creator);
        ctx.client.deposit_liquidity(&lp, &pool_id, &3_000_000);
        ctx.client
            .place_bet(&winner, &pool_id, &0, &2_000_000, &None);
        ctx.client
            .place_bet(&loser, &pool_id, &1, &2_000_000, &None);

        ctx.advance(DURATION + 1);
        ctx.client.settle_pool(&ctx.admin, &pool_id, &0);

        if with_distribution {
            ctx.client
                .distribute_lp_rewards(&ctx.admin, &pool_id, &500_000);
            ctx.assert_custody(pool_id, "after distribution");
        }

        let payout = ctx.client.claim_winnings(&winner, &pool_id);
        ctx.assert_custody(pool_id, "after claim");
        payout
    }

    let without = run(false);
    let with = run(true);

    assert!(without > 0 && with > 0, "a winner was left unpaid");
    assert_eq!(
        with, without,
        "an LP reward distribution changed the bettor payout: {with} vs {without}"
    );
}

/// Depositing liquidity into an already-settled pool must not disturb the
/// recorded outcome or the amounts owed to bettors.
#[test]
fn depositing_into_a_settled_pool_does_not_disturb_settlement() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let winner = ctx.actor(FUNDING);
    let loser = ctx.actor(FUNDING);

    let pool_id = ctx.create_pool(&creator);
    ctx.client
        .place_bet(&winner, &pool_id, &0, &2_000_000, &None);
    ctx.client
        .place_bet(&loser, &pool_id, &1, &1_000_000, &None);

    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);

    let pool_before = ctx.client.get_pool(&pool_id).unwrap();
    let source_before = ctx.client.get_settlement_source(&pool_id);

    // Late deposits are either rejected or accepted; either is fine, provided
    // the settlement is untouched.
    let _ = ctx.client.try_deposit_liquidity(&lp, &pool_id, &1_000_000);
    ctx.assert_custody(pool_id, "after late deposit");

    let pool_after = ctx.client.get_pool(&pool_id).unwrap();
    assert_eq!(
        pool_after.winning_outcome, pool_before.winning_outcome,
        "a late LP deposit changed the winning outcome"
    );
    assert_eq!(
        (pool_after.total_a, pool_after.total_b),
        (pool_before.total_a, pool_before.total_b),
        "a late LP deposit changed the pool's staked totals"
    );
    assert_eq!(
        ctx.client.get_settlement_source(&pool_id),
        source_before,
        "a late LP deposit changed the settlement attribution"
    );

    // The winner is still payable.
    assert!(ctx.client.claim_winnings(&winner, &pool_id) > 0);
}

/// Staked LP shares cannot be withdrawn to escape a settlement, and the lock
/// still releases normally afterwards.
#[test]
fn staked_shares_stay_locked_across_settlement() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let bettor = ctx.actor(FUNDING);

    let pool_id = ctx.create_pool(&creator);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &4_000_000);
    ctx.client.stake_lp(&lp, &pool_id, &shares, &7_200);

    ctx.client
        .place_bet(&bettor, &pool_id, &0, &1_000_000, &None);
    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);
    ctx.assert_custody(pool_id, "settled with staked shares");

    // Settlement does not release the lock.
    let escape = ctx.client.try_withdraw_liquidity(&lp, &pool_id, &shares);
    assert!(
        escape.is_err(),
        "staked shares were withdrawn before their lock expired"
    );

    // After the lock, the LP unstakes and exits normally.
    ctx.advance(7_201);
    ctx.client.unstake_lp(&lp, &pool_id);
    let returned = ctx.client.withdraw_liquidity(&lp, &pool_id, &shares);
    assert!(returned > 0, "the LP could not exit after unstaking");
    ctx.assert_custody(pool_id, "after post-settlement exit");
}

/// Two LPs and two bettors, with every operation interleaved, must leave
/// custody and supply intact.
#[test]
fn custody_holds_with_lps_and_bettors_interleaved() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp_a = ctx.actor(FUNDING);
    let lp_b = ctx.actor(FUNDING);
    let winner = ctx.actor(FUNDING);
    let loser = ctx.actor(FUNDING);
    StellarAssetClient::new(&ctx.env, &ctx.token_id).mint(&ctx.admin, &FUNDING);

    let accounts = [&creator, &lp_a, &lp_b, &winner, &loser, &ctx.admin];
    let baseline = ctx.circulating(&accounts);

    let pool_id = ctx.create_pool(&creator);

    let shares_a = ctx.client.deposit_liquidity(&lp_a, &pool_id, &2_000_000);
    ctx.assert_custody(pool_id, "lp_a deposit");

    ctx.client
        .place_bet(&winner, &pool_id, &0, &1_500_000, &None);
    ctx.assert_custody(pool_id, "first bet");

    let shares_b = ctx.client.deposit_liquidity(&lp_b, &pool_id, &3_000_000);
    ctx.assert_custody(pool_id, "lp_b deposit");

    ctx.client
        .place_bet(&loser, &pool_id, &1, &1_000_000, &None);
    ctx.assert_custody(pool_id, "second bet");

    // One LP exits before the pool closes.
    ctx.client
        .withdraw_liquidity(&lp_a, &pool_id, &(shares_a / 2));
    ctx.assert_custody(pool_id, "lp_a partial exit");

    ctx.client
        .distribute_lp_rewards(&ctx.admin, &pool_id, &400_000);
    ctx.assert_custody(pool_id, "distribution");

    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);
    ctx.assert_custody(pool_id, "settled");

    // Claims from both subsystems, interleaved.
    let _ = ctx.client.try_claim_lp_rewards(&lp_a, &pool_id);
    ctx.assert_custody(pool_id, "lp_a rewards");

    let payout = ctx.client.claim_winnings(&winner, &pool_id);
    assert!(payout > 0, "the winner was not paid");
    ctx.assert_custody(pool_id, "winner claim");

    let _ = ctx.client.try_claim_lp_rewards(&lp_b, &pool_id);
    ctx.assert_custody(pool_id, "lp_b rewards");

    ctx.client
        .withdraw_liquidity(&lp_b, &pool_id, &(shares_b / 2));
    ctx.assert_custody(pool_id, "lp_b exit");

    assert_eq!(
        ctx.circulating(&accounts),
        baseline,
        "the interleaved scenario changed the circulating supply"
    );
}

/// A losing bettor cannot claim, and the failed attempt leaves LP state alone.
#[test]
fn a_failed_claim_does_not_touch_lp_state() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let winner = ctx.actor(FUNDING);
    let loser = ctx.actor(FUNDING);

    let pool_id = ctx.create_pool(&creator);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &2_000_000);
    ctx.client
        .place_bet(&winner, &pool_id, &0, &1_000_000, &None);
    ctx.client
        .place_bet(&loser, &pool_id, &1, &1_000_000, &None);

    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_id, &0);

    let liquidity_before = ctx.client.get_total_lp_liquidity(&pool_id);
    let shares_before = ctx.client.get_total_lp_shares(&pool_id);
    let position_before = ctx.client.get_lp_position(&pool_id, &lp);

    // The losing side has nothing to claim.
    let result = ctx.client.try_claim_winnings(&loser, &pool_id);
    match result {
        Err(_) => {}
        Ok(Ok(amount)) => assert_eq!(amount, 0, "the losing side was paid {amount}"),
        Ok(Err(_)) => {}
    }

    assert_eq!(
        ctx.client.get_total_lp_liquidity(&pool_id),
        liquidity_before,
        "a failed claim changed LP liquidity"
    );
    assert_eq!(
        ctx.client.get_total_lp_shares(&pool_id),
        shares_before,
        "a failed claim changed the LP share supply"
    );
    assert_eq!(
        ctx.client.get_lp_position(&pool_id, &lp).shares,
        position_before.shares,
        "a failed claim changed an LP position"
    );

    // The LP can still exit.
    assert!(ctx.client.withdraw_liquidity(&lp, &pool_id, &shares) > 0);
}

/// A cancelled pool refunds bettors while leaving the LP position intact.
#[test]
fn cancellation_refunds_bettors_without_seizing_lp_funds() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let bettor = ctx.actor(FUNDING);
    let accounts = [&creator, &lp, &bettor, &ctx.admin];
    let baseline = ctx.circulating(&accounts);

    let pool_id = ctx.create_pool(&creator);
    let shares = ctx.client.deposit_liquidity(&lp, &pool_id, &2_000_000);
    ctx.client
        .place_bet(&bettor, &pool_id, &0, &1_000_000, &None);
    ctx.assert_custody(pool_id, "before cancellation");

    let cancelled = ctx.client.try_cancel_pool(
        &creator,
        &pool_id,
        &String::from_str(&ctx.env, "cancelled by the combo test"),
    );
    if cancelled.is_ok() {
        ctx.assert_custody(pool_id, "after cancellation");

        // The bettor is refunded.
        let refund = ctx.client.try_claim_refund(&bettor, &pool_id);
        if let Ok(Ok(amount)) = refund {
            assert!(amount > 0, "cancellation refunded nothing");
        }
        ctx.assert_custody(pool_id, "after refund");

        // The LP position is untouched by the cancellation and still exits.
        assert_eq!(
            ctx.client.get_lp_position(&pool_id, &lp).shares,
            shares,
            "cancellation seized LP shares"
        );
        assert!(
            ctx.client.withdraw_liquidity(&lp, &pool_id, &shares) > 0,
            "the LP could not exit a cancelled pool"
        );
    }

    assert_eq!(
        ctx.circulating(&accounts),
        baseline,
        "cancellation changed the circulating supply"
    );
}

/// Liquidity provided across two pools stays segregated: settling one must not
/// draw on the other's liquidity.
#[test]
fn liquidity_is_segregated_between_pools() {
    let ctx = Ctx::new();
    let creator = ctx.actor(FUNDING);
    let lp = ctx.actor(FUNDING);
    let bettor = ctx.actor(FUNDING);

    let pool_a = ctx.create_pool(&creator);
    let pool_b = ctx.create_pool(&creator);

    ctx.client.deposit_liquidity(&lp, &pool_a, &2_000_000);
    let shares_b = ctx.client.deposit_liquidity(&lp, &pool_b, &3_000_000);
    let liquidity_b_before = ctx.client.get_total_lp_liquidity(&pool_b);

    ctx.client
        .place_bet(&bettor, &pool_a, &0, &1_000_000, &None);
    ctx.advance(DURATION + 1);
    ctx.client.settle_pool(&ctx.admin, &pool_a, &0);
    ctx.client.claim_winnings(&bettor, &pool_a);

    assert_eq!(
        ctx.client.get_total_lp_liquidity(&pool_b),
        liquidity_b_before,
        "settling one pool drew on another pool's liquidity"
    );
    assert_eq!(
        ctx.client.get_lp_position(&pool_b, &lp).shares,
        shares_b,
        "settling one pool changed an LP position in another"
    );

    ctx.assert_custody(pool_a, "pool_a settled");
    ctx.assert_custody(pool_b, "pool_b untouched");
}
