#!/usr/bin/env bash
# scripts/rollback.sh — Emergency rollback to a previous mainnet deployment.
#
# Usage:
#   ./scripts/rollback.sh <target-version>
#
# Example:
#   ./scripts/rollback.sh v1.0.1
#
# What it does:
#   1. Loads the deployment record for <target-version> from deployments/
#   2. Confirms with the operator before proceeding
#   3. Verifies the WASM hash in the artifact matches the on-chain hash
#   4. Re-deploys the target WASM to a NEW contract ID (Soroban contracts
#      are immutable; rollback = redeploy old binary + re-initialize)
#   5. Prints next steps for updating env vars and DNS/routing

set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
error()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*"; }
info()   { echo -e "${GREEN}[INFO]${NC}  $*"; }

# ── arg check ────────────────────────────────────────────────────────────────
[[ $# -eq 1 ]] || error "Usage: $0 <target-version>  e.g. $0 v1.0.1"
TARGET_VERSION="$1"

DEPLOY_FILE="deployments/${TARGET_VERSION}.json"
[[ -f "$DEPLOY_FILE" ]] || error "Deployment record not found: $DEPLOY_FILE"

# ── env checks ───────────────────────────────────────────────────────────────
command -v stellar  >/dev/null || error "stellar CLI not found"
command -v jq       >/dev/null || error "jq not found"
command -v sha256sum >/dev/null || error "sha256sum not found"

[[ -n "${MAINNET_DEPLOYER_SECRET:-}" ]] || error "MAINNET_DEPLOYER_SECRET env var not set"
[[ -n "${MAINNET_XLM_SAC:-}"         ]] || error "MAINNET_XLM_SAC env var not set"
[[ -n "${MAINNET_TREASURY_ADDRESS:-}" ]] || error "MAINNET_TREASURY_ADDRESS env var not set"

RPC_URL="${STELLAR_RPC_URL:-https://mainnet.sorobanrpc.com}"
PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Public Global Stellar Network ; September 2015}"

# ── load deployment record ───────────────────────────────────────────────────
OLD_CONTRACT_ID=$(jq -r .contract_id     "$DEPLOY_FILE")
WASM_HASH=$(      jq -r .wasm_hash       "$DEPLOY_FILE")
DEPLOYED_AT=$(    jq -r .deployed_at     "$DEPLOY_FILE")
GIT_SHA=$(        jq -r .git_sha         "$DEPLOY_FILE")

info "Target rollback version : $TARGET_VERSION"
info "Original contract ID    : $OLD_CONTRACT_ID"
info "Original WASM hash      : $WASM_HASH"
info "Originally deployed at  : $DEPLOYED_AT (git $GIT_SHA)"
echo

# ── confirmation ─────────────────────────────────────────────────────────────
warn "⚠️  This will deploy a NEW mainnet contract from the $TARGET_VERSION WASM."
warn "    The current contract will NOT be deactivated automatically."
warn "    You must update NEXT_PUBLIC_CONTRACT_ADDRESS after this script completes."
echo
read -rp "Type the version to confirm rollback: " CONFIRM
[[ "$CONFIRM" == "$TARGET_VERSION" ]] || error "Confirmation mismatch — aborting."

# ── fetch WASM from GitHub release or local artifact ─────────────────────────
WASM_PATH="wasm_rollback/predinex.optimized.wasm"
mkdir -p wasm_rollback

if [[ -f "deployments/${TARGET_VERSION}.wasm" ]]; then
  cp "deployments/${TARGET_VERSION}.wasm" "$WASM_PATH"
else
  info "Downloading WASM from GitHub release $TARGET_VERSION …"
  REPO="${GITHUB_REPOSITORY:-dimka90/predinex-stellar}"
  curl -sSL \
    "https://github.com/${REPO}/releases/download/${TARGET_VERSION}/predinex.optimized.wasm" \
    -o "$WASM_PATH" || error "Could not download WASM for $TARGET_VERSION from GitHub releases."
fi

# ── verify WASM hash ─────────────────────────────────────────────────────────
ACTUAL_HASH=$(sha256sum "$WASM_PATH" | awk '{print $1}')
if [[ "$ACTUAL_HASH" != "$WASM_HASH" ]]; then
  error "WASM hash mismatch!\n  expected: $WASM_HASH\n  actual:   $ACTUAL_HASH\nAborting — do not deploy an unverified binary."
fi
info "WASM hash verified ✓"

# ── import deployer key ──────────────────────────────────────────────────────
stellar keys add deployer --secret-key "$MAINNET_DEPLOYER_SECRET" --quiet 2>/dev/null || true

# ── deploy ───────────────────────────────────────────────────────────────────
info "Deploying $TARGET_VERSION WASM to mainnet …"
NEW_CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --network mainnet \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  --source deployer \
  --fee 1000000)

info "New contract ID: $NEW_CONTRACT_ID"

# ── initialize ───────────────────────────────────────────────────────────────
info "Initializing contract …"
stellar contract invoke \
  --id "$NEW_CONTRACT_ID" \
  --network mainnet \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  --source deployer \
  --fee 100000 \
  -- initialize \
  --token "$MAINNET_XLM_SAC" \
  --treasury_recipient "$MAINNET_TREASURY_ADDRESS"

# ── save rollback record ─────────────────────────────────────────────────────
ROLLBACK_FILE="deployments/rollback-${TARGET_VERSION}-$(date -u +%Y%m%dT%H%M%S).json"
cat > "$ROLLBACK_FILE" <<EOF
{
  "type": "rollback",
  "rollback_to_version": "$TARGET_VERSION",
  "new_contract_id": "$NEW_CONTRACT_ID",
  "wasm_hash": "$WASM_HASH",
  "original_contract_id": "$OLD_CONTRACT_ID",
  "rolled_back_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "rolled_back_by": "$(git config user.email 2>/dev/null || echo unknown)"
}
EOF

info "Rollback record saved: $ROLLBACK_FILE"

# ── next steps ───────────────────────────────────────────────────────────────
echo
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ROLLBACK COMPLETE — manual steps required:${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo "  1. Update NEXT_PUBLIC_CONTRACT_ADDRESS to:"
echo "       $NEW_CONTRACT_ID"
echo "  2. Redeploy the web app (or update your env and restart)."
echo "  3. Commit $ROLLBACK_FILE to the repository."
echo "  4. Notify the team and post-mortem the incident."
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"

# cleanup
rm -rf wasm_rollback
