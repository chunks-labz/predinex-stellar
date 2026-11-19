# Paused-Contract Incident Runbook

Use this runbook when the Predinex contract is **globally paused** (`is_paused() == true`), whether you paused it on purpose or found it paused. For general severity levels, escalation, and incident-commander duties, see [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md). This page covers only what is specific to the pause flag.

> **Global pause vs. pool freeze.** They are different mechanisms with different keys:
>
> | | Global pause | Pool freeze |
> |---|---|---|
> | Calls | `set_paused`, `pause_contract`, `unpause_contract` | `freeze_pool` / `pause_market`, `unfreeze_pool` / `unpause_market` |
> | Scope | Every pool | One pool |
> | Authorized key | **Admin or treasury recipient** | **Freeze admin** |
> | Error seen by callers | `ContractPaused` (50) | `PoolIsFrozen` (16) |
>
> The freeze admin **cannot** pause or unpause the contract. If you are dealing with a single frozen pool, see [`MARKET_LIFECYCLE.md`](./MARKET_LIFECYCLE.md) instead.

Shell variables used below:

```bash
export CONTRACT_ID=C...          # deployed predinex contract
export NETWORK=mainnet           # or testnet
export ADMIN=G...                # get_admin()
export TREASURY=G...             # get_treasury_recipient()
```

---

## 1. Detection

Treat any one of these signals as a possible pause. Then confirm with step 1.1.

| Signal | Where |
|---|---|
| `ContractPaused` (error code 50) returned by bets, claims or settlements | Web/API error logs, wallet error toasts, user reports |
| `contract_paused` event (and `PoolPaused` when `pause_contract` was used) | Event indexer / `get_events` for `$CONTRACT_ID` |
| Settlement bot `settle_pools` transactions failing in full (the batch panics with `ContractPaused`), and settlement lag climbing | Bot logs, `GET /health/metrics` |
| Settlement lag alert / no `settle_pool` events after pools expire | Monitoring dashboards |

### 1.1 Confirm and attribute

```bash
# Is the contract paused?
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- is_paused

# Who currently holds the keys that can unpause it?
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_admin
stellar contract invoke --id $CONTRACT_ID --network $NETWORK -- get_treasury_recipient
```

Find the most recent `contract_paused` event. Its payload contains the **caller** that paused the contract. The same call is also written to the on-chain audit log as a `set_paused` / `pause_contract` entry.

Classify the pause:

| Caller | Planned? | Severity |
|---|---|---|
| Admin or treasury recipient, matching an announced maintenance or incident action | Yes | Track under the existing incident or change ticket |
| Admin or treasury recipient, **no** matching action | No | **SEV-1**: treat the key as possibly compromised (go to §3.3) |

Record the pause ledger, timestamp and caller in the incident channel before you do anything else.

---

## 2. Caller impact

The flag is checked by `require_not_paused` at the start of each guarded entrypoint. Guarded calls fail with `ContractPaused` (50) and change no state.

### 2.1 Blocked while paused

| Area | Entrypoints |
|---|---|
| Betting | `place_bet`, `place_bet_with_referral`, `place_multi_asset_bet`, `cancel_bet` |
| Pool management | `cancel_pool`, `extend_pool_duration`, `void_pool` |
| Settlement | `settle_pool`, `settle_pools` (the whole batch panics), `settle_mirror_from_source` |
| Claims and refunds | `claim_winnings`, `claim_all_winnings` (each entry returns code 50), `claim_multi_asset_winnings`, `claim_refund`, `claim_expired`, `refund_expired_pool`, `execute_scheduled_claims` (due entries are skipped and stay `Pending`) |
| Liquidity | `deposit_liquidity`, `withdraw_liquidity`, `claim_lp_rewards`, `stake_lp` |
| Lending planner | `budget_plan`, `lender_portfolio_metrics` |

### 2.2 Still works while paused

| Area | Entrypoints | Why it matters |
|---|---|---|
| Pool creation | `create_pool`, `create_multi_outcome_pool`, `schedule_pool`, `activate_scheduled_pool` | **Not guarded.** Creators can still lock up a deposit and creation fee in a pool nobody can bet on. Tell users not to create pools, or hide the create flow in the web app. |
| Finalization | `finalize_resolution` | `ResolutionPending` pools can still move to `Settled`, but nobody can claim them. |
| Disputes and freezes | `dispute_pool`, `freeze_pool`, `unfreeze_pool`, `set_dispute_window` | The freeze admin can keep working per pool during the pause. |
| Treasury and config | `withdraw_treasury`, `rescue_tokens`, every fee/limit setter, `set_admin` / `propose_admin` / `accept_admin`, `set_freeze_admin`, `rotate_treasury_recipient` | Key rotation and recovery can happen **during** the pause. |
| Other | `claim_referral_rewards`, `assign_settler`, `update_twap`, all read-only getters | |

### 2.3 Clocks keep running

