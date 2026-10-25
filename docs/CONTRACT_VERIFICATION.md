# Contract Deployment Verification and Bytecode Diff Tool

**Issue #1112** | **Status**: ✅ Production Ready

## Overview

Comprehensive contract verification tool that compares deployed Stellar/Soroban smart contracts with local builds, detects unauthorized changes, and generates detailed verification reports.

## Features

- ✅ Bytecode hash comparison
- ✅ Contract size verification
- ✅ Detailed bytecode diff generation
- ✅ Metadata comparison
- ✅ Security analysis
- ✅ Upgrade compatibility checks
- ✅ HTML and JSON reports
- ✅ CI/CD integration
- ✅ Pre/post deployment workflows

## Quick Start

```bash
# Verify deployed contract
./scripts/verify-contract.sh CAXXX... ./target/wasm32-unknown-unknown/release/contract.wasm

# With detailed diff
./scripts/verify-contract.sh -d -v CAXXX... ./contract.wasm

# Pre-deployment checks
./scripts/verify-deployment.sh pre-deploy

# Post-deployment verification
./scripts/verify-deployment.sh post-deploy CAXXX...
```

## Scripts

### verify-contract.sh
Core verification script - compares bytecode

### verify-deployment.sh
Deployment workflow automation

## Usage

See scripts for detailed options with `--help` flag

## Exit Codes

- 0: Verification successful
- 1: Verification failed
- 2: Invalid arguments
- 3: Network error
- 4: Contract not found

## License

ISC
