# Local End-to-End Runbook

This guide walks you through building or deploying the Predinex Soroban contract locally, wiring the web frontend to it, and running the full test suite — all from a clean checkout.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust + Cargo | stable (1.74+) | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | 21+ | https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup |
| Node.js | 18+ | https://nodejs.org |
| npm | 8+ | bundled with Node.js |
| Supported wallet flow | current | See [wallet and network support](../web/docs/WALLET_NETWORK_SUPPORT.md) for the active wallet entry point and unsupported combinations. |

Verify everything is in order with the bootstrap script:

```bash
./scripts/bootstrap.sh
```

---

## 1. Contract: build and test

```bash
cd contracts/predinex

# Run the full test suite (no network required)
cargo test

# Build the release WASM
stellar contract build
```

The compiled artifact lands at:
```
contracts/predinex/target/wasm32-unknown-unknown/release/predinex.wasm
```

> **Tip:** `stellar contract build` wraps `cargo build --release --target wasm32-unknown-unknown` and applies the release profile from `Cargo.toml` (`opt-level = "z"`, `codegen-units = 1`).

---

## 2. Deploy to Stellar testnet

> Skip this section if you only need to run the web app against the existing testnet contract. Jump to [section 3](#3-wire-the-web-app) and use the contract address already in `.env.example`.

### 2a. Create or fund a testnet account

```bash
# Generate a new keypair and save it as "deployer"
stellar keys generate deployer --network testnet

# Fund it from Friendbot
stellar keys fund deployer --network testnet
```

### 2b. Optimize the WASM (recommended for testnet)

```bash
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/predinex.wasm
```

Output: `predinex.optimized.wasm`

### 2c. Deploy

```bash
stellar contract deploy \
  --wasm predinex.optimized.wasm \
  --network testnet \
  --source deployer
```

The CLI prints the new **contract ID** — copy it. You will need it in the next step.

```
Contract deployed successfully with ID: C<your-contract-id>
```

### 2d. Initialize the contract

`initialize` requires a token address (the Stellar Asset Contract for XLM on testnet) and a treasury recipient address.

```bash
# XLM native asset SAC on Stellar testnet
XLM_TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Your deployer public key acts as treasury recipient for local development
TREASURY=$(stellar keys address deployer)

stellar contract invoke \
  --id <your-contract-id> \
  --network testnet \
  --source deployer \
  -- initialize \
  --token $XLM_TOKEN \
  --treasury_recipient $TREASURY
```

### 2e. Verify deployment

```bash
stellar contract invoke \
  --id <your-contract-id> \
  --network testnet \
  -- get_pool_count
```

Expected output: `0` (no pools yet).

---

## 3. Wire the web app

```bash
cd web

# Copy the example env file
cp .env.example .env.local
```

Open `.env.local` and set the minimum required values:

```env
# Required
NEXT_PUBLIC_NETWORK=testnet

# Set to your deployed contract ID from step 2c,
# or leave as-is to use the shared testnet deployment
NEXT_PUBLIC_CONTRACT_ADDRESS=<your-contract-id>
NEXT_PUBLIC_CONTRACT_NAME=predinex

# Optional — only needed for WalletConnect UI features
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=YOUR_PROJECT_ID
```

> **How the app resolves the contract:**
> `web/app/lib/runtime-config.ts` reads `NEXT_PUBLIC_NETWORK` to select the network and derives the API base URL from `web/app/lib/network-config.ts`. Contract reads flow through `web/app/lib/adapters/predinex-read-api.ts`.

### Environment variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_NETWORK` | **Yes** | — | `testnet` or `mainnet` |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | **Yes** | — | Deployed contract ID (`C…`) |
| `NEXT_PUBLIC_CONTRACT_NAME` | No | `predinex-pool` | Contract name suffix |
| `NEXT_PUBLIC_APP_URL` | No | `https://predinex.app` | Used for WalletConnect metadata |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | No | — | WalletConnect Cloud project ID |
| `NEXT_PUBLIC_STACKS_API_URL` | No | Hiro testnet URL | Override the legacy helper API endpoint |
| `DEBUG` | No | `false` | Enable verbose client-side logging |

---

## 4. Run the web app

```bash
cd web
npm install        # skip if you ran bootstrap.sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Smoke-check the contract wiring:**
1. Connect using the supported wallet flow documented in [WALLET_NETWORK_SUPPORT.md](../web/docs/WALLET_NETWORK_SUPPORT.md) and set the app to the matching supported network.
2. Navigate to **Markets** — the page fetches live pool data via `predinexReadApi.getMarkets()`.
3. Open browser DevTools → Network. Confirm a request to the configured helper API endpoint returns 200.
4. If `DEBUG=true` is set in `.env.local`, check the console for the resolved runtime config log.

---

## 5. Create a test pool (optional)

Verify the full round-trip by creating a pool from the CLI and confirming it appears in the UI:

```bash
stellar contract invoke \
  --id <your-contract-id> \
  --network testnet \
  --source deployer \
  -- create_pool \
  --creator $(stellar keys address deployer) \
  --title "Will BTC hit $100k?" \
  --description "Closes at end of month" \
  --outcome_a "Yes" \
  --outcome_b "No" \
  --duration 86400
```

Refresh the Markets page — the new pool should appear within one polling cycle (~30 s).

---

## 6. Run the full test suite

### Contract tests

```bash
cd contracts/predinex
cargo test
```

All tests run against `soroban-sdk`'s in-process environment — no network required.

### Web tests

```bash
cd web
npm run test
```

### Web lint + build check

```bash
cd web
npm run lint
npm run build
```

### All checks (mirrors CI)

```bash
# Contracts
cd contracts/predinex
cargo fmt --check
cargo clippy -- -D warnings
cargo test

# Web
cd ../../web
npm run lint
npm run test
npm run build
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Missing required config: NEXT_PUBLIC_NETWORK` | `.env.local` not created or missing the variable | `cp .env.example .env.local` and set `NEXT_PUBLIC_NETWORK=testnet` |
| Markets page shows no pools | Wrong contract ID in env | Double-check `NEXT_PUBLIC_CONTRACT_ADDRESS` matches the deployed contract |
| `Already initialized` panic on deploy | Contract was already initialized | This is expected on re-deploy; only call `initialize` once per contract ID |
| `wasm32-unknown-unknown` target missing | Rust target not installed | `rustup target add wasm32-unknown-unknown` |
| Wallet shows "wrong network" | Wallet connected to the wrong supported network | Switch the app to the matching supported network and reconnect |
| `stellar: command not found` | Stellar CLI not installed | Follow the [CLI setup guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) |

---

## Further reading

- [Contract versioning and migration](../web/docs/CONTRACT_VERSIONING.md)
- [Contract event schemas](../web/docs/CONTRACT_EVENTS.md)
- [Frontend development guide](../web/DEVELOPMENT.md)
- [Release process](../RELEASE.md)
