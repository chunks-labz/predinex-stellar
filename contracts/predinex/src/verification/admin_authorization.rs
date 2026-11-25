//! Inventory of protocol role-gated writes. Each case exercises the public
//! client with a signed wrong-role call, then with its authorized signer.
//! Configuration, role and audit getters are public so observers can inspect
//! policy. One-time initialize is public at deployment. finalize_resolution
//! and refund_expired_pool are permissionless after their ledger deadlines.
//! Creator/delegated settlement and creator-owned edits have separate policy.

use super::{Harness, DEFAULT_DEPOSIT, DEFAULT_DURATION};
use crate::{ChainId, ContractError, DataKey};
use soroban_sdk::{String, Vec};

// Keep the exact Unauthorized assertion separate from the signature check:
// mock_all_auths lets both accounts sign, but must not grant either a role.
macro_rules! check {
    ($h:ident, $wrong:expr, $signer:expr, $method:ident $(, $arg:expr)* $(,)?) => {{
        let rejected = $h.client.$method($wrong $(, $arg)*);
        assert!(matches!(rejected, Err(Ok(ContractError::Unauthorized))), stringify!($method));
        let accepted = $h.client.$method($signer $(, $arg)*);
        assert!(matches!(&accepted, Ok(Ok(_))), stringify!($method));
        assert!($h.env.auths().iter().any(|(address, _)| address == $signer), stringify!($method));
        accepted.unwrap().unwrap()
    }};
}

#[test]
fn treasury_configuration_and_role_transfers() {
    let h = Harness::new(3);
    let treasury = &h.admin;
    let admin = &h.actors[0];
    let freeze = &h.actors[1];
    let other = &h.actors[2];
    let pool = h.create_pool(other, DEFAULT_DEPOSIT);
    check!(h, other, treasury, try_set_admin, admin);
    check!(h, admin, treasury, try_set_freeze_admin, freeze);
    check!(h, admin, treasury, try_set_fee_config, &10, treasury);
    check!(h, admin, treasury, try_set_creation_fee, &0);
    check!(h, admin, treasury, try_set_creation_fee_exemption, other, &true);
    check!(h, admin, treasury, try_set_protocol_fee, &100);
    check!(h, admin, treasury, try_set_volume_fee_tiers, &Vec::new(&h.env));
    check!(h, admin, treasury, try_set_pool_bet_limits, &pool, &1, &0);
    check!(h, admin, treasury, try_set_circuit_breaker_config, &0, &0, &0);
    check!(h, admin, treasury, try_set_stale_oracle_threshold, &3600);
    check!(h, admin, treasury, try_set_rate_limit_config, &10, &60);
    check!(h, admin, treasury, try_set_user_exposure_config, &0, &0, &0, &0, &0, &0, &0, &0);
    check!(h, admin, treasury, try_set_min_settlement_participants, &1);
    check!(h, admin, treasury, try_set_treasury_withdraw_limit, &0, &0);
    check!(h, admin, treasury, try_set_referral_bps, &10);
    check!(h, admin, treasury, try_set_bridge_timeout, &60);
    check!(h, admin, treasury, try_set_cross_chain_dispute_window, &60);
    check!(h, admin, treasury, try_set_lp_fee_allocation, &500);
    check!(h, admin, treasury, try_set_lp_stake_boost, &10_000);

    let url = String::from_str(&h.env, "https://example.org/events");
    check!(h, admin, treasury, try_register_webhook, &url, &Vec::new(&h.env));
    check!(h, admin, treasury, try_unregister_webhook, &url);
    let title = String::from_str(&h.env, "Template");
    let labels = soroban_sdk::vec![&h.env, String::from_str(&h.env, "Yes"), String::from_str(&h.env, "No")];
    let id = check!(h, admin, treasury, try_create_pool_template, &title, &title, &labels, &DEFAULT_DURATION, &None, &true);
    let template = h.client.get_templates().get(0).unwrap();
    check!(h, admin, treasury, try_update_pool_template, &id, &template);
    check!(h, admin, treasury, try_delete_pool_template, &id);

    for signer in [admin, treasury] {
        check!(h, freeze, signer, try_set_max_protocol_fee_bps, &1000);
        check!(h, freeze, signer, try_set_paused, &false);
        check!(h, freeze, signer, try_pause_contract);
        check!(h, freeze, signer, try_unpause_contract);
    }
    check!(h, admin, treasury, try_propose_admin, other);
    check!(h, treasury, other, try_accept_admin);
    check!(h, other, treasury, try_rotate_treasury_recipient, admin);
}

