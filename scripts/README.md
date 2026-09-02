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

## Requirements

- stellar-cli
- sha256sum/shasum
- xxd
- jq

## Documentation

See `/docs/CONTRACT_VERIFICATION.md`

## License

ISC
