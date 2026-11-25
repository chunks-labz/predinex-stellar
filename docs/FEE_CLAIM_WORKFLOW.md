# Fee Claim Workflow

This document explains how protocol fees accrue in the Predinex contract, who is eligible to claim them, and the exact steps to execute a claim. It is written for operators and integrators who manage treasury or fee-recipient accounts.

For the full fee schedule (rates, caps, constants, and error codes), see [`FEE_SCHEDULE.md`](./FEE_SCHEDULE.md). For the per-winner payout lifecycle, see [`CLAIM_LIFECYCLE.md`](./CLAIM_LIFECYCLE.md).

---

## 1. Fee types and their recipients

| Fee | Recipient | Triggered by | Collection path |
|---|---|---|---|
| Bet fee | `FeeRecipient` (or treasury if unset) | `place_bet`, `place_bet_with_referral` | Transferred immediately at bet time |
| Creation fee | Treasury recipient | `create_pool`, `create_multi_outcome_pool`, `schedule_pool` | Transferred immediately at pool creation |
| Settlement (protocol) fee | Treasury recipient + optional LP split | First `claim_winnings` on a settled pool | Credited from pool balance on first winner claim |
| LP fee split | Liquidity providers, pro-rata by share | First `claim_winnings` | Distributed from settlement fee allocation |
| Payout dust | Treasury recipient | Last `claim_winnings` on a pool | Swept automatically on the final winner claim |
| Referral reward | Referred wallet | `place_bet_with_referral` | Transferred immediately from contract balance |

Bet fees and creation fees require no manual claim — they are pushed to the recipient at the time of the transaction. The settlement fee and dust require a winner to call `claim_winnings`, which causes the fee to be credited to the treasury as a side effect of the first claim.

---

## 2. Eligibility

### Treasury recipient

The treasury recipient is the address returned by `get_treasury_recipient()`. It receives:

- Creation fees (immediately on pool creation).
- The settlement fee split (credited when the first winner claims).
- Payout dust (credited when the last winner claims).
- Bet fees when no `FeeRecipient` is configured.

The treasury recipient is set at contract initialization and can only be changed by the current admin via `set_treasury_recipient(admin, new_recipient)`.

### Fee recipient (bet fee)

A separate `FeeRecipient` can be configured for bet fees via `set_fee_config(caller, fee_rate, fee_recipient)`. Only the treasury recipient may call this setter. If no `FeeRecipient` is set, bet fees fall back to the treasury recipient.

### LP fee eligibility

Liquidity providers earn a share of the settlement fee if `get_lp_fee_bps() > 0`. Their share is proportional to their pool liquidity contribution at settlement time. LP shares are credited inside `claim_winnings` on the first winner claim.

---

## 3. Accrual

### Bet fee accrual

Accrues transaction-by-transaction. Each `place_bet` call computes `fee = floor(amount × fee_rate / 10_000)` and immediately transfers it to `FeeRecipient` (or treasury). The contract does not hold bet fees in its balance after the bet lands.

### Creation fee accrual

Accrues per pool. If `get_creation_fee() > 0` and the creator is not exempt (`is_creation_fee_exempt(creator) == false`), the flat creation fee is transferred from the creator to the treasury recipient and added to the treasury ledger at pool creation.

### Settlement fee accrual

Accrues per pool at settlement and is credited to the treasury on the first `claim_winnings` call:

1. `settle_pool` locks the settlement fee rate for the pool as `PoolFeeBps`.
2. The first call to `claim_winnings` (or `claim_all_winnings` / `claim_multi_asset_winnings`) computes the fee: `fee = floor(total_pool × fee_bps / 10_000)`.
3. The fee is credited to the treasury ledger (`get_treasury_balance`) and the LP split is distributed.
4. `fee_credited` in `get_pool_payout_state(pool_id)` flips to `true`.

If no winner ever claims, the settlement fee is never credited. This is expected: unclaimed prize pools remain in contract custody.

### Payout dust accrual

Accrues on the final winner claim. Floor-division leaves at most `(winner_count - 1)` units of dust in the pool. The final claim sweeps this dust to the treasury, keeping the pool balance at zero.

---

## 4. Claim steps

The protocol fee and dust are credited automatically inside `claim_winnings`. There is no separate admin action required. The steps below describe how to trigger a claim and verify that fees have been credited.

### 4.1 Set the shell variables

```bash
export CONTRACT_ID=C...                              # deployed predinex contract
export NETWORK=mainnet                               # or testnet
export RPC_URL=https://soroban-mainnet.stellar.org
export TREASURY=G...                                 # get_treasury_recipient()
export POOL_ID=<pool-id>                             # target pool
```

### 4.2 Confirm the pool is settled and uncredited

