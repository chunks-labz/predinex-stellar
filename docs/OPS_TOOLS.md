# Operations Tools & Deployment Safety

This document describes the three ops tools implemented to ensure safe, reliable deployments of Predinex Stellar contracts.

## Overview

Three scripts work together to provide comprehensive deployment safety:

1. **verify-wiring.sh** — Post-deploy resolver/treasury wiring smoke test
2. **verify-wasm-checksums.sh** — WASM artifact pinning and verification
3. **monitor-stuck-markets.sh** — Market resolution health monitoring

---

## 1. Post-Deploy Resolver/Treasury Wiring Smoke Test

**Location:** `scripts/verify-wiring.sh`  
**Issue:** #1606  
**Purpose:** Verify that a fresh deployment correctly connects market-core, resolver, and treasury contracts.

### What It Does

After deployment, this script validates:
- Contract is accessible and deployed
- Admin address is properly configured
- Resolver address is wired correctly
- Treasury recipient is configured
- All three contracts agree on their wiring state

### Usage

```bash
# Verify testnet deployment
./scripts/verify-wiring.sh CAXXX...

# Verify mainnet deployment
./scripts/verify-wiring.sh --network mainnet CAXXX...

# Custom RPC endpoint
./scripts/verify-wiring.sh --rpc-url https://soroban-mainnet.stellar.org CAXXX...

# Verbose output
./scripts/verify-wiring.sh --verbose CAXXX...
```

### Output

Generates a JSON report in `./verification-reports/wiring_verification_*.json` with:
- Timestamp and network info
- Contract ID
- Number of checks passed/failed
- Overall result (passed/failed)

### Integration in CI/CD

Add to post-deployment CI step:

```bash
set -e
./scripts/deploy-testnet.sh
CONTRACT_ID=$(cat deployed_contract.txt)
./scripts/verify-wiring.sh "$CONTRACT_ID"
```

---

## 2. WASM Artifact Checksum Verification

**Location:** `scripts/verify-wasm-checksums.sh`  
**Checksums File:** `.wasm-checksums`  
**Issue:** #1608  
**Purpose:** Pin WASM binaries and prevent silent deployment of changed contracts.

### What It Does

This script manages SHA256 checksums for compiled WASM artifacts:
- **generate** — Compute checksums for current build artifacts and commit to `.wasm-checksums`
- **verify** — Check that deployed WASM matches committed checksums (CI check)
- **check** — Quick validation without generation (read-only verification)
- **list** — Display all tracked artifacts and their checksums

### Why It Matters

Without checksum verification, it's possible for:
- Compiler changes to silently produce different binaries
- Build artifacts to become corrupted
- Deployment scripts to pick up wrong files
- Contract logic to change without detection

The checksums file is committed to git, creating an immutable record of what should be deployed.

### Usage

```bash
# After building, generate checksums
cargo build --target wasm32-unknown-unknown --release
./scripts/verify-wasm-checksums.sh generate

# Commit checksums
git add .wasm-checksums
git commit -m "chore: pin wasm checksums"

# Before deployment, verify checksums
./scripts/verify-wasm-checksums.sh verify

# Quick check (doesn't require rebuild)
./scripts/verify-wasm-checksums.sh check

# List all tracked artifacts
./scripts/verify-wasm-checksums.sh list
```

### .wasm-checksums Format

```
# WASM Artifact Checksums
# SHA256 hash and filename pairs
<SHA256_HASH>  <ARTIFACT_NAME>
```

Example:
```
a1b2c3d4e5f6... predinex.wasm
9z8y7x6w5v4... pool.wasm
```

### Integration in CI/CD

```bash
# Pre-build: verify no unintended changes
./scripts/verify-wasm-checksums.sh check

# Post-build: regenerate/update checksums
cargo build --target wasm32-unknown-unknown --release
./scripts/verify-wasm-checksums.sh generate

# Pre-deploy: final validation
./scripts/verify-wasm-checksums.sh verify
```

### Workflow

1. **Local development:**
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ./scripts/verify-wasm-checksums.sh generate
   git add .wasm-checksums
   git commit -m "update: wasm checksums"
   ```

2. **Code review:**
   - Reviewer inspects `.wasm-checksums` diff
   - Confirms changes are intentional (source code changes warrant new checksums)
   - If unexpected, requests explanation

3. **CI/CD:**
   - Build step regenerates checksums
   - Verify step ensures they match committed versions
   - Deployment blocked if checksums don't match

---

## 3. Market Resolution Health Monitoring

**Location:** `scripts/monitor-stuck-markets.sh`  
**Issue:** #1607  
**Purpose:** Monitor for markets unresolved past their close time and emit alerts.

### What It Does

Continuously monitors the network for unresolved markets:
- Queries contract for markets past their close time
- Tracks how long each has been unresolved
- Emits alerts when age exceeds grace period
- Logs all activity for audit trails

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--grace-period` | 3600 | Seconds before alert (1 hour) |
| `--interval` | 300 | Check frequency in seconds (5 min) |
| `--network` | testnet | Network to monitor |
| `--contract-id` | (required) | Contract address to monitor |
| `--log-dir` | ./monitoring-logs | Where to write logs |

