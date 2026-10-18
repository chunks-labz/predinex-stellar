# Contract Verification Scripts

Production-ready tools for Stellar/Soroban contract verification.

## Scripts

### verify-contract.sh
Bytecode verification and comparison tool

**Features:**
- SHA256 hash comparison
- Bytecode diff generation
- Security analysis
- Upgrade compatibility
- HTML/JSON reports

**Usage:**
```bash
./verify-contract.sh [OPTIONS] <contract_id> <local_wasm>
```

### verify-deployment.sh
Deployment workflow automation

**Features:**
- Pre-deployment checks
- Post-deployment verification
- Multi-contract verification
- CI/CD integration

**Usage:**
```bash
./verify-deployment.sh [COMMAND]
```

### seed-demo-markets.sh
Seed demo markets (and wagers) into a locally deployed Predinex contract.

**Features:**
- Creates a fixed set of `[demo]`-prefixed markets and one demo wager per market
- Idempotent: re-running reuses existing markets and skips existing wagers (no duplicates)
- Refuses to run against mainnet; local network by default, testnet requires an explicit flag
- Prints every created market id and transaction hash

**Usage:**
```bash
./seed-demo-markets.sh --contract-id C... --source-identity alice
./seed-demo-markets.sh --help    # all options
```

See [Local End-to-End Runbook → Seed demo markets and wagers](../docs/local-runbook.md#5b-seed-demo-markets-and-wagers-optional) for prerequisites and examples.

## Requirements

- stellar-cli
- sha256sum/shasum
- xxd
- jq

## Documentation

See `/docs/CONTRACT_VERIFICATION.md`

## License

ISC
