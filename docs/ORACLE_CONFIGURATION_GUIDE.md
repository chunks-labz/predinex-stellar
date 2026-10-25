# Settlement Authority (Oracle) Configuration

A prediction market has to learn how the world turned out. `predinex` has no
external price feed — the role an oracle plays in other protocols is filled here
by the **settlement authority**: whoever is permitted to call `settle_pool` and
declare the winning outcome.

Because that role decides which side is paid, its configuration *is* the oracle
configuration for this protocol. This document specifies it. The properties
below are verified by `contracts/predinex/src/verification/oracle_spec.rs`; see
[`FORMAL_VERIFICATION.md`](./FORMAL_VERIFICATION.md) for how that suite works.

## The three roles

| Role | Who | How it is granted |
|------|-----|-------------------|
| **Admin** | Protocol admin | Set at `initialize`; can settle any pool |
| **Creator** | The account that created the pool | Implicit; can settle its own pool |
| **Operator** | A delegate | `assign_settler(creator, pool_id, settler)` |

No other account can settle a pool, under any sequence of calls. Notably,
**betting into a pool confers no settlement authority** — a participant is not a
settler.

Every settlement records which role acted, retrievable via
`get_settlement_source(pool_id)`:

```rust
pub enum SettlementSource {
    Admin,     // the protocol admin settled directly
    Creator,   // the pool creator settled its own pool
    Operator,  // a delegate assigned via assign_settler
    Expired,   // permissionless settlement of an expired pool
    Delegated, // delegated settlement
}
```

Attribution is not decoration. A disputed resolution has to be traceable to a
principal, and the source is the only on-chain record of which one acted.

## Delegating settlement

```rust
client.assign_settler(&creator, &pool_id, &operator);
```

Only the pool's creator may delegate, and the grant is **per pool**. An operator
assigned on one pool has no authority over any other, including other pools by
the same creator. Verified by
`oracle_spec::delegation_grants_authority_for_one_pool_only`.

Use a delegate when resolution needs an account that is operationally separate
from the creator — a resolution bot, or a team key distinct from the one that
launched the market.

## Preconditions for settlement

A call to `settle_pool` is rejected unless **all** of the following hold.

### 1. The caller holds one of the three roles

Otherwise `Unauthorized`.

### 2. The pool has expired

```
env.ledger().timestamp() >= pool.expiry
```

Otherwise `PoolNotExpired`. A market cannot be resolved while it is still open
for the event it is predicting.

Note `expiry` (the resolution deadline) is distinct from `deposit_deadline` (the
betting cutoff). `deposit_deadline <= expiry` always; when a creator does not
set one, it defaults to `expiry`.

### 3. The pool is still open

A pool that is settled, cancelled, frozen, or disputed cannot be settled.
Otherwise `PoolAlreadySettled`.

### 4. The participant quorum is met

```
pool.participant_count >= get_min_settlement_participants()
```

Otherwise `InsufficientParticipants`. This is what stops a thin market being
resolved unfairly: a pool with one participant has no meaningful consensus to
settle against.

Configure it with:

```rust
client.set_min_settlement_participants(&admin, &3);
```

Admin only. Set it to the smallest number of independent participants you would
accept as a real market. Setting it to `0` disables the check.

### 5. The outcome is in range

```
winning_outcome < number_of_declared_outcomes
```

Otherwise `InvalidOutcome`. A binary pool declares outcomes `0` and `1`; a
multi-outcome pool declares as many as it was created with.

An out-of-range winner would make every payout path unreachable, stranding the
pool's funds — which is why this is checked exhaustively over a bounded index
range in `oracle_spec::the_winning_outcome_must_be_in_range`.

## Finality

Once a pool is settled, **the outcome is fixed**. No role — not the admin, not
the creator, not a delegate — can re-settle it or change the recorded winner. A
second `settle_pool` is rejected and leaves both the outcome and its attribution
untouched.

If a resolution is wrong, the remedy is the dispute path
(`dispute_pool` / `freeze_pool`), not a re-settlement. Disputes have their own
window, configurable via `set_dispute_window`.

## Operational guidance

- **Prefer a delegated operator to sharing the creator key.** Delegation is
  per-pool and revocable in effect by settling; a shared key is neither.
- **Set the participant minimum deliberately.** The default admits thin markets.
  Choose the smallest count you would defend publicly as a real market.
- **Watch settlement attribution.** An unexpected `SettlementSource::Admin` on a
  pool that should have been settled by its creator is worth investigating.
- **Settle promptly after expiry.** Funds stay custodied until settlement, and
  bettors cannot claim before it.
- **Do not rely on re-settlement as a correction path.** It does not exist. If a
  resolution may need review, keep the dispute window open long enough to use.

## Failure reference

| Error | Cause |
|-------|-------|
| `Unauthorized` | Caller is not admin, creator, or the assigned delegate |
| `PoolNotExpired` | Called before `pool.expiry` |
| `PoolAlreadySettled` | Pool is not in the `Open` state |
| `InsufficientParticipants` | Below `get_min_settlement_participants()` |
| `InvalidOutcome` | `winning_outcome` is outside the declared outcome set |
| `PoolNotFound` | No pool with that id |
| `ContractPaused` | The contract is globally paused |

## Verified properties

`verification/oracle_spec.rs` asserts each of the following. See
[`FORMAL_VERIFICATION.md`](./FORMAL_VERIFICATION.md) for the bounds.

| Property | Statement |
|----------|-----------|
| Authority | Only admin, creator, or delegate can settle |
| Attribution | Every settlement records which role acted |
| Finality | A settled outcome never changes |
| Range | The winner is always within the declared outcome set |
| Timeliness | No pool resolves before its expiry |
| Quorum | A pool below the participant minimum cannot settle |
