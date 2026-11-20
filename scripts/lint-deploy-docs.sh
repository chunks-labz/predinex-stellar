#!/usr/bin/env bash
set -euo pipefail

DOCS_FILE="docs/deployment.md"

if [ ! -f "$DOCS_FILE" ]; then
    echo "Error: $DOCS_FILE not found."
    exit 1
fi

echo "Linting $DOCS_FILE..."

# Check for cargo build where it should be stellar contract build
if grep -q "cargo build --target wasm32-unknown-unknown" "$DOCS_FILE"; then
    echo "Error: $DOCS_FILE uses 'cargo build'. Use 'stellar contract build' to match workflows."
    exit 1
fi

# Ensure necessary steps are documented
REQUIRED_COMMANDS=(
    "stellar contract build"
    "stellar contract optimize"
    "stellar contract deploy"
    "stellar contract invoke"
    "initialize"
)

for cmd in "${REQUIRED_COMMANDS[@]}"; do
    if ! grep -q "$cmd" "$DOCS_FILE"; then
        echo "Error: $DOCS_FILE is missing required command '$cmd'."
        exit 1
    fi
done

echo "$DOCS_FILE lint passed!"
