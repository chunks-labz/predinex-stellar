# Storage Rent Footprint and Lifecycle Policy

<!-- #190 / #189 — documents every persistent key the contract writes, its
lifetime, the in-contract TTL bump policy, and the retention assumptions
frontend and indexer teams can rely on. -->

## Background

Soroban charges **rent** for persistent storage entries. Each entry must be
periodically extended (bumped) or it is evicted from the ledger. Eviction does
not destroy the data permanently — it moves to the archival layer — but it
blocks contract reads until the entry is restored via `restoreFootprint`.

All persistent entries in Predinex use `env.storage().persistent()`. The
contract does **not** use `instance()` or `temporary()` storage.

## In-contract TTL bump policy (#189)

The contract manages TTL extension automatically. Two constants govern the policy
(defined in `lib.rs`):

| Constant | Ledgers | Approximate wall time |
|---|---|---|
| `POOL_BUMP_THRESHOLD` | 432,000 | 25 days |
| `POOL_BUMP_TARGET` | 518,400 | 30 days |

**Rule**: whenever a `Pool` or `UserBet` entry is written or read by the
contract, `extend_ttl(key, POOL_BUMP_THRESHOLD, POOL_BUMP_TARGET)` is called. If
the entry's current TTL is already above `POOL_BUMP_THRESHOLD` the call is a
no-op; otherwise it is extended to `POOL_BUMP_TARGET` ledgers from the current
ledger.

**Write-path bumps** (extend on every mutation):
`create_pool`, `place_bet`, `settle_pool`, `void_pool`, `freeze_pool`,
`dispute_pool`, `unfreeze_pool`

**Read-path bumps** (extend when the caller reads an entry):
`get_pool`, `get_user_bet`, `get_user_pools`

**Consequence**: any active pool or user position that is touched at least once
every 25 days — either by a contract operation or a read from a dashboard — will
never expire. Markets that are completely inactive for longer than 30 days may
require a `restoreFootprint` call before the next interaction.

---

## Key catalogue

| `DataKey` variant | Written by | Read by | Deleted by | Notes |
|---|---|---|---|---|
| `Token` | `initialize` | all token transfers | — | Set once; never mutated |
| `TreasuryRecipient` | `initialize`, `rotate_treasury_recipient` | `withdraw_treasury`, `set_creation_fee` | — | Single address; updated atomically |
| `Treasury` | `initialize`, `claim_winnings` | `get_treasury_balance`, `withdraw_treasury` | — | Accumulates 2 % fees |
| `PoolCounter` | `initialize` (implicit via `create_pool`), `create_pool` | `get_pool_counter` | — | Monotone counter; never decremented |
| `Pool(pool_id)` | `create_pool`, `place_bet`, `settle_pool`, `freeze_pool`, `unfreeze_pool`, `dispute_pool` | `get_pool`, `claim_winnings`, all read fns | — | Central market record; updated in-place |
| `UserBet(pool_id, user)` | `place_bet` | `claim_winnings`, `get_user_bet`, `get_user_pools` | `claim_winnings`, `claim_refund` | Created on first bet; removed after a successful claim or refund |
| `DelegatedSettler(pool_id)` | `assign_settler` | `settle_pool` | — | Optional per-pool; absent means no delegation |
| `FreezeAdmin` | `set_freeze_admin` | `freeze_pool` | — | Single optional address |
| `CreationFee` | `set_creation_fee` | `create_pool`, `get_creation_fee` | — | Defaults to 0 when absent |

---

## Lifecycle walkthrough

### 1. Initialization

`initialize` writes `Token`, `TreasuryRecipient`, and `Treasury` (set to 0).
These three entries live for the lifetime of the contract deployment and should
be bumped by the operator as part of routine maintenance.

### 2. Pool creation

`create_pool` writes `Pool(pool_id)` and increments `PoolCounter`. If a
creation fee is set, no new storage key is written — the fee is a token
transfer only.

**Bump obligation**: `Pool` entries must be kept alive at least until the pool
is settled and all winnings are claimed. For long-duration markets (days to
weeks) the operator should bump the entry before it expires. A safe default is
`max_ttl` at creation time.

### 3. Betting

`place_bet` writes or updates `UserBet(pool_id, user)` and mutates
`Pool(pool_id)` (updates `total_a`, `total_b`, `participant_count`).

**Bump obligation**: `UserBet` entries must survive until the user claims
winnings. Bump alongside the corresponding `Pool` entry.

### 4. Settlement

`settle_pool` mutates `Pool(pool_id)` in-place (sets `settled`, `status`,
`winning_outcome`). No new keys are written.

The enriched settlement event emits `(caller, winning_outcome,
winning_side_total, total_pool_volume, fee_amount)` — indexers and the
frontend can reconstruct payout context from the event alone.

### 5. Claim

`claim_winnings` reads `Pool(pool_id)` and `UserBet(pool_id, user)`, then — in
order — transfers tokens to the winner, increments `Treasury`, removes the
`UserBet` entry, and emits events. Removing the bet record after the transfer
prevents double-claim without needing a separate tombstone key. Because Soroban
transactions are fully atomic, a failed transfer rolls back the entire
transaction and leaves treasury state and token balances in sync.

`claim_refund` follows the same pattern for voided pools: transfer first, then
remove the `UserBet` entry.

### 6. Treasury operations

`withdraw_treasury` reads and zeroes `Treasury`. `rotate_treasury_recipient`
updates `TreasuryRecipient`.

---

## Retention assumptions for consumers

| Concern | Safe assumption |
|---|---|
| Is a pool's outcome queryable after settlement? | Yes — `Pool` is never deleted |
| Can an indexer reconstruct payouts from events? | Yes — the `settle_pool` event carries all necessary totals |
| Is a user's bet history available on-chain for open positions? | Yes — `UserBet` exists until the user claims or is refunded |
| Can a claimed `UserBet` be distinguished from an unclaimed one? | Yes — the bet record is removed after a successful claim; absence in a settled pool means `AlreadyClaimed` |
| Can I find all pools a user has entered? | Yes — use `get_user_pools(user, start_id, count)` to scan a bounded range; only open (unclaimed) positions are returned |
| Do evicted entries block reads? | Yes — evicted `Pool` or `UserBet` entries must be restored before they can be read |

---

## Operational guidance

- The contract automatically bumps `Pool` and `UserBet` entries on every write
  and read. No external tooling is needed for markets shorter than 25 days.
- For markets running longer than 25 days with no participant activity, send a
  read transaction (e.g. `get_pool`) every ~20 days to trigger the in-contract
  bump and keep the entry alive.
- Bump `Token`, `TreasuryRecipient`, `Treasury`, and `PoolCounter` periodically
  (e.g. weekly) as part of a maintenance transaction; these global entries are
  not bumped automatically.
- Monitor for eviction using the Stellar Horizon API or a Soroban event
  indexer; restore via `restoreFootprint` before any contract call that reads
  an evicted key.
