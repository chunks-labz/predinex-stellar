#!/usr/bin/env bash
#
# Seed demo markets and wagers into a locally deployed Predinex contract
# (Issue #1438). Thin wrapper around web/scripts/seed-demo-markets.mjs so the
# CLI can be run from the repository root:
#
#   ./scripts/seed-demo-markets.sh --contract-id C... --source-identity alice
#
# See `./scripts/seed-demo-markets.sh --help` for every option, and
# docs/local-runbook.md for the full local setup walkthrough.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

exec node "${ROOT_DIR}/web/scripts/seed-demo-markets.mjs" "$@"
