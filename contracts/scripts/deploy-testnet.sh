#!/usr/bin/env bash
# =============================================================================
# Predinex Stellar — Testnet Deployment Script
#
# Builds the Soroban contract, deploys it to Stellar testnet, and invokes
# the initialize function with the configured admin and treasury addresses.
#
# Usage:
#   ./contracts/scripts/deploy-testnet.sh
#
# Prerequisites:
#   - Stellar CLI (https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
#   - Rust with wasm32-unknown-unknown target
#   - A funded testnet account (get lumens from https://laboratory.stellar.org/#account-creator?network=testnet)
#   - .env file with SOROBAN_SECRET_KEY (see .env.example)
#
# Environment variables (set in .env or export):
#   SOROBAN_RPC_URL          — Testnet RPC endpoint (default: https://soroban-testnet.stellar.org)
#   SOROBAN_NETWORK_PASSPHRASE — Testnet passphrase (default: Test SDF Network ; September 2015)
#   SOROBAN_SECRET_KEY       — Deployer account secret key (S...)
#   SOROBAN_ADMIN_ADDRESS    — Admin address for initialize (default: deployer public key)
#   SOROBAN_TREASURY_ADDRESS — Treasury recipient for fees (default: admin address)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACT_DIR="$REPO_ROOT/contracts/predinex"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

# ─── Load .env if present ────────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$SCRIPT_DIR/.env"
    set +a
    info "Loaded environment from .env"
fi

# ─── Validate required tools ─────────────────────────────────────────────────
if ! command -v stellar &> /dev/null; then
    error "Stellar CLI is not installed."
    echo "    Install from: https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli"
    exit 1
fi

STELLAR_VERSION=$(stellar version 2>/dev/null || echo "unknown")
info "Stellar CLI $STELLAR_VERSION detected."

# ─── Validate required env vars ──────────────────────────────────────────────
if [ -z "${SOROBAN_SECRET_KEY:-}" ]; then
    error "SOROBAN_SECRET_KEY is not set."
    echo "    Set it in contracts/scripts/.env or export it."
    exit 1
fi

SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
SOROBAN_WASM_PATH="${SOROBAN_WASM_PATH:-$CONTRACT_DIR/target/wasm32-unknown-unknown/release/predinex.optimized.wasm}"

echo ""
echo "============================================"
echo "  Predinex — Testnet Deployment"
echo "============================================"
echo ""

# ─── Step 1: Build contract ──────────────────────────────────────────────────
info "Step 1: Building contract WASM..."
cd "$CONTRACT_DIR"
cargo build --target wasm32-unknown-unknown --release
info "Contract built successfully."

# ─── Step 2: Optimize WASM ───────────────────────────────────────────────────
info "Step 2: Optimizing WASM..."
WASM_SRC="$CONTRACT_DIR/target/wasm32-unknown-unknown/release/predinex.wasm"
stellar contract optimize --wasm "$WASM_SRC"
info "WASM optimized."

# ─── Step 3: Deploy to testnet ───────────────────────────────────────────────
info "Step 3: Deploying to testnet..."
DEPLOY_OUTPUT=$(stellar contract deploy \
    --wasm "$SOROBAN_WASM_PATH" \
    --source "$SOROBAN_SECRET_KEY" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE"
)
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | tail -1 | tr -d '[:space:]')

if [ -z "$CONTRACT_ID" ]; then
    error "Failed to extract contract ID from deploy output."
    echo "    Output: $DEPLOY_OUTPUT"
    exit 1
fi
info "Contract deployed with ID: $CONTRACT_ID"

# ─── Step 4: Initialize contract ─────────────────────────────────────────────
info "Step 4: Initializing contract..."

# Derive admin address from secret key if not explicitly set
if [ -z "${SOROBAN_ADMIN_ADDRESS:-}" ]; then
    SOROBAN_ADMIN_ADDRESS=$(stellar keys address "$SOROBAN_SECRET_KEY" 2>/dev/null || \
        stellar account --source "$SOROBAN_SECRET_KEY" --rpc-url "$SOROBAN_RPC_URL" --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" info 2>/dev/null | grep "Account ID" | awk '{print $NF}')
fi

TREASURY="${SOROBAN_TREASURY_ADDRESS:-$SOROBAN_ADMIN_ADDRESS}"

if [ -z "${SOROBAN_ADMIN_ADDRESS:-}" ]; then
    error "Could not determine admin address. Set SOROBAN_ADMIN_ADDRESS in .env."
    exit 1
fi

stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$SOROBAN_SECRET_KEY" \
    --rpc-url "$SOROBAN_RPC_URL" \
    --network-passphrase "$SOROBAN_NETWORK_PASSPHRASE" \
    -- \
    initialize \
    --admin "$SOROBAN_ADMIN_ADDRESS" \
    --treasury_recipient "$TREASURY"

info "Contract initialized with admin: $SOROBAN_ADMIN_ADDRESS"
info "Treasury recipient: $TREASURY"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
info "Testnet deployment complete!"
echo ""
echo "  Contract ID:  $CONTRACT_ID"
echo "  Network:      Testnet"
echo "  RPC URL:      $SOROBAN_RPC_URL"
echo "  Admin:        $SOROBAN_ADMIN_ADDRESS"
echo "  Treasury:     $TREASURY"
echo ""
echo "  Export for frontend:"
echo "    export NEXT_PUBLIC_SOROBAN_CONTRACT_ID=$CONTRACT_ID"
echo "    export NEXT_PUBLIC_NETWORK=testnet"
echo "============================================"
