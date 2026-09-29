# Predinex Contract Deployment Guide

Step-by-step guide to build, deploy, initialize, and verify the `predinex` Soroban smart contract on Stellar testnet and mainnet.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | ≥ 1.78 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 22.0 | `cargo install --locked stellar-cli --features opt` |
| Funded account | — | See step 1 |

---

## 1. Fund an Account

For testnet:
```bash
# Generate a new keypair
stellar keys generate deployer --network testnet

# Fund via Friendbot
stellar keys fund deployer --network testnet

# Verify balance
stellar account show --network testnet $(stellar keys address deployer)
```

For mainnet, create an account and fund it with at least 20 XLM.

---

## 2. Build the Contract WASM

From the repo root:

```bash
cd contracts/predinex
stellar contract build
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/predinex.wasm
```

The optimised WASM is written to:

```
contracts/predinex/target/wasm32-unknown-unknown/release/predinex.optimized.wasm
```

Run tests before deploying:

```bash
cargo test
```

---

## 3. Deploy to Network

### Testnet

```bash
stellar contract deploy \
  --wasm contracts/predinex/target/wasm32-unknown-unknown/release/predinex.optimized.wasm \
  --source deployer \
  --network testnet
```

### Mainnet

Ensure you use your mainnet RPC URL and network passphrase. Check `deploy-mainnet.yml` for specifics.

```bash
stellar contract deploy \
  --wasm contracts/predinex/target/wasm32-unknown-unknown/release/predinex.optimized.wasm \
  --source deployer \
  --network mainnet \
  --rpc-url $STELLAR_RPC_URL \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --fee 1000000
```

Save the printed **contract ID**:

```bash
export CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 4. Initialize the Contract

`initialize` must be called exactly once. It binds the SAC token and sets the treasury recipient and admin.

### Testnet

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --token $TOKEN_ID \
  --treasury_recipient $(stellar keys address deployer) \
  --admin $(stellar keys address deployer)
```

### Mainnet

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network mainnet \
  --rpc-url $STELLAR_RPC_URL \
  --network-passphrase "$STELLAR_NETWORK_PASSPHRASE" \
  --fee 100000 \
  -- initialize \
  --token $TOKEN_ID \
  --treasury_recipient $TREASURY_ADDRESS \
  --admin $ADMIN_ADDRESS
```

---

## 5. Verify Deployment on Stellar Explorer

Open [https://stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet) and search for `$CONTRACT_ID`.

You should see:

- Contract type: **Soroban**
- Recent transaction: the `initialize` invocation
- Storage entries for `Token`, `TreasuryRecipient`, `Treasury`, `ContractVersion`

Verify via CLI:

```bash
# Check protocol fee (should return 200)
stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- get_protocol_fee

# Check treasury recipient
stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- get_treasury_recipient
```

---

## 6. Wire Contract ID into the Web App

### `web/.env.local`

```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_TOKEN_ID=CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

For **pubnet**:

```env
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

Start the dev server:

```bash
npm run dev
# or
pnpm dev
```

---

## 7. Operations and Runbook

For ongoing operations, monitoring, incident response, and emergency procedures, please refer to the [Operational Runbook](DEPLOYMENT_RUNBOOK.md).

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `AlreadyInitialized` | `initialize` called twice | Contract is live; skip this step |
| `HostError: Error(Auth, InvalidAction)` | Missing `require_auth` | Pass `--source` matching the `caller` argument |
| `insufficient balance` | Deployer not funded | Run `stellar keys fund deployer --network testnet` |
| WASM not found | Build not run | Run `stellar contract build` |
| `PoolNotExpired` on `claim_expired` | Pool expiry not yet passed | Advance ledger time or wait |
