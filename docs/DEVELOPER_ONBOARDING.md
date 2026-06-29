# Developer Onboarding Guide

Welcome to Predinex Stellar! This guide helps new developers get up and running quickly, with solutions for common setup issues.

---

## Quick Verification Checklist

Before diving in, verify your setup with this checklist:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] npm 8+ installed (`npm --version`) — **not pnpm or yarn**
- [ ] Rust stable + Cargo (`cargo --version`)
- [ ] WASM target installed (`rustup target list | grep wasm32-unknown-unknown`)
- [ ] Stellar CLI 21+ installed (`stellar --version`)
- [ ] Freighter wallet browser extension installed
- [ ] Bootstrap script passes (`./scripts/bootstrap.sh`)
- [ ] Repository cloned and web dependencies installed

---

## Prerequisites

### System Requirements

| Tool | Minimum Version | Notes |
|------|-----------------|-------|
| **Node.js** | 18 | 22 is used in CI; install from [nodejs.org](https://nodejs.org) |
| **npm** | 8 | Comes with Node.js; **do not use pnpm or yarn** |
| **Rust + Cargo** | stable (1.74+) | Install via [rustup.rs](https://rustup.rs) |
| **WASM Target** | — | Required for contract compilation |
| **Stellar CLI** | 21+ | [Installation guide](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) |
| **Freighter Wallet** | latest | Browser extension: [freighter.app](https://www.freighter.app) |

### Installation Steps

#### macOS / Linux

```bash
# Node.js (via Homebrew)
brew install node

# Verify versions
node --version  # Should be v18 or higher
npm --version   # Should be 8 or higher

# Rust + Cargo (via rustup)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update stable
rustup target add wasm32-unknown-unknown

# Stellar CLI
brew install stellar/tap/stellar-cli

# Verify Stellar CLI
stellar --version  # Should be 21 or higher
```

#### Windows

```bash
# Node.js: Download from https://nodejs.org and install

# Rust + Cargo
# Download and run rustup-init.exe from https://rustup.rs

# After installation, in PowerShell:
rustup update stable
rustup target add wasm32-unknown-unknown

# Stellar CLI: Download from https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup
```

---

## Installation

### Clone and Setup

```bash
# Clone the repository
git clone https://github.com/Mosas2000/predinex-stellar.git
cd predinex-stellar

# Install web dependencies
cd web
npm install
cd ..

# Run bootstrap verification
./scripts/bootstrap.sh
```

### Configure Environment

Create `web/.env.local`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=<testnet-contract-C-strkey>
```

The contract address for the shared testnet is available in `web/.env.example`.

### Start Development Server

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Verification

After setup, verify everything works:

### Web Frontend

```bash
cd web

# Should pass without errors
npm run lint

# Should complete successfully (10+ tests)
npm test -- --run

# Should build without warnings
npm run build

# Should run without errors
npm run dev
```

### Smart Contracts

```bash
cd contracts/predinex

# Format check
cargo fmt --check

# Lint
cargo clippy -- -D warnings

# Unit tests
cargo test

# Build WASM artifact
stellar contract build
```

---

## Common Setup Issues & Solutions

### Issue: WASM Target Missing

**Error**: `error: failed to resolve: use of undeclared type or module wasm32`

**Solution**:
```bash
rustup target add wasm32-unknown-unknown
rustup target list  # Verify it's installed
```

### Issue: Node.js Version Wrong

**Error**: `npm ERR! Node v16.x.x is not supported` or similar

**Solution**:
```bash
node --version  # Check current version

# Update via Node Version Manager (nvm) - recommended
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18

# Or download from https://nodejs.org (LTS version)
```

### Issue: Stellar CLI Not Found

**Error**: `stellar: command not found`

**Solution**:
```bash
stellar --version  # Check if installed

# macOS
brew install stellar/tap/stellar-cli

# Linux
wget https://github.com/stellar/stellar-cli/releases/latest/download/stellar-cli-*.tar.gz
tar xzf stellar-cli-*.tar.gz
sudo mv stellar /usr/local/bin/

# Windows: Download .exe from https://developers.stellar.org
```

Verify: `stellar --version` should be 21+

### Issue: npm Dependencies Fail

**Error**: `npm ERR! code ERESOLVE` or lockfile conflicts

**Solution**:
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
npm install

# Ensure you're not using pnpm or yarn
which pnpm  # Should return nothing
which yarn  # Should return nothing
```

### Issue: Port 3000 Already in Use

**Error**: `Error: listen EADDRINUSE :::3000`

**Solution**:
```bash
# Kill process on port 3000 (macOS/Linux)
lsof -i :3000
kill -9 <PID>

# Or run on a different port
npm run dev -- -p 3001
```

### Issue: Environment Variables Not Loaded

**Error**: Contract ID is undefined or connection fails

**Solution**:
```bash
# Verify file exists
ls -la web/.env.local

# Check contents (should include NEXT_PUBLIC_SOROBAN_CONTRACT_ID)
cat web/.env.local

# Restart dev server after creating/modifying .env.local
npm run dev
```

### Issue: Freighter Wallet Not Connecting

**Error**: "No wallet detected" or connection fails

**Solution**:
1. Install Freighter extension from [freighter.app](https://www.freighter.app)
2. Create or import a wallet
3. Switch to **Testnet** in Freighter settings
4. Refresh [http://localhost:3000](http://localhost:3000)
5. Click "Connect Wallet"

### Issue: Contract Build Fails

**Error**: `error: could not compile stellar-contract-spec`

**Solution**:
```bash
# Update Rust
rustup update stable

# Add WASM target if missing
rustup target add wasm32-unknown-unknown

# Try building again from contracts/predinex/
cd contracts/predinex
cargo clean
stellar contract build
```

### Issue: Tests Fail Unexpectedly

**Error**: Tests pass locally but fail in CI

**Solution**:
```bash
# Ensure Node 18+ (CI uses 22)
node --version

# Run exact CI test command
npm test -- --run

# Check for hardcoded timeouts or environment assumptions
grep -r "timeout" tests/

# Run with verbose output
npm test -- --run --reporter=verbose
```

---

## First Steps After Setup

### 1. Explore the Structure

```
predinex-stellar/
├── web/                    # Next.js frontend
│   ├── app/                # App Router (routes, pages, components)
│   ├── lib/                # Utilities, hooks, API clients
│   ├── components/         # Shared React components
│   ├── tests/              # Vitest test suite
│   └── package.json
├── contracts/predinex/     # Soroban smart contracts (Rust)
└── docs/                   # Architecture & deployment guides
```

### 2. Run Your First Test

```bash
cd web
npm test -- --run tests/routes/smoke.test.tsx
```

This verifies all top-level routes mount without crashing.

### 3. Make a Small Change

- Modify `web/app/page.tsx` (home page)
- Save and watch [http://localhost:3000](http://localhost:3000) auto-reload
- This confirms hot-module replacement (HMR) works

### 4. Read Key Documentation

- [Contributing Guide](../CONTRIBUTING.md) — workflow and standards
- [Frontend Development](./web/DEVELOPMENT.md) — architecture patterns
- [Frontend Architecture](./web/FRONTEND.md) — component design
- [Local Runbook](./docs/local-runbook.md) — full local deployment
- [Stellar Smart Contracts](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)

---

## Running Full Checks Locally

Before opening a pull request, run these checks:

```bash
cd web

# Lint (ESLint)
npm run lint

# Unit and integration tests
npm test -- --run

# Production build
npm run build

# Visual regression tests (optional)
npm run test:visual
```

All must pass before pushing. These match the CI workflow.

---

## Getting Help

- **Setup issues**: Check [Common Setup Issues](#common-setup-issues--solutions) above
- **Architecture questions**: See [Frontend Development](./web/DEVELOPMENT.md)
- **Stellar docs**: [developers.stellar.org](https://developers.stellar.org)
- **Repository issues**: Search existing issues or comment on open ones
- **Pull request checklist**: See [CONTRIBUTING.md](../CONTRIBUTING.md#pull-request-checklist)

---

## Next Steps

1. ✅ Run bootstrap script and verify checklist
2. ✅ Clone and install dependencies
3. ✅ Configure `.env.local` and start dev server
4. ✅ Run all verification commands
5. ✅ Read CONTRIBUTING.md for workflow
6. ✅ Pick an issue and create a feature branch
7. ✅ Make changes, run checks, open PR

Happy coding! 🚀
