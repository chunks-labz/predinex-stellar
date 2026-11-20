#![no_std]

// Tests for this crate live in the inline `#[cfg(test)] mod test` at the bottom
// of `contract.rs`. That is the single authoritative location (#1310).
//
// This crate previously carried two more copies that were never part of the
// module graph: a top-level `src/test.rs` and a `src/test/` directory. Rust
// only builds modules that are declared, so neither was ever compiled or run —
// they drifted out of agreement with the implementation, and
// `test_extend_duration_same_expiry` in the old `test.rs` asserted that a
// same-expiry extension is allowed, which `extend_duration` has always
// rejected. Both were deleted; all of their cases remain covered by the tests
// in `contract.rs`.
//
// If you add a Rust file under `src/`, declare it as a module, otherwise it will
// never run. CI enforces this via `scripts/verify-module-declarations.py`, and
// `scripts/verify-declared-tests.py` fails when a `#[test]` in this crate is
// declared in source but missing from what `cargo test` lists (#1305) — the
// check that would have caught the two dead copies above.

mod contract;

pub use contract::{DataKey, PoolContract, PoolContractClient, PoolData, PoolError, PoolState};
