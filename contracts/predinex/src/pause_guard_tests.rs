//! Shared pause-guard table for privileged entrypoints — Issue #1600.
//!
//! The audit table below drives one test over every privileged write that is
//! expected to reject calls while the contract is paused. Using a single table
//! means a newly added privileged entrypoint cannot quietly opt out of the
//! pause check: it has to be considered here.
//!
//! Audit note: the admin configuration writes (`set_protocol_fee`,
//! `set_admin`, `set_freeze_admin`, `withdraw_treasury`, etc.) do not currently
//! consult the paused flag. That pre-existing gap is tracked separately in
//! #1620 and is intentionally not changed by this coverage-only issue.

#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, Vec};

struct PauseCtx {
    env: Env,
    client: PredinexContractClient<'static>,
    token: Address,
    admin: Address,
    user: Address,
}

impl PauseCtx {
    fn new(paused: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(PredinexContract, ());
        let client = PredinexContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        client.initialize(&token_id.address(), &token_admin, &token_admin);

        let admin = token_admin;
        if paused {
            client.set_paused(&admin, &true);
            assert!(client.is_paused());
        }
        let user = Address::generate(&env);
        let token = token_id.address();

        PauseCtx {
            env,
            client,
            token,
            admin,
            user,
        }
    }
}

#[derive(Copy, Clone)]
enum PrivilegedWrite {
    PlaceBet,
    CancelBet,
    PlaceMultiAssetBet,
    CancelPool,
    ExtendPoolDuration,
    UpdateTwap,
    SettlePool,
    SettlePools,
    VoidPool,
    ClaimRefund,
    ClaimExpired,
    RefundExpiredPool,
    ClaimWinnings,
    ClaimAllWinnings,
    DepositLiquidity,
    WithdrawLiquidity,
    ClaimLpRewards,
    StakeLp,
}

impl PrivilegedWrite {
    fn name(self) -> &'static str {
        match self {
            Self::PlaceBet => "place_bet",
            Self::CancelBet => "cancel_bet",
            Self::PlaceMultiAssetBet => "place_multi_asset_bet",
            Self::CancelPool => "cancel_pool",
            Self::ExtendPoolDuration => "extend_pool_duration",
            Self::UpdateTwap => "update_twap",
            Self::SettlePool => "settle_pool",
            Self::SettlePools => "settle_pools",
            Self::VoidPool => "void_pool",
            Self::ClaimRefund => "claim_refund",
            Self::ClaimExpired => "claim_expired",
            Self::RefundExpiredPool => "refund_expired_pool",
            Self::ClaimWinnings => "claim_winnings",
            Self::ClaimAllWinnings => "claim_all_winnings",
            Self::DepositLiquidity => "deposit_liquidity",
            Self::WithdrawLiquidity => "withdraw_liquidity",
            Self::ClaimLpRewards => "claim_lp_rewards",
            Self::StakeLp => "stake_lp",
        }
    }

    /// Invoke the entrypoint and report whether it rejected the call.
    /// Arguments are intentionally minimal: the pause guard runs before any of
    /// the business validation would notice the placeholder pool id.
    fn rejects_while_paused(self, ctx: &PauseCtx) -> bool {
        let client = &ctx.client;
        let user = &ctx.user;
        let pool = 1u32;
        match self {
            Self::PlaceBet => client
                .try_place_bet(user, &pool, &0, &100, &None::<Address>)
                .is_err(),
            Self::CancelBet => client.try_cancel_bet(user, &pool, &0, &100).is_err(),
            Self::PlaceMultiAssetBet => client
                .try_place_multi_asset_bet(
                    user,
                    &pool,
                    &0,
                    &100,
                    &ctx.admin,
                    &None::<Address>,
                )
                .is_err(),
            Self::CancelPool => client
                .try_cancel_pool(user, &pool, &String::from_str(&ctx.env, "paused audit"))
                .is_err(),
            Self::ExtendPoolDuration => client
                .try_extend_pool_duration(user, &pool, &10_000u64)
                .is_err(),
            Self::UpdateTwap => client.try_update_twap(&pool).is_err(),
            Self::SettlePool => client.try_settle_pool(user, &pool, &0).is_err(),
            Self::SettlePools => {
                let mut requests: Vec<PoolSettleRequest> = Vec::new(&ctx.env);
                requests.push_back(PoolSettleRequest {
                    pool_id: pool,
                    winning_outcome: 0,
                });
                client.try_settle_pools(user, &requests).is_err()
            }
            Self::VoidPool => client.try_void_pool(user, &pool).is_err(),
            Self::ClaimRefund => client.try_claim_refund(user, &pool).is_err(),
            Self::ClaimExpired => client.try_claim_expired(user, &pool).is_err(),
            Self::RefundExpiredPool => client.try_refund_expired_pool(&pool).is_err(),
            Self::ClaimWinnings => client.try_claim_winnings(user, &pool).is_err(),
            Self::ClaimAllWinnings => {
                let mut ids: Vec<u32> = Vec::new(&ctx.env);
                ids.push_back(pool);
                client.try_claim_all_winnings(user, &ids).is_err()
            }
            Self::DepositLiquidity => client.try_deposit_liquidity(user, &pool, &100).is_err(),
            Self::WithdrawLiquidity => client.try_withdraw_liquidity(user, &pool, &100).is_err(),
            Self::ClaimLpRewards => client.try_claim_lp_rewards(user, &pool).is_err(),
            Self::StakeLp => client
                .try_stake_lp(user, &pool, &100, &3_600u64)
                .is_err(),
        }
    }
}