```bash
# Confirm pool is settled
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_pool $POOL_ID

# Confirm fee has not yet been credited
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_pool_payout_state --pool_id $POOL_ID
# fee_credited: false → first winner claim will credit the treasury
# fee_credited: true  → fee already paid; check get_treasury_balance
```

### 4.3 Read the current treasury balance

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_treasury_balance
```

### 4.4 Trigger the first winner claim

If the pool has winners and no one has claimed yet, call `claim_winnings` as any winner:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account <winner-secret-key> \
  -- claim_winnings \
    --user <winner-address> \
    --pool_id $POOL_ID
```

After this call, `fee_credited` will be `true` and `get_treasury_balance` will reflect the new fee.

### 4.5 Withdraw from the treasury balance

The treasury balance is an on-chain ledger entry. To move funds out, the treasury recipient calls `withdraw_treasury(caller, amount, to)`:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source-account <treasury-secret-key> \
  -- withdraw_treasury \
    --caller $TREASURY \
    --amount <amount-in-stroops> \
    --to <destination-address>
```

`withdraw_treasury` requires `caller.require_auth()`. Any caller other than the treasury recipient gets `Unauthorized` (error 3).

---

## 5. Required permissions

| Action | Required caller | Error if wrong |
|---|---|---|
| `set_fee_config` | Treasury recipient | `Unauthorized` (3) |
| `set_creation_fee` | Treasury recipient | `Unauthorized` (3) |
| `set_creation_fee_exemption` | Treasury recipient | `Unauthorized` (3) |
| `withdraw_treasury` | Treasury recipient | `Unauthorized` (3) |
| `set_treasury_recipient` | Admin | `Unauthorized` (3) |
| `claim_winnings` | Any winner (self-claim) | `NoBetFound` (23) if caller has no winning bet |

---

## 6. Expected errors

| Error | Code | Cause | Resolution |
|---|---|---|---|
| `Unauthorized` | 3 | Wrong caller on a fee-setter or treasury withdrawal | Confirm the signing key matches `get_treasury_recipient()` or `get_admin()` |
| `FeeOutOfBounds` | 4 | `fee_rate > BET_FEE_MAX_BPS` (1000) or `fee_bps > PROTOCOL_FEE_MAX_BPS` (1000) | Use a rate ≤ 10% |
| `FeeMustBeNonNegative` | 38 | Creation fee set to a negative value | Use a value ≥ 0 |
| `NoBetFound` | 23 | `claim_winnings` called for a user with no winning bet | Verify the user placed a bet on the winning outcome |
| `ResolutionNotFinal` | 94 | Claim attempted before the dispute window closes | Wait until `get_resolution_deadline(pool_id)` has passed, then retry |
| `PoolIsDisputed` | 17 | Pool is under dispute review | Wait for `unfreeze_pool` from the freeze admin |
| `ContractPaused` | 50 | Contract globally paused | Wait for `unpause_contract` from admin or treasury recipient |
| `InsufficientFunds` | — | `withdraw_treasury` amount exceeds `get_treasury_balance()` | Withdraw at most the available balance |

---

## 7. Troubleshooting

### Fee credited is `false` on a settled pool with winners

The settlement fee is credited on the first `claim_winnings` call, not at settlement. If no winner has claimed yet, `fee_credited` remains `false`. This is not an error. The fee will be credited as soon as any winner claims.

### Treasury balance did not increase after a claim

- Check that the pool's `PoolFeeBps` is greater than zero (`get_fee_schedule` for volume-tier pools, or `get_max_protocol_fee_bps` for the flat rate).
- Check the LP fee split: if `get_lp_fee_bps() > 0`, part of the fee goes to liquidity providers rather than the treasury.
- Confirm you are querying the correct contract and network.

### `withdraw_treasury` fails with `Unauthorized`

The signing key does not match `get_treasury_recipient()`. Run `get_treasury_recipient()` to confirm the expected address, then use the correct key.

### Fee accrued on testnet but not visible on mainnet

Each deployment is an independent contract. Treasury balances are not shared across networks. Verify `CONTRACT_ID` and `NETWORK` point to the correct environment.

### Creation fee not charged

The creator may be exempt. Check `is_creation_fee_exempt(<creator-address>)`. If `true`, the fee is waived for that address. Only the treasury recipient can revoke exemption with `set_creation_fee_exemption(caller, account, false)`.

---

## 8. Related documents

- [`FEE_SCHEDULE.md`](./FEE_SCHEDULE.md) — full rate table, constants, and error codes
- [`CLAIM_LIFECYCLE.md`](./CLAIM_LIFECYCLE.md) — winner claim states and auto-finalization
- [`MARKET_LIFECYCLE.md`](./MARKET_LIFECYCLE.md) — pool states from creation through settlement
- [`INCIDENT_RUNBOOK.md`](./INCIDENT_RUNBOOK.md) — incident response for settlement and fee failures
- [`CONTRACT_API.md`](./CONTRACT_API.md) — full public function reference
