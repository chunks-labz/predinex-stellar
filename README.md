# Predinex Stellar

> Next-generation prediction markets on Stellar (via Soroban).

![Status](https://img.shields.io/badge/Status-BETA-blue?style=for-the-badge)
![Commits](https://img.shields.io/badge/Project_Lifecycle-Initial_Implementation-green?style=for-the-badge)
 ![Rust](https://img.shields.io/badge/Language-Rust-brown?style=flat-square) ![Soroban](https://img.shields.io/badge/Platform-Soroban-black?style=flat-square) ![License](https://img.shields.io/badge/License-ISC-blue?style=flat-square)

## 🏗 System Architecture

The project centers around the `predinex`,  Soroban smart contract which manages pool states, betting logic, and fund distribution. It utilizes the Stellar Asset Contract (SAC) for secure token transfers.

```mermaid
graph TD
    User[User / Client]
    
    subgraph Stellar_Blockchain [Stellar Blockchain]
        Contract[predinex.wasm]
        Ledger[Ledger State]
    end
    
    subgraph Storage [Soroban Storage]
        Pools[Pools Data]
        UserBets[User Bets Data]
    end

    User -- "Create Pool" --> Contract
    User -- "Place Bet (XLM/TKN)" --> Contract
    User -- "Settle Pool" --> Contract
    
    Contract -- Read/Write --> Pools
    Contract -- Read/Write --> UserBets
    Contract -- Updates --> Ledger
```

## 🔄 Workflow

The prediction market lifecycle on Stellar is designed for speed and finality.

```mermaid
stateDiagram-v2
    [*] --> Created: create_pool
    
    state Created {
        [*] --> BettingOpen
        BettingOpen --> BettingOpen: place_bet
    }
    
    Created --> Settled: settle_pool
    
    state Settled {
        [*] --> FundsDistributed
        note right of FundsDistributed
          Winner is declared
          Marked as settled
        end note
    }
    
    Settled --> [*]
```

## ✨ Features

- **Decentralized Prediction Pools**: Create and manage binary outcome markets with ease.
- **Fast Settlements**: Leverages Stellar's 5-second finality for rapid results.
- **Cross-Asset Betting**: Compatible with any Stellar asset via the Stellar Asset Contract (SAC).
- **Automated Bookkeeping**: Real-time tracking of pool totals and user positions.
- **Robust Security**: Built with Rust and Soroban's secure-by-design architecture.
- **Transparency**: Fully verifiable on-chain data and transaction history.

## 🚀 Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/)
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli)
- [Node.js](https://nodejs.org/) (v18+)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd predinex-stellar
   ```

2. **Quick Start (Recommended)**

   Run the bootstrap script to install all dependencies and verify your environment:
   ```bash
   ./scripts/bootstrap.sh
   ```

3. **Build the Contract**
   ```bash
   cd contracts/predinex
   stellar contract build
   ```

4. **Run Tests**
   ```bash
   cargo test
   ```

## 🛣️ Roadmap to Launch

Predinex Stellar follows a phased approach to bring a premium betting experience to the ecosystem.

### Phase 1: Core Soroban Implementation (COMPLETED)
- ✅ Core contract logic (Pools, Bets, Settlement).
- ✅ Unit test suite for full lifecycle verification.
- ✅ Token integration (SAC).

### Phase 2: Frontend Migration (IN PROGRESS)
- 🔄 Stellar SDK integration.
- 🔄 Wallet and network support are tracked in the canonical [wallet and network support page](./web/docs/WALLET_NETWORK_SUPPORT.md).
- ⏳ Real-time market tracking on Stellar.

## 🤝 Contributing & Releases

We welcome contributions! Please read the [Contributing Guide](./CONTRIBUTING.md) first — it covers local setup, running checks, documentation standards, and the issue/PR workflow.

Additional development guides:
- [Local End-to-End Runbook](./docs/local-runbook.md) — build the contract, deploy to testnet, and wire the web app from a clean checkout
- [Contract API Reference](./docs/contract-api.md) — every public function, data types, auth requirements, fee model, and events
- [Deployment Guide](./docs/deployment-guide.md) — build WASM, deploy to testnet/pubnet, initialize, and verify
- [Frontend Development](./web/DEVELOPMENT.md)
- [Release Process](./RELEASE.md)

## 🛠️ CI/CD Pipeline

The project uses GitHub Actions to ensure code quality and prevent regressions. The workflow runs on every push and pull request to `main`.

### Preview Deployments

Pull requests automatically generate preview deployments for the web app, making it easy to review UI changes:

- 🚀 **Automatic**: Every PR with web changes gets a live preview
- 🔗 **Shareable**: Preview URLs are posted as PR comments
- 🔒 **Safe**: Previews use testnet configuration only
- ⚡ **Fast**: Deployments complete in ~2 minutes

**Setup Guide**: See [Preview Deployment Quick Start](./docs/PREVIEW_SETUP_QUICKSTART.md) for 5-minute setup instructions.

**Full Documentation**: [Preview Deployments Guide](./docs/preview-deployments.md)

### Local Verification

You can run the same checks locally to verify your changes before pushing:

**Web App:**
```bash
cd web
npm run lint
npm run test
npm run build
```

**Smart Contracts:**
```bash
cd contracts/predinex
cargo fmt
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

---

## 📄 License

This project is licensed under the ISC License.
