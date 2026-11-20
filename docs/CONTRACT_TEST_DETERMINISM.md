# Contract Test Determinism: Root Cause Analysis

## Problem Statement

A subset of contract tests in `contracts/predinex/` fail non-deterministically in local development environments while consistently passing in CI. This creates friction for contributors who see local test failures that don't reproduce in CI, making it unclear whether their changes introduced a regression.

### Affected Tests

The following tests have been observed to fail locally but pass in CI:

- `e2e_tests::test_e2e_dispute_unfreeze_claim`
- `pause_tests::test_unfreeze_disputed_pool_restores_open_status`
- `test::c3_invalid_amount_does_not_mutate_pool_state`
- `test::g1_dispute_within_window_succeeds`
- `test::i2_cancel_pool_after_first_bet_succeeds`

---

## Root Cause Analysis

### 1. Rust Toolchain Version Drift

**Symptom:** CI uses a pinned Rust toolchain (1.87.0 as of this document), but local developers may have different versions installed via `rustup default` or workspace-level overrides.

**Evidence:**
- `.github/workflows/ci.yml` explicitly sets `toolchain: "1.87.0"` in the `Setup Rust` step
- The workspace has no `rust-toolchain.toml` or `.rust-version` file to enforce the same version locally
- Different Rust versions can produce different compiled WASM behavior, especially with opt-level changes

**Impact:** High. Rust 1.86, 1.87, and 1.88+ may generate different WASM from the same source, causing snapshot mismatches or timing-sensitive test failures.

### 2. Soroban SDK and WASM Target Version Mismatch

