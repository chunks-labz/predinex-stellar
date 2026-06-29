# Contract Versioning & Migration Strategy

This document defines how the Predinex smart contract evolves over time, how breaking changes are communicated, and the steps required to deploy and migrate to a new contract version.

> **Reference from contributor docs:** Developers making contract changes must consult this document before opening a PR. Frontend changes that depend on new or modified contract interfaces must be coordinated through the process described here.

---

## Versioning model

Predinex uses **semantic versioning** for the contract interface, tracked via the `version` field in the `Cargo.toml` of `contracts/predinex/`:

```toml
[package]
name = "predinex"
version = "0.1.0"
```

| Segment   | Meaning                                                                               |
|-----------|---------------------------------------------------------------------------------------|
| **Major** | Breaking change — existing callers must update their integration                     |
| **Minor** | New non-breaking capability (new read-only function, new optional field)             |
| **Patch** | Bug fix that does not change function signatures or storage layout                   |

### What counts as a breaking change

- Removing or renaming a public function
- Changing the argument list of a public function (type or order)
- Changing the structure of a `#[contracttype]` stored under a persistent key (e.g. `Pool`, `UserBet`)
- Changing the topics or data shape of an event — this requires bumping the
  per-event **schema version marker** documented in
  [CONTRACT_EVENTS.md § Event versioning](./CONTRACT_EVENTS.md#event-versioning-issue-175)
- Changing the storage key scheme (e.g. `DataKey` variants)

### What is NOT a breaking change

- Adding a new public function
- Adding a new `DataKey` variant for new storage (existing keys unaffected)
- Emitting a new event (existing consumers can ignore unknown event names)
- Internal refactoring with identical ABI

---

## Branch and review requirements

| Change type   | Required actions before merge                                             |
|---------------|---------------------------------------------------------------------------|
| Breaking (major) | Bump major version in `Cargo.toml`, add a migration note to this file, update `CONTRACT_EVENTS.md` if events changed, open a tracking issue tagged **breaking** |
| Non-breaking (minor) | Bump minor version, update relevant docs if new functions/events are added |
| Patch         | Bump patch version; no additional doc updates required                    |

All contract PRs must reference this document in the PR description and confirm the version bump is appropriate.

---

## Deployment process

### 1. Build and test

```bash
# From the repo root
cd contracts/predinex
cargo test
cargo build --release --target wasm32-unknown-unknown
```

The compiled WASM lives at `target/wasm32-unknown-unknown/release/predinex.wasm`.

### 2. Optimize (production builds only)

```bash
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/predinex.wasm
```

Output: `predinex.optimized.wasm`

### 3. Deploy to testnet

```bash
stellar contract deploy \
  --wasm predinex.optimized.wasm \
  --network testnet \
  --source <deployer-account>
```

Note the returned **contract ID** — this is the new `NEXT_PUBLIC_CONTRACT_ADDRESS`.

### 4. Initialize

```bash
stellar contract invoke \
  --id <new-contract-id> \
  --network testnet \
  --source <deployer-account> \
  -- initialize \
  --token <xlm-token-contract-id>
```

### 5. Update environment variables

Update `.env.local` (local) and the CI/CD secrets with the new contract ID:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=<new-contract-id>
NEXT_PUBLIC_NETWORK=testnet   # or mainnet
```

### 6. Verify

```bash
stellar contract invoke \
  --id <new-contract-id> \
  --network testnet \
  -- get-pool-count
```

---

## Migration notes by version

### v0.1.0 (initial deployment)

- First production deployment on Stellar testnet.
- No prior state to migrate.
- Functions: `initialize`, `create_pool`, `place_bet`, `settle_pool`, `claim_winnings`, `get_pool`.
- Events: `create_pool`, `place_bet`, `settle_pool`, `claim_winnings`.

### Hypothetical v1.0.0 (example breaking migration)

> **This section illustrates the migration process for a future breaking change.**

**Scenario:** Adding a `fee_bps: u32` field to `Pool` changes the storage layout. Existing `Pool` entries in persistent storage cannot be deserialized with the new struct.

**Required steps:**

1. Bump `version` in `Cargo.toml` from `0.x.y` to `1.0.0`.
2. Deploy the new contract under a **new contract ID** (Soroban contracts are immutable once deployed).
3. The old contract remains accessible (read-only migrations are safe).
4. Frontend: update `NEXT_PUBLIC_CONTRACT_ADDRESS` to the new ID; the old ID should be kept for historical event queries.
5. If any live pools exist at migration time, coordinate with pool creators to settle before the cut-over, or provide a migration admin function that re-creates pools from the old contract's state.
6. Update `CONTRACT_EVENTS.md` and `CONTRACT_VERSIONING.md`.
7. Tag the release in git: `git tag -a v1.0.0 -m "Breaking: Pool struct migration"`.

---

## Interface compatibility matrix

| Frontend version | Contract version | Compatible? |
|-----------------|-----------------|-------------|
| ≥ 0.1           | 0.1.x           | ✅ Yes       |
| 0.1             | 1.0.0 (future)  | ❌ No — update `NEXT_PUBLIC_CONTRACT_ADDRESS` and adapt API calls |

---

## Links

- [Contract source](../../contracts/predinex/src/lib.rs)
- [Event schemas](./CONTRACT_EVENTS.md)
- [Development guide](../DEVELOPMENT.md)
- [Release process](../../RELEASE.md)
