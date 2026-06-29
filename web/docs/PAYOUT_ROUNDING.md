# Payout Rounding & Remainder Policy

> Reference: contract function `PredinexContract::claim_winnings` in
> `contracts/predinex/src/lib.rs`. Issue #158.

This document is the canonical reference for how the Predinex Soroban contract
handles integer-division remainders ("dust") that arise when winners claim
their share of a settled prediction pool. Indexers, analytics tooling, and UI
previews should rely on the policy described here rather than reverse-engineer
the math from contract source.

---

## TL;DR

- Per-claim payout is computed via integer floor division.
- The 2 % protocol fee is credited to the treasury **once** per pool, on the
  first claim.
- Any payout-rounding **dust** (residual `net_pool_balance − Σ payouts`) is
  swept to the treasury **on the final claim**.
- After every winner has claimed: `total_pool_balance = fee + payout_dust + Σ payouts`,
  and `contract_balance_attributable_to_pool = treasury_credit_for_pool = fee + payout_dust`.

---

## Math

For a settled pool with totals `pool.total_a` and `pool.total_b`:

```
total_pool_balance  = pool.total_a + pool.total_b
fee                 = floor(total_pool_balance * 2 / 100)
net_pool_balance    = total_pool_balance − fee
pool_winning_total  = pool.total_a   if winning_outcome == 0
                    = pool.total_b   if winning_outcome == 1
```

For each winner with stake `user_winning_bet` on the winning side:

```
winnings = floor(user_winning_bet * net_pool_balance / pool_winning_total)
```

Because every per-claim payout rounds down, the running sum of payouts is at
most `net_pool_balance`. The difference is the **payout dust**:

```
payout_dust = net_pool_balance − Σ winnings
```

`payout_dust` is non-negative and strictly less than `n_winners` token units
(in the worst case each winner contributes up to `1 − 1/pool_winning_total` of
a token unit to the residual).

## Where the dust goes

The dust is added to the protocol treasury **on the claim that brings
`Σ user_winning_bet` up to `pool_winning_total`** (the final winner). At that
moment the contract:

1. Pays out the final winner's `winnings` from the contract's token balance.
2. Credits `payout_dust = net_pool_balance − paid_out` to the on-chain
   `Treasury` ledger (and emits a `payout_dust` event when non-zero).

The dust tokens were never transferred out of the contract — they sat in the
contract's token balance from settlement onward — so the sweep is a pure
ledger update, not a token transfer.

## Where the protocol fee goes

The 2 % protocol `fee` is credited to the treasury **once per pool**, on the
first claim. Subsequent claims for the same pool do not re-credit the fee
(the contract tracks a `fee_credited` flag on the per-pool payout state).

The `fee_collected` event is emitted only on the claim that actually credits
the fee, so an indexer summing `fee_collected.fee` over time recovers the
protocol's fee revenue exactly.

## Per-pool payout state

The contract stores a `PoolPayoutState` value under
`DataKey::PoolPayoutState(pool_id)`:

```rust
pub struct PoolPayoutState {
    pub claimed_winning_stake: i128, // running Σ user_winning_bet
    pub paid_out: i128,              // running Σ winnings
    pub fee_credited: bool,          // fee already credited?
}
```

Read it via the contract function `get_pool_payout_state(pool_id) -> Option<PoolPayoutState>`:

- Returns `None` until the first claim has happened.
- After the first claim, fields update on every subsequent claim.
- After the final claim, `claimed_winning_stake == pool_winning_total` and
  the dust has been swept.

Indexers / UI previews can use this struct to display a live "claims so far",
"pending dust", or "fee already collected?" indicator without recomputing
from event history.

## Reconciliation invariants for indexers

After all winners have claimed (i.e. `claimed_winning_stake == pool_winning_total`):

```
fee + payout_dust + Σ winnings == total_pool_balance         # tokens accounted for
treasury_delta_for_pool        == fee + payout_dust          # all dust ends up in treasury
contract_balance_attributable  == fee + payout_dust          # token balance matches treasury
```

Mid-flight (some winners still to claim):

```
recorded_treasury += fee     once on the first claim
recorded_treasury += dust    on the final claim
                              (no re-credit for the fee, no per-claim dust event)
```

If a winner never claims (e.g. they lose access to their key), `claimed_winning_stake`
will permanently fall short of `pool_winning_total`, so dust is **never swept**
and stays in the contract's token balance. This is the only case where the
"contract balance == treasury" invariant does not hold automatically.

## Events

| Event             | Topics                                  | Data        | Emitted on |
|-------------------|-----------------------------------------|-------------|------------|
| `claim_winnings`  | `(Symbol("claim_winnings"), pool_id, user)` | `winnings`  | every claim |
| `fee_collected`   | `(Symbol("fee_collected"), pool_id)`    | `fee`       | first claim only |
| `payout_dust`     | `(Symbol("payout_dust"), pool_id)`      | `payout_dust` | final claim, when dust > 0 |

> See `web/docs/CONTRACT_EVENTS.md` for the full event reference.

## UI guidance

- A pool's expected winnings preview should use the floor formula above.
  Per-user payouts are deterministic the moment a pool is settled and do
  not depend on claim order.
- A "treasury fee" badge on a pool can show `expected_fee + expected_dust_upper_bound`
  (where `expected_dust_upper_bound = max(0, n_winners - 1)`) before claims
  happen, then resolve to the exact `fee + payout_dust` after the final claim.
- Aggregating protocol revenue from on-chain events: sum
  `fee_collected.fee + payout_dust.payout_dust` across all pools.

## Worked examples

### Example 1 — Dust leaving (3 winners, single loser)

```
Stakes:        a1=10, a2=10, a3=10 on outcome 0; b=70 on outcome 1
Settle:        outcome 0 wins
total_pool_balance      = 100
fee                     = floor(100 * 2 / 100) = 2
net_pool_balance        = 98
pool_winning_total      = 30
each formula winning    = floor(10 * 98 / 30) = 32
sum(winnings)           = 96
payout_dust             = 98 − 96 = 2

Treasury after claim 1:  2     (fee credited)
Treasury after claim 2:  2     (no re-credit, no dust yet)
Treasury after claim 3:  4     (dust swept: 2 + 2)
Contract balance after claim 3: 4   (matches treasury)
```

### Example 2 — No dust (clean division)

```
Stakes:        a1=50, a2=50 on outcome 0; b=100 on outcome 1
Settle:        outcome 0 wins
total_pool_balance      = 200
fee                     = 4
net_pool_balance        = 196
pool_winning_total      = 100
each formula winning    = floor(50 * 196 / 100) = 98
sum(winnings)           = 196
payout_dust             = 0

Treasury after claim 1:  4     (fee credited)
Treasury after claim 2:  4     (no re-credit, no dust)
Contract balance:        4     (matches treasury)
```
