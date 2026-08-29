# Formal Verification Harness

`contracts/predinex/src/verification/` holds property suites that differ from
the unit tests in `test.rs` in what they assert.

A unit test pins one call's result: *this input produces that output*. A
verification suite states a property that must hold in **every** reachable
state, drives the contract through a bounded space of states, and re-checks the
property after each transition.

## Why a harness and not a solver

The issue this work came from asked for a Certora-style setup. Soroban has no
comparable SMT backend: the host is a WASM interpreter with ledger state, and
the properties worth checking here are about that state — custody, authority,
finality — not about arithmetic in isolation.

What *is* tractable is **bounded exhaustive verification**: enumerate a small,
complete slice of the input space, execute it against the real host, and assert
the invariants after every transition. That is what this module does.

**Bounded means bounded.** A property that holds across the enumerated space is
not proved for all inputs. Every suite states its bounds explicitly so a reader
knows what was and was not covered. Where a property is genuinely exhaustive
over its domain — the outcome-range checks, for instance — the suite says so.

## Layout

| Module | Verifies | Issue |
|--------|----------|-------|
| `cross_contract.rs` | Invariants across the `predinex` ↔ token boundary | #1116 |
| `upgrade_safety.rs` | The schema-version state machine and migration paths | #1117 |
| `oracle_spec.rs` | The settlement authority that resolves markets | #1118 |

Shared machinery lives in `mod.rs`: `Harness` builds a funded fixture, and
`Harness::check_invariants` asserts every global invariant at once, so an
individual suite only has to decide *when* to check, not *what*.

## The invariant catalogue

`check_invariants` runs all three of the following.

### Custody

> The contract's token balance covers every liability it has recorded and not
> yet discharged.

This is the property that matters most. If it fails, one claim path can starve
another — insolvency, however the bookkeeping reads.

The subtlety: `total_a` / `total_b` are **not** decremented as winners claim.
They record the stake as it stood at settlement, because the pro-rata payout
calculation needs that figure for every later claimant. The live liability is
therefore:

```
outstanding = (total_a + total_b) - PoolPayoutState::paid_out
```

A naive `balance >= total_a + total_b` check fails on any pool that has paid a
winner, and it fails for a *correct* contract. Verifying the wrong invariant is
worse than verifying none, because it produces confident false alarms.

### Pool accounting

> Per-outcome totals are non-negative, cumulative volume never decreases, and
> the betting window closes no later than the resolution deadline.

`cumulative_volume` is a lifetime figure that survives settlement and claims, so
it can never fall below what is currently staked.

### Settlement consistency

> A settled pool names a winning outcome and records who settled it; an
> unsettled pool does neither.

Attribution matters as much as the outcome: a disputed resolution has to be
traceable to a principal.

## The properties, by suite

### `cross_contract.rs` — the token boundary (#1116)

Every value-moving path in `predinex` invokes a **separate contract**, the
Stellar Asset Contract behind `token::Client`. That boundary is where custody
bugs live: two programs update two ledgers, and only the host guarantees they
commit together.

| Property | Meaning |
|----------|---------|
| Conservation | No operation creates or destroys value; the circulating supply is invariant |
| Custody | The contract holds at least what it owes |
| Atomicity | A rejected call leaves neither side changed |
| Authorisation | A transfer only debits an account that authorised the invocation |
| No replay | A settled claim cannot be paid twice |

Bounds: 24 operations per sequence, 4 actors, up to 3 pools, over 6 fixed seeds.

### `upgrade_safety.rs` — migration state (#1117)

`DataKey::ContractVersion` is the hinge of any migration. If it can be lost,
forged, or disagree with the state actually on chain, a migration either fails
to run or runs twice.

| Property | Meaning |
|----------|---------|
| Persistence | No ordinary operation clears or rewrites the version |
| Agreement | `get_config` always reports what is stored |
| Idempotence | `initialize` cannot be replayed to reset admin or version |
| State compatibility | Records written before a version read stay readable and unchanged |

Bounds: 16 operations per sequence over 4 fixed seeds.

**Out of scope:** this contract has no `update_current_contract_wasm` entry
point, so a real binary swap cannot be driven from a test. These suites verify
the state machine an upgrade would rely on, not the deployment mechanics.

### `oracle_spec.rs` — settlement authority (#1118)

See [`ORACLE_CONFIGURATION_GUIDE.md`](./ORACLE_CONFIGURATION_GUIDE.md) for the
role model itself. The suite verifies authority, attribution, finality, outcome
range, timeliness, and the participant quorum.

Outcome-range and unauthorised-caller checks are exhaustive over their domains;
the interleaving suite is bounded at 12 operations over 4 fixed seeds.

## Running

```bash
cd contracts/predinex

# The whole harness (a few seconds).
cargo test verification::

# One suite.
cargo test verification::cross_contract

# One property.
cargo test verification::oracle_spec::a_settled_outcome_is_final
```

The harness is fast because the bounds are small by design. It is meant to run
on every change, not nightly.

## Reproducing a failure

Every suite draws from a **fixed seed list** and a deterministic LCG — the same
generator `fuzz.rs` and `validation_prop_tests.rs` already use. A failure is
therefore reproducible from its seed alone, and assertion messages carry both
the seed and the step:

```
seed 1337 step 9: place_bet changed the circulating supply
```

Re-run that one test; the sequence is identical.

## Adding a suite

1. Add a module under `verification/` and declare it in `verification/mod.rs`.
2. Build state through `Harness`; do not hand-roll a fixture, so every suite
   shares one definition of a valid starting state.
3. Call `h.check_invariants(pool_count, "context")` after each transition. The
   context string is echoed on failure, so name the *step*, not the property.
4. State the bounds in the module doc comment: how many steps, how many actors,
   which seeds, and what is deliberately not covered.
5. Add the suite to the table above.

If a new global invariant belongs to every suite, add it as a `check_*` method
on `Harness` and call it from `check_invariants` rather than repeating it.

## A note on writing invariants

The custody bug described above is the instructive one. The first draft of this
harness asserted `balance >= total_a + total_b` and failed against a correct
contract, because it had assumed claims decrement the pool totals. They do not,
for a good reason.

The lesson generalises: before asserting an invariant, confirm what the code
actually maintains and *why*. An invariant that encodes a guess produces
confident false alarms, which erode trust in the suite faster than having no
suite at all.
