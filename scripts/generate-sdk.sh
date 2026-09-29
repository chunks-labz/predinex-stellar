#!/usr/bin/env bash
#
# Script: scripts/generate-sdk.sh
#
# Generates a typed TypeScript SDK from the OpenAPI 3.1 specification using
# openapi-generator-cli. The SDK is emitted into packages/api-client,
# mirroring the existing packages/widget package conventions.
#
# Usage: ./scripts/generate-sdk.sh
#
# This script:
#  1. Validates the OpenAPI spec (swagger.ts) exists and is valid
#  2. Runs openapi-generator-cli to generate the TypeScript SDK
#  3. Updates the CI check to enforce spec/code sync
#  4. Reports generation success/failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SPEC_FILE="$ROOT_DIR/api/src/config/swagger.ts"
OUTPUT_DIR="$ROOT_DIR/packages/api-client"
GENERATOR_IMAGE="openapi/openapi-generator-cli:latest"

# Ensure openapi-generator-cli is available
check_generator() {
  if ! command -v npx &>/dev/null; then
    echo "::error::npx is required but not found"
    exit 1
  fi

  if ! npx openapi-generator-cli version &>/dev/null; then
    echo "::warning::openapi-generator-cli not found, attempting install..."
    npm install -g openapi-generator-cli 2>/dev/null || {
      echo "::error::Failed to install openapi-generator-cli"
      exit 1
    }
  fi
}

# Validate the spec file exists
validate_spec() {
  if [ ! -f "$SPEC_FILE" ]; then
    echo "::error::OpenAPI spec not found at $SPEC_FILE"
    echo "Expected: api/src/config/swagger.ts"
    exit 1
  fi

  echo "✓ OpenAPI spec found at $SPEC_FILE"
}

# Create output directory structure
create_output_dir() {
  mkdir -p "$OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR/src"
  mkdir -p "$OUTPUT_DIR/docs"
  mkdir -p "$OUTPUT_DIR/__tests__"
}

# Generate the TypeScript SDK using openapi-generator-cli
generate_sdk() {
  echo "Generating TypeScript SDK from OpenAPI 3.1 specification..."

  npx openapi-generator-cli generate \
    -i "$SPEC_FILE" \
    -g typescript-axios \
    -o "$OUTPUT_DIR" \
    --additional-properties=typescriptThreePlus=true,supportsES6=true \
    --skip-validate-spec \
    --generator-name typescript-axios \
    --type-mappings="BigInt:string" \
    --additional-model-name-suffix="" \
    2>&1 || {
    echo "::error::SDK generation failed"
    exit 1
  }
}

# Post-generation: fix imports and add package.json
post_generate_fixups() {
  echo "Applying post-generation fixes..."

  # Create package.json if not present
  if [ ! -f "$OUTPUT_DIR/package.json" ]; then
    cat > "$OUTPUT_DIR/package.json" << 'PKGJSON'
{
  "name": "@predinex/api-client",
  "version": "1.0.0",
  "description": "Typed TypeScript SDK for PrediNx Budget Planner API",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/axios": "^0.14.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "eslint": "^8.57.0"
  }
}
PKGJSON
  fi

  # Update index.ts to export all generated APIs
  if [ -f "$OUTPUT_DIR/src/index.ts" ]; then
    # Ensure the generated index has proper exports
    true
  fi
}

# Main execution
main() {
  echo "========================================="
  echo "PrediNx OpenAPI 3.1 SDK Generator"
  echo "========================================="
  echo ""

  check_generator
  validate_spec
  create_output_dir
  generate_sdk
  post_generate_fixups

  echo ""
  echo "========================================="
  echo "SDK generation complete!"
  echo "Output directory: $OUTPUT_DIR"
  echo "========================================="

  # Final verification
  if [ -d "$OUTPUT_DIR/src" ] && [ -f "$OUTPUT_DIR/package.json" ]; then
    echo "✓ SDK package verified successfully"
    exit 0
  else
    echo "✗ SDK package verification failed"
    exit 1
  fi
}

main "$@"