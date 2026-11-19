# Fee Schedule and Caps

This page lists every fee the Predinex contract (`contracts/predinex/src/lib.rs`) can charge: who pays it, where it goes, who can change it, and which constant and error code enforce its cap.

All rates are in **basis points** (1 bp = 0.01%, `10_000` = 100%). All amounts are in the pool token's base units (stroops for XLM). Fee math always rounds **down**: `fee = floor(amount × bps / 10_000)`.

---

## 1. Summary

| Fee | Who pays | Charged in | Default | Cap / bound (constant) | Error when exceeded |
|---|---|---|---|---|---|
| [Bet fee](#2-bet-fee) | Bettor | `place_bet`, `place_bet_with_referral` | `0` bps | ≤ `BET_FEE_MAX_BPS` = 1000 (10%) | `FeeOutOfBounds` (4) |
| [Creation fee](#3-creation-fee) | Pool creator, unless exempt | `create_pool`, `create_multi_outcome_pool`, `schedule_pool` | `0` | ≥ 0, no upper cap | `FeeMustBeNonNegative` (38) |
| [Settlement (protocol) fee](#4-settlement-protocol-fee) | Winners: deducted from the pool before payout | Locked by `settle_pool`, collected on first `claim_winnings` | `PROTOCOL_FEE_DEFAULT_BPS` = 200 (2%) | `PROTOCOL_FEE_MIN_BPS` = 0 … `get_max_protocol_fee_bps()` (≤ `PROTOCOL_FEE_MAX_BPS` = 1000) | `FeeOutOfBounds` (4) |
| [Volume fee tiers](#5-volume-fee-tiers) | Winners: replaces the flat settlement fee | `settle_pool` | none | ≤ `MAX_FEE_TIERS` = 5 tiers, each `fee_bps` ≤ cap | `FeeOutOfBounds` (4) |
| [LP fee allocation](#6-lp-fee-allocation) | Nobody extra: a split of the settlement fee | First `claim_winnings` | `0` bps | ≤ 10_000 bps (inline literal) | `FeeOutOfBounds` (4) |
| [Referral reward](#7-referral-reward) | Contract balance, not the bettor | `place_bet` with a referrer | `0` bps | ≤ `PROTOCOL_FEE_MAX_BPS` = 1000 | `FeeOutOfBounds` (4) |
| [Multi-asset settlement fee](#8-multi-asset-pools) | Winners in each token | `claim_multi_asset_winnings` | same rate as §4 | same as §4 | same as §4 |

These are **not** fees but are often mistaken for them:

| Item | Constant | Error | Notes |
|---|---|---|---|
| Creator deposit | `MIN_CREATOR_DEPOSIT` = 10_000_000 (1 XLM at 7 decimals) | `InsufficientCreatorDeposit` (65) | Anti-spam floor. Transferred into contract custody on pool creation; **not** credited to the treasury. |
| Payout dust | — | — | Floor-division remainder (< 1 unit per winner). Swept to the treasury on the final winner claim so that `total == fee + dust + Σ payouts`. |

All fee setters require `caller.require_auth()`. A wrong caller gets `Unauthorized` (3).

---

## 2. Bet fee

| | |
|---|---|
| Storage | `DataKey::FeeRate` (bps), `DataKey::FeeRecipient` |
| Setter | `set_fee_config(caller, fee_rate, fee_recipient)`, **treasury recipient only** |
| Getter | `get_fee_config() -> (u32, Address)` |
| Cap check | `fee_rate > BET_FEE_MAX_BPS` → `FeeOutOfBounds` |
| Event | `FeeConfigUpdated` (old/new rate and recipient) |

`fee = floor(amount × fee_rate / 10_000)` is taken from the gross bet. Only `net_amount = amount − fee` enters the pool totals, so odds and payouts are computed on net stakes. The fee is transferred straight to `FeeRecipient`. If that is unset, it goes to the treasury recipient, and if that is also unset, it stays with the contract. It is **not** added to the on-chain treasury ledger (`get_treasury_balance`).

`initialize` sets the rate to `0`, so no bet fee is charged until `set_fee_config` is called.

## 3. Creation fee

| | |
|---|---|
| Storage | `DataKey::CreationFee` (absolute amount), `DataKey::CreationFeeExempt(Address)` |
| Setters | `set_creation_fee(caller, fee)`, `set_creation_fee_exemption(caller, account, exempt)`, **treasury recipient only** |
| Getters | `get_creation_fee()`, `is_creation_fee_exempt(account)` |
| Bound check | `fee < 0` → `FeeMustBeNonNegative` |
| Events | `creation_fee_set`, `creation_fee_exemption_set` |

The fee is a flat amount, not bps. When it is greater than 0 and the creator is not exempt, it is transferred from the creator to the treasury recipient **and** added to the treasury ledger. **There is no upper cap.** Operators should treat a large change to this value as a governance action.

## 4. Settlement (protocol) fee

| | |
|---|---|
| Storage | `DataKey::ProtocolFee` (flat bps), `DataKey::ProtocolFeeCap`, per-pool `DataKey::PoolFeeBps(pool_id)` and `DataKey::PoolSettlementProtocolFee(pool_id)` |
| Setter | `set_protocol_fee(caller, fee_bps)`, **treasury recipient only** |
| Cap setter | `set_max_protocol_fee_bps(caller, cap_bps)`, **admin or treasury recipient** |
| Getters | `get_protocol_fee()`, `get_max_protocol_fee_bps()`, `get_config().protocol_fee_bps` |
| Events | `protocol_fee_set`, `protocol_fee_cap_set` |

**Who pays:** winners. The fee comes out of the pool, not out of an individual claim:

```
fee         = floor(total_pool × fee_bps / 10_000)
user_payout = floor(user_winning_stake × (total_pool − fee) / winning_side_total)
```

**When it is fixed:** at `settle_pool`. The rate that applies (flat, or tiered per §5) is written to `PoolFeeBps(pool_id)`. Later calls to `set_protocol_fee` therefore **do not** change payouts for pools that are already settled. The fee amount is recorded in `PoolSettlementProtocolFee(pool_id)` and in the `settle_pool` event (`fee_amount`).

**When it is collected:** on the **first** winner claim (`PoolPayoutState.fee_credited`). The fee is then credited to the treasury ledger, minus any LP share (§6).

**Where the cap is enforced (two layers):**

1. `PROTOCOL_FEE_MAX_BPS` = 1000 is a hard ceiling compiled into the contract. `set_max_protocol_fee_bps` rejects `cap_bps > 1000`.
2. `ProtocolFeeCap` is the governance cap (defaults to the hard ceiling). `set_protocol_fee` and `set_volume_fee_tiers` reject any value above it. `set_max_protocol_fee_bps` also rejects a new cap that is **lower** than the current flat fee or any configured tier, so lowering the cap never strands an existing configuration above it.

All three reject with `FeeOutOfBounds` (4).

Related settlement error: `NoWinningBets` (60). `settle_pool` refuses to settle to an outcome nobody backed, so a fee is never recorded that could not be collected.

## 5. Volume fee tiers

| | |
|---|---|
| Storage | `DataKey::VolumeFeeTiers` (`Vec<FeeTier { volume_threshold, fee_bps }>`) |
| Setter | `set_volume_fee_tiers(caller, tiers)`, **treasury recipient only**. An empty vector clears the tiers. |
| Getter | `get_volume_fee_tiers()` |
| Event | `volume_fee_tiers_set` |

At settlement, the pool uses the `fee_bps` of the highest tier whose `volume_threshold <= total_pool`. Pools below the first tier use the flat fee. `set_volume_fee_tiers` rejects the following with `FeeOutOfBounds`:

- more than `MAX_FEE_TIERS` (5) tiers
- a negative `volume_threshold`
- thresholds that are not strictly ascending
- any `fee_bps` above `get_max_protocol_fee_bps()`

## 6. LP fee allocation

| | |
|---|---|
| Storage | `DataKey::LpFeeAllocationBps` |
| Setter | `set_lp_fee_allocation(caller, bps)`, **treasury recipient only** |
| Bound check | `bps > 10_000` → `FeeOutOfBounds` |
| Event | `lp_fee_allocation_set` |

This is not an additional charge. On the first claim, `floor(fee × bps / 10_000)` of the settlement fee is routed to the pool's LP reward accumulator instead of the treasury. If the pool has no LP shares, the whole fee goes to the treasury. Payout dust always goes to the treasury.

## 7. Referral reward

| | |
|---|---|
| Storage | `DataKey::ReferralBps`, `DataKey::ReferralBalance(referrer)`, `DataKey::TotalPendingReferralRewards` |
| Setter | `set_referral_bps(caller, bps)`, **treasury recipient only** |
| Bound check | `bps > PROTOCOL_FEE_MAX_BPS` → `FeeOutOfBounds` |
| Payout | `claim_referral_rewards(referrer)` |
| Event | `referral_bps_set`, `referral_reward_claimed` |

`reward = floor(gross_amount × bps / 10_000)` is credited to the referrer for each referred bet. The reward is **not** deducted from the bettor's stake or from the bet fee. It is paid from the contract's token balance when claimed. Outstanding rewards are tracked in `TotalPendingReferralRewards` and excluded from `rescue_tokens`. Before you raise this rate, make sure the bet fee revenue covers it. Validation errors: `SelfReferral` (61), `InvalidReferrer` (999), `NoReferralRewards` (62).

## 8. Multi-asset pools

The settlement fee applies per token at the pool's locked rate. Per-token fees accumulate in `PoolTokenFeePending(pool_id, token)` on the first `claim_multi_asset_winnings`. The treasury recipient then moves them with `collect_multi_asset_fees(caller, pool_id)`, which requires the pool to be `Settled` (otherwise `PoolNotSettled` (18)).

---

## 9. Getting fees out: the treasury

The creation fee, settlement fee (less the LP share), and payout dust accumulate in the on-chain treasury ledger:

| Call | Who | Errors |
|---|---|---|
| `get_treasury_balance()`, `get_withdrawable_treasury()` | Anyone | — |
| `withdraw_treasury(caller, amount)` | Treasury recipient | `InvalidWithdrawalAmount` (27), `InsufficientTreasuryBalance` (26), `RateLimitExceeded` (49), `TransferBalanceMismatch` (92) |
| `set_treasury_withdraw_limit(caller, max_per_window, window_secs)` | Treasury recipient | `InvalidRateLimitConfig` (48) |
| `rotate_treasury_recipient(caller, new_recipient)` | Current treasury recipient | `Unauthorized` (3) |

Treasury withdrawals and all fee setters keep working while the contract is globally paused. See [`PAUSED_CONTRACT_RUNBOOK.md`](./PAUSED_CONTRACT_RUNBOOK.md).

## 10. Who can change what

| Role | Can change |
|---|---|
| Treasury recipient | Bet fee and recipient, creation fee and exemptions, flat settlement fee, volume tiers, LP allocation, referral rate, treasury withdraw limit |
| Admin **or** treasury recipient | Settlement fee cap (`set_max_protocol_fee_bps`) |
| Nobody (compile-time) | `BET_FEE_MAX_BPS`, `PROTOCOL_FEE_MAX_BPS`, `MAX_FEE_TIERS`, `MIN_CREATOR_DEPOSIT` |

Changing a compile-time constant requires a contract upgrade. See [`CONTRACT_UPGRADE_PROCEDURE.md`](./CONTRACT_UPGRADE_PROCEDURE.md).