#[test]
fn market_controls_mirrors_and_funds() {
    let h = Harness::new(4);
    let treasury = &h.admin;
    let admin = &h.actors[0];
    let freeze = &h.actors[1];
    let creator = &h.actors[2];
    let bettor = &h.actors[3];
    h.client.set_admin(treasury, admin);
    h.client.set_freeze_admin(treasury, freeze);
    let pool = h.create_pool(creator, DEFAULT_DEPOSIT);
    let token = &h.token.address;
    check!(h, treasury, freeze, try_set_dispute_window, &0);
    check!(h, treasury, freeze, try_freeze_pool, &pool);
    check!(h, treasury, freeze, try_unfreeze_pool, &pool);
    check!(h, treasury, freeze, try_pause_market, &pool);
    check!(h, treasury, freeze, try_unpause_market, &pool);
    h.env.as_contract(&h.contract_id, || {
        h.env.storage().persistent().set(&DataKey::PoolCoolingUntil(pool), &120u64);
    });
    check!(h, freeze, treasury, try_override_pool_cooling, &pool);

    h.token_admin.mint(treasury, &1000);
    h.client.deposit_liquidity(bettor, &pool, &100);
    check!(h, admin, treasury, try_distribute_lp_rewards, &pool, &50);
    h.token_admin.mint(&h.contract_id, &1000);
    check!(h, admin, treasury, try_rescue_tokens, token, bettor, &1);
    h.env.as_contract(&h.contract_id, || {
        let storage = h.env.storage().persistent();
        storage.set(&DataKey::Treasury, &100i128);
        storage.set(&DataKey::TreasuryToken(token.clone()), &100i128);
    });
    check!(h, admin, treasury, try_withdraw_treasury, &1);

    check!(h, admin, treasury, try_set_token_exchange_rate, token, &10_000);
    let title = String::from_str(&h.env, "Multi asset");
    let labels = soroban_sdk::vec![&h.env, String::from_str(&h.env, "Yes"), String::from_str(&h.env, "No")];
    let multi = h.client.create_multi_asset_pool(creator, &title, &title, &labels, &DEFAULT_DURATION,
        &soroban_sdk::vec![&h.env, token.clone()], &None, &DEFAULT_DEPOSIT, &None);
    check!(h, admin, treasury, try_set_pool_token_bet_limits, &multi, token, &1, &0);
    h.client.place_multi_asset_bet(bettor, &multi, &0, &1000, token, &None);
    h.client.place_bet(bettor, &pool, &0, &1000, &None);
    h.advance(DEFAULT_DURATION + 1);
    h.client.settle_pool(admin, &multi, &0);
    check!(h, admin, treasury, try_collect_multi_asset_fees, &multi);
    h.client.settle_pool(admin, &pool, &0);
    check!(h, treasury, freeze, try_dispute_pool, &pool);
    h.client.unfreeze_pool(freeze, &pool);

    for (source, signer) in [(pool, admin), (multi, treasury)] {
        check!(h, admin, treasury, try_create_pool_mirror,
            &source, &ChainId::Stellar, &ChainId::Ethereum, creator);
        check!(h, admin, treasury, try_cancel_pool_mirror, &source);
        h.client.create_pool_mirror(
            treasury, &source, &ChainId::Stellar, &ChainId::Ethereum, creator,
        );
        check!(h, freeze, signer, try_settle_mirror_from_source, &source, &0);
    }
}
