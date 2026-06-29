# Predinex Contract Deployment Guide

Step-by-step guide to build, deploy, initialize, and verify the `predinex` Soroban smart contract on Stellar testnet, then wire it into the web app.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | ≥ 1.78 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 22.0 | `cargo install --locked stellar-cli --features opt` |
| Funded testnet account | — | See step 1 |

---

## 1. Fund a Testnet Account

```bash
# Generate a new keypair
stellar keys generate deployer --network testnet

# Fund via Friendbot
stellar keys fund deployer --network testnet

# Verify balance
stellar account show --network testnet $(stellar keys address deployer)
```

---

## 2. Build the Contract WASM

From the repo root:

```bash
cd contracts/predinex
cargo build --target wasm32-unknown-unknown --release
```

The optimised WASM is written to:

```
contracts/predinex/target/wasm32-unknown-unknown/release/predinex.wasm
```

Run tests before deploying:

```bash
cargo test
```

---

## 3. Deploy to Testnet

```bash
stellar contract deploy \
  --wasm contracts/predinex/target/wasm32-unknown-unknown/release/predinex.wasm \
  --source deployer \
  --network testnet
```

Save the printed **contract ID**:

```bash
export CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

---

## 4. Initialize the Contract

`initialize` must be called exactly once. It binds the SAC token and sets the treasury recipient.

```bash
# Deploy a test token (or use an existing SAC address)
stellar contract deploy \
  --wasm /path/to/soroban_token_contract.wasm \
  --source deployer \
  --network testnet
# → TOKEN_ID=CYYY...

export TOKEN_ID=CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --token $TOKEN_ID \
  --treasury_recipient $(stellar keys address deployer)
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

## 7. Pubnet Checklist

- [ ] Full test suite passes: `cargo test`
- [ ] Contract audited by a third party
- [ ] Admin and treasury keys on hardware wallet or multisig
- [ ] `fee_bps` set to intended value (default 200 = 2 %)
- [ ] Deployer keypair stored offline after initialization
- [ ] Contract ID recorded in `CHANGELOG.md`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `AlreadyInitialized` | `initialize` called twice | Contract is live; skip this step |
| `HostError: Error(Auth, InvalidAction)` | Missing `require_auth` | Pass `--source` matching the `caller` argument |
| `insufficient balance` | Deployer not funded | Run `stellar keys fund deployer --network testnet` |
| WASM not found | Build not run | Run `cargo build --target wasm32-unknown-unknown --release` |
| `PoolNotExpired` on `claim_expired` | Pool expiry not yet passed | Advance ledger time or wait |