Pausing does not stop time-based rules. Expect the following when you unpause:

- **Pool expiry** passes as normal, so bets cannot resume on pools that expired during the pause.
- **Dispute windows** close (`now > settlement_time + window`). Any dispute that was planned for the pause period has to be filed before the window ends, which is possible because `dispute_pool` is not guarded.
- **Refund grace period** (`GRACE_PERIOD_SECS`, 7 days) keeps running, so `refund_expired_pool` may become callable on many pools at once after unpause.
- **Deposit deadlines** and **scheduled `open_at` times** pass.

### 2.4 User communication

Post a status banner that says: bets, claims, refunds and LP withdrawals are temporarily unavailable; funds stay in contract custody; and do not create new markets until further notice. Give the time of the next update.

---

## 3. Unpause authorization

### 3.1 Who can unpause

Only the **admin** (`get_admin`) or the **treasury recipient** (`get_treasury_recipient`) can call `set_paused(false)` / `unpause_contract`. Any other caller gets `Unauthorized` (3). The settlement bot key is usually the admin. **Do not** unpause from the bot host. Use the operator signer.

### 3.2 Go / no-go checklist

The incident commander signs off on all of these in the incident channel before unpausing:

- [ ] Root cause is identified, and is fixed or contained (contract upgraded, key rotated, upstream restored, and so on).
- [ ] Any pool that is still affected is frozen individually (`freeze_pool`), so that unpausing does not re-expose it.
- [ ] Pending settlements are reviewed: the outcomes the bot will submit are correct (`ORACLE_URL` healthy, `ORACLE_FALLBACK_TO_DEFAULT=false`).
- [ ] The bot is set to `DRY_RUN=true` or `AUTO_SETTLE_ENABLED=false`, so that the first post-unpause cycle can be watched.
- [ ] Two people have checked that the signer is the intended key (`get_admin` / `get_treasury_recipient`).

### 3.3 If the pausing key may be compromised

Do **not** unpause first. While the contract is still paused:

1. From the treasury recipient, replace the admin: `propose_admin` to a fresh key, then `accept_admin` from that key. The full procedure is in [`ORACLE_ROTATION.md`](./ORACLE_ROTATION.md).
2. If the compromised key is the treasury recipient itself, call `rotate_treasury_recipient` from it **only if you still control it**. Otherwise escalate to the protocol lead. The treasury recipient can call `set_admin`, `set_freeze_admin` and every fee setter, so losing it is a contract-upgrade-level event.
3. Check that no fee, limit or role was changed by the attacker. Compare `get_fee_config`, `get_protocol_fee`, `get_max_protocol_fee_bps`, `get_volume_fee_tiers`, `get_freeze_admin` and `get_treasury_withdraw_limit` against the last known-good values (see [`FEE_SCHEDULE.md`](./FEE_SCHEDULE.md)).

### 3.4 Unpause

```bash
stellar contract invoke --id $CONTRACT_ID --source <admin-or-treasury-identity> --network $NETWORK \
  -- unpause_contract --caller $ADMIN
# equivalent: -- set_paused --caller $ADMIN --paused false
```

`unpause_contract` emits both `contract_unpaused` and `PoolUnpaused`. `set_paused(false)` emits only `contract_unpaused`. Indexers that watch only one of these should be checked.

---

## 4. Post-incident checks

Run these right after the unpause transaction confirms:

1. **Flag cleared:** `is_paused` returns `false`, and a `contract_unpaused` event with the expected caller is indexed.
2. **Smoke test on a low-value pool:** one `place_bet` succeeds, and one `preview_claimable_amount` call on a settled pool returns a value.
3. **Settlement backlog:** count pools that expired during the pause. Re-enable the bot (`DRY_RUN=false`, then `AUTO_SETTLE_ENABLED=true`) and watch settlement lag fall back to baseline. `settle_pools` handles at most 20 pools per transaction.
4. **Pending resolutions:** for each `ResolutionPending` pool whose deadline passed during the pause, either call `finalize_resolution` or let the first claim auto-finalize it. See [`CLAIM_LIFECYCLE.md`](./CLAIM_LIFECYCLE.md).
5. **Scheduled claims:** call `execute_scheduled_claims` until it returns an empty list or `ScheduledClaimNotDue`. Entries that were due during the pause are still `Pending`.
6. **Expired pools past grace:** look for pools that became eligible for `refund_expired_pool` during the pause, and decide whether operators should process them or leave them to users.
7. **Pools created during the pause:** list them, and contact the creators if they expected bets to work.
8. **Error rates:** `ContractPaused` errors in web/API logs drop to zero within one polling interval. If they do not, a cached client state needs to be invalidated.
9. **Config drift:** if the pause was unplanned, re-check every value from §3.3 step 3.
10. **Close out:** record the pause and unpause ledgers, total paused duration, affected pool IDs and user impact. Then follow the closure steps in [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md#closure).
