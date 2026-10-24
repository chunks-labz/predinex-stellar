#!/bin/bash
#
# Contract Verification Examples
# Issue #1112

# Example 1: Basic verification
./scripts/verify-contract.sh \
    CAXXX... \
    ./target/wasm32-unknown-unknown/release/predinex.wasm

# Example 2: With detailed diff
./scripts/verify-contract.sh -d -v \
    CAXXX... \
    ./contract.wasm

# Example 3: JSON output for CI
./scripts/verify-contract.sh -j \
    CAXXX... \
    ./contract.wasm > verification.json

# Example 4: Check upgrade safety
./scripts/verify-contract.sh --check-upgrade --compare-metadata \
    CAXXX... \
    ./new_contract.wasm

# Example 5: Pre-deployment checks
./scripts/verify-deployment.sh pre-deploy

# Example 6: Post-deployment verification
./scripts/verify-deployment.sh post-deploy CAXXX...

# Example 7: Verify all contracts
./scripts/verify-deployment.sh verify-all

# Example 8: CI/CD workflow
CONTRACT_ID=CAXXX... ./scripts/verify-deployment.sh ci-verify
