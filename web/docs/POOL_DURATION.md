# Pool Duration Policy

> Reference: contract function `PredinexContract::create_pool` and the public
> constant `MIN_POOL_DURATION_SECS` in `contracts/predinex/src/lib.rs`.
> Issue #151.

This document is the canonical reference for the contract-enforced bounds on
prediction-pool durations. Frontends, indexers, and deployment tooling should
treat the values here as the source of truth.

---

## Minimum duration

The contract rejects any `create_pool` call whose `duration` is below
`MIN_POOL_DURATION_SECS = 300` seconds (5 minutes) with the stable panic
string:

```
Duration below minimum
```

The check runs before any state writes or fee transfers, so a rejected call
leaves the contract untouched (no creation fee charged, no `pool_counter`
advance, no event emitted).

### Why 5 minutes?

- **Long enough** that participants who discover a newly-created market have
  a realistic window to enter it.
- **Short enough** to allow legitimate short-form markets such as sports
  props, breaking-news events, and live game outcomes.
- **Above zero** so a creator cannot grief by publishing a market that is
  effectively settled before any other participant can react.

The choice is a balance between fairness (the issue's stated goal) and
flexibility (not over-constraining legitimate market types).

## Querying the value at runtime

Frontends should not hard-code `300` locally; they should read the policy
from the deployed contract via the public view function:

```ts
const minDuration = await contract.get_min_pool_duration(); // u64
```

This guarantees the frontend's "minimum" stays in lockstep with whatever
contract revision is currently deployed.

The frontend's local fallback constant in `web/app/lib/validators.ts`
(`MIN_POOL_DURATION_SECS = 300`) must mirror the contract value and is used
for *form-level* validation that runs before the contract call is built.

## Frontend validation guidance

`validateDuration` in `web/app/lib/validators.ts` enforces the same lower
bound on the create-pool form so users get a friendly inline error rather
than waiting for the on-chain panic. The validator returns:

```
"Duration must be at least 300 seconds (5 minutes)"
```

for any value below the minimum. The upper bound (`MAX_POOL_DURATION_SECS`)
is a soft frontend cap; the contract does not impose an upper limit.

## Deployment / migration consumers

| Concern                        | Action                                                                                                     |
|--------------------------------|------------------------------------------------------------------------------------------------------------|
| Existing pools created before #151 | No effect. The guard runs only at creation time; already-stored pools retain their original durations. |
| Future minimum tweaks           | Update both `MIN_POOL_DURATION_SECS` in `contracts/predinex/src/lib.rs` and the same-named export in `web/app/lib/validators.ts`. Bump the contract version and document the change in `web/docs/CONTRACT_VERSIONING.md`. |
| Indexers                        | A `create_pool` event whose pool record has `expiry - created_at < MIN_POOL_DURATION_SECS` cannot occur on a contract revision running this guard, but historical events from older revisions may. |

## Test cases

Covered in `contracts/predinex/src/test.rs`:

- `issue151_create_pool_below_minimum_duration_is_rejected` — `duration = MIN - 1` panics with `"Duration below minimum"`.
- `issue151_create_pool_with_zero_duration_is_rejected` — `duration = 0` is rejected by the same guard.
- `issue151_create_pool_at_minimum_duration_is_accepted` — `duration = MIN` succeeds and stores `expiry == created_at + MIN`.
- `issue151_get_min_pool_duration_returns_constant` — view function exposes the constant.
- `issue151_rejection_does_not_advance_state` — rejection leaves the pool counter and creator's token balance unchanged (no creation fee charged).
