# Formal Verification Harness

`contracts/predinex/src/verification/` holds property suites that differ from
the unit tests in `test.rs` in what they assert. The one suite that does not
belong to that contract — the lending rate guard, which lives in its own crate —
is described at the end of this document.

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
| `interest_rate.rs` (in `stellar-lend`) | The interest-rate guard's boundary conditions | #1119 |

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

### `interest_rate.rs` — the rate guard's bounds (#1119)

`stellar-lend/contracts/hello-world/src/interest_rate.rs` holds the lending rate
guard, and it is the whole of that file's job. `InterestRateGuard::validate_update`
is five comparisons and an equality: does the asset match, is the rate under its
cap, is utilization under 100%, is the observation fresh enough, and did either
the rate or utilization move further than policy allows. There is no arithmetic to
get wrong here — only comparison operators.

That is precisely why the guard is worth verifying. The security property *is*
the choice of `>` against `>=`, and an off-by-one in either direction fails
quietly: `>=` where `>` belongs freezes the market at the bound, and `>` where
`>=` belongs lets a rate or a utilization figure be nudged one step past a limit
on every single update.

The suite lives with the model rather than in `predinex` because the model does:
nothing in `contracts/predinex` calls `validate_update`, so a suite behind the
`predinex` harness could not reach it. It uses the same fixed-seed LCG as the
`predinex` harness, so a failure is reproducible from its seed alone.

| Property | Meaning |
|----------|---------|
| Verdict agreement | The guard accepts an update exactly when the policy predicates hold, checked against a separate oracle transcribed from the policy prose |
| Inclusive bounds | A value equal to a bound is accepted; the next step past it is rejected — for the rate cap, the staleness window, the rate allowance, and the utilization allowance |
| Utilization cap | `10_000` bps is accepted and `10_001` rejected even under a policy that places no other limit on the rate |
| Direction independence | The same pair of values is judged identically whichever way round `previous` and `next` sit |
| Asset binding | A mismatched asset is rejected even when every other field is benign, and is reported as an asset mismatch |
| Precedence | When several conditions fail at once, the reported error is the first in the documented order: asset, rate, utilization, staleness, rate delta, utilization jump |
| Total subtraction | `abs_delta` is symmetric, zero on equal inputs, and does not overflow at `u32::MAX` |
| Chain safety | In a generated chain validated against the last accepted observation, no accepted step violates the policy |

Bounds: utilization is enumerated **exhaustively** over `0..=10_001`; the rate
and staleness domains are probed at `0`, `1`, `bound - 1`, `bound`, `bound + 1`,
and `u32::MAX`; five policies are exercised, including a zeroed one and one with
saturated bounds; chains are bounded at 12 observations over 4 fixed seeds.
A policy whose bound leaves an isolated boundary untestable — a saturated bound
has no representable value above it — skips that boundary explicitly instead of
asserting something weaker.

Two behaviours are pinned as *gaps* rather than asserted as properties, because
the guard does not provide them: a future-dated observation is never stale
(`saturating_sub` floors its age at zero), and the `previous` observation is
never range-checked, so an out-of-range baseline is accepted and the jump
thresholds are then measured from an impossible value. Fixing either is a policy
change — a `max_future_secs` bound, or a decision about whether a bad baseline
rejects the update or is discarded — not a verification result.

Not covered: the two-slope curve that *produces* `rate_bps`, configured by
`types::LendingPoolConfig`; where `timestamp` comes from; and the interior of the
rate domain between the probe points.

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

The lending suite is in a separate crate, which the root workspace does not
include, so it needs its own invocation:

```bash
cargo test --manifest-path stellar-lend/contracts/hello-world/Cargo.toml \
  interest_rate::verification
```

That crate is not run by CI, so the suite executes only when someone runs it.
Wiring it into the `CI` workflow is the natural follow-up; it is not done here
because the crate predates this workspace's formatting and lint baseline, and
bringing it under those gates is a separate decision from this issue.

## Reproducing a failure

Every suite that generates sequences draws from a **fixed seed list** and a
deterministic LCG — the same generator `fuzz.rs` and `validation_prop_tests.rs`
already use, and the same one the lending rate-guard suite uses. A failure is
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

A model that lives outside `contracts/predinex` cannot use `Harness` — there is
no `Env` to share — so its suite sits beside the model and follows the same
rules where they apply: a separate oracle rather than a restatement of the
implementation, bounds stated in the module doc comment, fixed seeds, and a row
in the table above. The lending rate guard (#1119) is the worked example.

## A note on writing invariants

The custody bug described above is the instructive one. The first draft of this
harness asserted `balance >= total_a + total_b` and failed against a correct
contract, because it had assumed claims decrement the pool totals. They do not,
for a good reason.

The lesson generalises: before asserting an invariant, confirm what the code
actually maintains and *why*. An invariant that encodes a guess produces
confident false alarms, which erode trust in the suite faster than having no
suite at all.
