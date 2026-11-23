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

### check-deployment-health.py
Post-deployment HTTP readiness probe used by the deployment workflows

**Features:**
- Retries transient HTTP/connection failures with configurable attempts and delay
- Fails immediately on non-retryable client errors or invalid URLs
- Distinct exit codes for unhealthy deployments (`1`) and bad input (`2`)

**Usage:**
```bash
./check-deployment-health.py --url "$DEPLOYMENT_URL" --attempts 10
```

### check-graceful-shutdown.py
Graceful shutdown smoke check and in-flight request drain verification (#1689)

**Features:**
- Sends SIGTERM and verifies clean process exit (code 0)
- Detects hanging workers or unclosed connections/ports
- Simulates in-flight requests during termination to ensure safe draining
- Records structured JSON audit logs in `deployments/shutdown-smoke.log`

**Usage:**
```bash
./check-graceful-shutdown.py --command "node dist/server.js" --port 3001
```

See [docs/GRACEFUL_SHUTDOWN.md](../docs/GRACEFUL_SHUTDOWN.md) for full options and documentation.

### drill-backup-restore.sh
Automated backup restore drill and verification against scratch database (#1688)

**Features:**
- Static fixture validation (`--lint-only`)
- Restores fixture SQL into clean scratch database
- Verifies restored schema (tables, columns) and representative rows (pools, bets, claims, indexer ledger)

**Usage:**
```bash
./drill-backup-restore.sh --lint-only
DATABASE_URL=postgresql://... ./drill-backup-restore.sh
```

See [docs/BACKUP_RESTORE_DRILL.md](../docs/BACKUP_RESTORE_DRILL.md) for local run instructions.

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