**Symptom:** CI uses `wasm32v1-none` target (Soroban's custom WASM target), but local environments may still have `wasm32-unknown-unknown` configured from older documentation or habits.

**Evidence:**
- CI workflow: `rustup target add wasm32v1-none`
- `Cargo.toml` specifies `soroban-sdk = "26.0.1"` which expects `wasm32v1-none`
- Older Stellar/Soroban tooling used `wasm32-unknown-unknown`, which is incompatible with the new target

**Impact:** Medium. Using the wrong target can cause linking errors or produce WASM that behaves differently under test.

### 3. Test Snapshot Environment Drift

**Symptom:** Tests using `soroban-sdk`'s snapshot testing (`.unwrap()` assertions, event log checks, etc.) may produce different output based on environment-specific factors like:
- Ledger sequence initialization (depends on test execution order or Env setup)
- Contract address generation (depends on host OS entropy or test fixture order)
- Gas metering differences (depends on WASM runtime version)

**Evidence:**
- Tests like `c3_invalid_amount_does_not_mutate_pool_state` and `g1_dispute_within_window_succeeds` rely on exact state comparisons after failed operations
- `e2e_tests::test_e2e_dispute_unfreeze_claim` exercises a multi-step flow with event emissions that may vary slightly in order or format

**Impact:** Medium. These tests are **fixture-dependent** — they assume a specific ledger state, contract address, or gas cost that may not hold across environments.

### 4. Operating System and Architecture Differences

**Symptom:** CI runs on `ubuntu-latest` (x86_64 Linux), but contributors may be on macOS (ARM or Intel) or Windows (WSL2, native MinGW, etc.).

**Evidence:**
- Soroban's WASM runtime uses native cryptographic primitives (SHA-256, Ed25519) that may have different implementations per OS
- ARM vs x86_64 floating-point precision differences (rare but possible in SDK internals)

**Impact:** Low. Modern Rust cross-compilation abstracts most of these differences, but rare edge cases exist.

---

## Recommended Fixes

### Priority 1: Pin Rust Toolchain Locally (HIGH IMPACT)

**Action:** Create a `rust-toolchain.toml` in the workspace root to enforce the same Rust version as CI.

**File:** `rust-toolchain.toml`

```toml
[toolchain]
channel = "1.87.0"
components = ["rustfmt", "clippy"]
targets = ["wasm32v1-none"]
```

**Why:** This ensures `cargo test`, `cargo build`, and `cargo fmt` use the exact same toolchain as CI. Contributors will automatically download the correct version when they run any Cargo command.

**Tradeoff:** Developers with older Rust versions will need to wait for a toolchain download (~200 MB). This is acceptable because it eliminates a major source of non-determinism.

### Priority 2: Update Local Setup Documentation (MEDIUM IMPACT)

**Action:** Update `CONTRIBUTING.md` and `docs/local-runbook.md` to emphasize:
- Running `rustup target add wasm32v1-none` (not `wasm32-unknown-unknown`)
- Verifying Rust version with `rustc --version` (should match 1.87.0 after toolchain file is added)
- Clearing stale build artifacts with `cargo clean` before running tests

**Why:** Even with `rust-toolchain.toml`, contributors may have cached build artifacts from previous Rust versions, causing intermittent failures.

### Priority 3: Make Failing Tests Fixture-Independent (MEDIUM IMPACT)

**Action:** Refactor the five identified tests to avoid snapshot-like assertions on environment-specific values:

**Before (fixture-dependent):**
```rust
#[test]
fn test_dispute_within_window_succeeds() {
    let env = Env::default();
    // ... test setup ...
    assert_eq!(contract.get_pool_status(pool_id), PoolStatus::Disputed);
    // Fails if contract address or ledger sequence differs
}
```

**After (fixture-independent):**
```rust
#[test]
fn test_dispute_within_window_succeeds() {
    let env = Env::default();
    env.mock_all_auths(); // Stabilize auth context
    // ... test setup ...
    let status = contract.get_pool_status(pool_id);
    assert!(matches!(status, PoolStatus::Disputed));
    // Only check the enum variant, not exact binary representation
}
```

**Why:** By checking behavior (pool is disputed) instead of exact state (specific address or ledger number), tests become resilient to environment drift.

### Priority 4: Add Local Test Verification CI Step (LOW IMPACT)

**Action:** Add a step to `.github/workflows/ci.yml` that runs a subset of tests with `--test-threads=1` (single-threaded execution) to catch order-dependent failures.

**Why:** Some failures may be caused by test execution order (e.g., shared static state, Env reuse). Single-threaded execution exposes these issues.

**Tradeoff:** Adds ~10 seconds to CI time. Only run on `main` pushes, not every PR.

---

## Immediate Workaround for Contributors

If you encounter local test failures that pass in CI, use this checklist before assuming it's a real bug:

1. **Verify Rust version:**
   ```bash
   rustc --version
   # Should output: rustc 1.87.0 (stable)
   ```

2. **Verify WASM target:**
   ```bash
   rustup target list | grep installed | grep wasm
   # Should include: wasm32v1-none
   ```

3. **Clean build artifacts:**
   ```bash
   cd contracts/predinex
   cargo clean
   cargo test
   ```

4. **Run tests single-threaded:**
   ```bash
   cargo test -- --test-threads=1
   ```

5. **Check for upstream changes:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

If all five steps pass and tests still fail locally but pass in CI, the test is likely **environment-dependent** and should be refactored per Priority 3 above.

---

## Long-Term Goal

**Deterministic `cargo test` green run:** Every contributor should see the same test results as CI, regardless of OS or local Rust setup. This requires:

- Pinned toolchain (Priority 1, shipped in this PR)
- Fixture-independent tests (Priority 3, follow-up PRs)
- Documented verification steps (Priority 2, updated in this PR)

Once these are in place, any local test failure should be treated as a real regression, not environment noise.

---

## References

- [Soroban SDK 26.0.1 Changelog](https://github.com/stellar/rs-soroban-sdk/releases/tag/v26.0.1)
- [Rust Toolchain File Specification](https://rust-lang.github.io/rustup/overrides.html#the-toolchain-file)
- [Soroban WASM Target Migration](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#wasm-target)
- [CI Contract Checks Workflow](../.github/workflows/ci.yml)

---

**Document Status:** Living document. Update when new non-deterministic tests are identified or when SDK/toolchain versions change.