### Usage

```bash
# Monitor testnet with defaults
./scripts/monitor-stuck-markets.sh --contract-id CAXXX...

# Custom grace period (30 minutes)
./scripts/monitor-stuck-markets.sh \
    --contract-id CAXXX... \
    --grace-period 1800

# Check every 5 minutes
./scripts/monitor-stuck-markets.sh \
    --contract-id CAXXX... \
    --interval 300

# Mainnet monitoring
./scripts/monitor-stuck-markets.sh \
    --network mainnet \
    --contract-id CAXXX...

# One-time check (for testing)
./scripts/monitor-stuck-markets.sh \
    --contract-id CAXXX... \
    --once
```

### Log Output

Logs are written to `./monitoring-logs/stuck-markets-YYYY-MM-DD.log`:

```
[2026-11-19T15:30:45Z] START: Market monitoring started (grace_period=3600s, interval=300s)
[2026-11-19T15:30:46Z] ✓ Contract is accessible
[2026-11-19T15:30:46Z] Checked: 42 markets
[2026-11-19T15:30:46Z] Alerts: 0 stuck markets
```

Alert example:
```
[2026-11-19T15:35:45Z] ALERT: Market C... stuck for 125 minutes (grace period: 60m)
```

### Integration with Logging Systems

The script outputs:
- **INFO** lines for routine checks
- **ALERT** lines for triggered alerts
- **ERROR** lines for failures

Integrate with log aggregation (ELK, Splunk, Datadog):

```bash
# Forward to syslog
./scripts/monitor-stuck-markets.sh --contract-id CAXXX... | logger -t predinex-markets

# Or run as systemd service
# [Unit]
# Description=Predinex Market Monitoring
# After=network.target
#
# [Service]
# Type=simple
# ExecStart=/path/to/monitor-stuck-markets.sh --contract-id CAXXX...
# Restart=on-failure
# StandardOutput=journal
# StandardError=journal
#
# [Install]
# WantedBy=multi-user.target
```

### Grace Period Guidance

The grace period allows time for:
- **Oracle updates** (5-10 min typical)
- **Manual resolution** (may require governance)
- **Network latency** and transaction confirmation
- **Dispute/challenge periods** (application-specific)

Suggested values:
- **Development/testnet:** 300-600 seconds (5-10 min)
- **Production (liquid markets):** 1800 seconds (30 min)
- **Production (illiquid/manual):** 3600+ seconds (1+ hour)

---

## Deployment Checklist

Use all three tools together for safe deployments:

### Pre-Deployment

- [ ] Code review and testing complete
- [ ] Run `./scripts/verify-wasm-checksums.sh check` — verify no unintended changes
- [ ] Build contract: `cargo build --target wasm32-unknown-unknown --release`
- [ ] Update checksums: `./scripts/verify-wasm-checksums.sh generate`
- [ ] Commit checksums: `git add .wasm-checksums && git commit -m "..."`

### Deployment

- [ ] Run deployment script: `./scripts/deploy-testnet.sh`
- [ ] Record deployed contract ID
- [ ] Run wiring verification: `./scripts/verify-wiring.sh <contract-id>`
- [ ] Verify all checks pass ✓

### Post-Deployment

- [ ] Enable market monitoring: `./scripts/monitor-stuck-markets.sh --contract-id <id>`
- [ ] Configure log aggregation if production
- [ ] Test market creation and resolution flow
- [ ] Verify monitoring catches issues

---

## Troubleshooting

### verify-wiring.sh issues

**Contract not found:**
```bash
# Check contract ID format (must be C + 55 chars)
./scripts/verify-wiring.sh --verbose CAXXX...

# Try explicit RPC URL
./scripts/verify-wiring.sh --rpc-url https://soroban-testnet.stellar.org CAXXX...
```

**Network issues:**
```bash
# Test RPC endpoint
curl https://soroban-testnet.stellar.org/health
```

### verify-wasm-checksums.sh issues

**Checksum mismatch after build:**
```bash
# Verify build directory
./scripts/verify-wasm-checksums.sh --verbose verify

# Check if sources changed
git diff contracts/

# Regenerate if changes are intentional
./scripts/verify-wasm-checksums.sh generate
```

**Missing WASM files:**
```bash
# Ensure build completed
cargo build --target wasm32-unknown-unknown --release --verbose

# Check output directory
ls -la contracts/predinex/target/wasm32-unknown-unknown/release/
```

### monitor-stuck-markets.sh issues

**Contract not accessible:**
```bash
# Verify contract ID
./scripts/monitor-stuck-markets.sh --contract-id CAXXX... --once --verbose

# Test RPC
stellar contract info --id CAXXX... --rpc-url <rpc-url>
```

**No markets detected:**
```bash
# Check if markets exist
./scripts/monitor-stuck-markets.sh --contract-id CAXXX... --once --verbose

# May be working as designed if all markets are resolved
```

---

## See Also

- [Deployment Guide](./DEPLOYMENT.md)
- [Contract Specification](./CONTRACT_SPEC.md)
- [CI/CD Pipeline](../.github/workflows)