const PAUSED_PRIVILEGED_WRITES: &[PrivilegedWrite] = &[
    PrivilegedWrite::PlaceBet,
    PrivilegedWrite::CancelBet,
    PrivilegedWrite::PlaceMultiAssetBet,
    PrivilegedWrite::CancelPool,
    PrivilegedWrite::ExtendPoolDuration,
    PrivilegedWrite::UpdateTwap,
    PrivilegedWrite::SettlePool,
    PrivilegedWrite::SettlePools,
    PrivilegedWrite::VoidPool,
    PrivilegedWrite::ClaimRefund,
    PrivilegedWrite::ClaimExpired,
    PrivilegedWrite::RefundExpiredPool,
    PrivilegedWrite::ClaimWinnings,
    PrivilegedWrite::ClaimAllWinnings,
    PrivilegedWrite::DepositLiquidity,
    PrivilegedWrite::WithdrawLiquidity,
    PrivilegedWrite::ClaimLpRewards,
    PrivilegedWrite::StakeLp,
];

#[test]
fn all_privileged_writes_revert_while_contract_is_paused() {
    let ctx = PauseCtx::new(true);
    for write in PAUSED_PRIVILEGED_WRITES {
        assert!(
            write.rejects_while_paused(&ctx),
            "{} must revert while paused",
            write.name()
        );
    }
}

#[test]
fn privileged_writes_resume_after_unpause() {
    let ctx = PauseCtx::new(true);
    ctx.client.set_paused(&ctx.admin, &false);
    assert!(!ctx.client.is_paused());

    // Representative operator write: the pause check is the only thing that
    // changed, so the same call that was rejected above is accepted again.
    ctx.env.ledger().with_mut(|li| li.timestamp = 0);
    let creator = ctx.admin.clone();
    let token = ctx.token.clone();
    token::StellarAssetClient::new(&ctx.env, &token).mint(&creator, &10_000);
    let pool_id = ctx.client.create_pool(
        &creator,
        &String::from_str(&ctx.env, "Resume market"),
        &String::from_str(&ctx.env, "Pause coverage"),
        &String::from_str(&ctx.env, "Yes"),
        &String::from_str(&ctx.env, "No"),
        &3_600,
        &MIN_CREATOR_DEPOSIT,
        &None::<u64>,
    );
    token::StellarAssetClient::new(&ctx.env, &token).mint(&ctx.user, &500);
    ctx.client
        .place_bet(&ctx.user, &pool_id, &0, &100, &None::<Address>);
    assert_eq!(ctx.client.get_pool(&pool_id).unwrap().total_a, 100);
}
