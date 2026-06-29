# Contract Upgrade Procedure

This document describes how Predinex upgrades the Soroban contract safely.
It is the operational companion to the contract versioning notes and focuses on
state compatibility, migration planning, and release coordination.

## Current state version

The contract currently stores its state compatibility marker in
[`contracts/predinex/src/lib.rs`](../contracts/predinex/src/lib.rs) as:

```rust
pub const CONTRACT_STATE_VERSION: &str = "v1";
```

The on-chain value lives under `DataKey::ContractVersion` and is read on
startup to decide whether the deployed state is compatible with the current
code.

---

## 1. Version bump policy

Use the contract state version to signal whether the persistent storage layout
is compatible with the current binary.

### Bump `CONTRACT_STATE_VERSION` when

- A persistent struct or enum payload changes in a backward-incompatible way.
- A storage key is repurposed for a different logical record.
- Read paths need different deserialization logic for existing on-chain data.
- A migration requires code to distinguish old and new state during rollout.

### Do not bump `CONTRACT_STATE_VERSION` when

- You add a new read-only method.
- You add a new storage key that does not change existing reads.
- You change internal helper logic without changing stored data shape.
- You make a purely frontend or documentation update.

### Bump rules

- Keep the version string small and explicit, for example `v1`, `v2`, `v3`.
- Bump by one major step only when a breaking storage change is introduced.
- Update the hard-coded constant in `lib.rs` and any compatibility checks that
  compare against it.
- Record the change in the PR description and in the migration notes below.

---

## 2. Storage namespace conventions

Predinex keeps persistent data under the `DataKey` enum. Treat each variant as
its own namespace.

### Rules

- Add a new `DataKey` variant for a new logical record type.
- Prefer tuple variants for keyed collections, such as `Pool(u32)` and
  `UserBet(u32, Address)`.
- Reserve `DataKey::ContractVersion` for the state compatibility marker only.
- Do not reuse an existing key for a new struct layout unless the code can read
  both formats during migration.
- If a record needs a second-generation layout, create a new variant such as
  `PoolV2(...)` or store a versioned wrapper value under a new key.

### Good migration pattern

1. Introduce a new namespace alongside the old one.
2. Read old data, transform it, and write the new shape.
3. Keep the old reader in place until the migration is complete.
4. Remove old compatibility code only after every active entry has moved.

### Avoid

- Overwriting an old key with a new payload shape and hoping callers will not
  deserialize it.
- Mixing multiple logical record formats under one `DataKey` variant.
- Deleting the old schema before the migration path has been exercised on
  testnet.

---

## 3. Data migration patterns

Choose the lightest migration that preserves user funds and historical state.

### Pattern A: No stored state change

Use this when the binary changes but the on-chain layout does not.

- Leave `CONTRACT_STATE_VERSION` unchanged.
- Deploy the new WASM.
- Run smoke tests against the new build.

### Pattern B: Additive migration

Use this when you are introducing a new field with a safe default or a new
namespace that does not invalidate existing data.

- Bump the version only if the reader must branch on old vs new state.
- Provide a default for legacy records.
- Migrate lazily on read if the record can be upgraded in place without
  side effects.

### Pattern C: Breaking storage migration

Use this when the old and new layouts cannot coexist safely.

1. Bump `CONTRACT_STATE_VERSION` in `lib.rs`.
2. Add explicit migration helpers or one-time admin actions.
3. Freeze or pause risky user-facing flows during the cutover.
4. Copy or transform old records into the new namespace.
5. Verify that reads, writes, and settlement paths all succeed against the new
   state.
6. Remove the old compatibility branch only after the rollout is complete.

### Recommended implementation details

- Keep migration code deterministic and idempotent where possible.
- Emit events for migration actions if they help operators or indexers track
  progress.
- Write tests for both pre-migration and post-migration reads.
- If a migration touches financial balances, test the full happy path and a
  failing transaction path to confirm atomic rollback.

---

## 4. Testnet staging workflow

Every planned upgrade should be rehearsed on testnet before production.

### Step-by-step

1. Create a release branch and note the intended state version bump.
2. Update `CONTRACT_STATE_VERSION` in `lib.rs` if the storage layout changes.
3. Add or update migration helpers and tests.
4. Build the contract and deploy the candidate WASM to testnet.
5. Initialize or upgrade the testnet instance with representative data.
6. Run smoke checks for:
   - contract initialization
   - reads against legacy and migrated records
   - writes to new and existing namespaces
   - settlement and payout paths if funds are involved
7. Compare the resulting state against the expected migration outcome.
8. Keep the testnet contract ID and deployment notes in the PR for review.

### Staging expectations

- Use testnet to validate any breaking change before merging.
- Do not skip migration tests just because the code path looks simple.
- If the upgrade changes the frontend contract address, confirm the UI points to
  the staged contract before announcing the release.

---

## 5. Planned vs emergency upgrades

Treat planned and emergency upgrades differently so operators know how much
coordination to expect.

### Planned upgrade

Use this for feature work, routine fixes, and any storage change that can be
rehearsed ahead of time.

- Announce the change before deployment.
- Bump the state version if needed.
- Run the testnet staging workflow.
- Schedule a maintenance window if the rollout is user-visible.
- Publish the final contract ID and any frontend configuration change.

### Emergency upgrade

Use this when the live contract has a critical bug, security issue, or funds
risk that needs immediate action.

- Prioritize containment over feature completeness.
- Pause or freeze risky operations if the contract exposes such a control.
- Deploy the smallest safe fix possible.
- Prefer preserving existing state over restructuring it during the incident.
- If a clean in-place repair is not safe, deploy a replacement contract and
  cut traffic over as quickly as possible.
- Document the incident and follow-up migration work after the rollout.

### Decision rule

- If the change can wait for testnet verification and normal review, it is
  planned.
- If users or funds are at risk and delay increases exposure, treat it as an
  emergency.

---

## 6. Operator checklist

Before opening a PR for a contract upgrade, confirm:

- The current `CONTRACT_STATE_VERSION` in `lib.rs` is correct.
- The migration strategy is documented and covered by tests.
- Testnet staging has been completed.
- `DataKey::ContractVersion` reads and writes still match the intended compatibility
  story.
- Any frontend or environment-variable changes are documented.
- The rollout plan clearly states whether the upgrade is planned or emergency.

---

## Related documentation

- [Contract versioning and migration strategy](../web/docs/CONTRACT_VERSIONING.md)
- [Contract state source](../contracts/predinex/src/lib.rs)
- [Contributing guide](../CONTRIBUTING.md)
