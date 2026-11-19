#!/bin/bash
#
# Generated Binding Drift Check
# Issue #1605: Add generated-binding drift check to CI
#
# This script regenerates TypeScript bindings and detects when they diverge
# from committed versions, preventing stale bindings from being merged.
#
# Usage:
#   ./scripts/check-binding-drift.sh [OPTIONS]
#
# Examples:
#   ./scripts/check-binding-drift.sh
#   ./scripts/check-binding-drift.sh --fix
#   ./scripts/check-binding-drift.sh --verbose

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

VERSION="1.0.0"

# Configuration
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX_MODE=false
VERBOSE=false

usage() {
    cat << EOF
${BOLD}Generated Binding Drift Checker v${VERSION}${NC}

Detects stale TypeScript bindings by regenerating them and checking for
divergence from committed versions. Fails if bindings need regeneration.

${BOLD}USAGE:${NC}
    $0 [OPTIONS]

${BOLD}OPTIONS:${NC}
    --fix               Auto-fix by regenerating bindings
    -v, --verbose       Verbose output
    -h, --help          Show this help

${BOLD}EXIT CODES:${NC}
    0   Bindings are up-to-date
    1   Bindings are stale (need regeneration)
    2   Error during check

${BOLD}EXAMPLES:${NC}
    # Check for drift (CI mode)
    $0

    # Auto-fix drift (local development)
    $0 --fix

    # Verbose output for debugging
    $0 --verbose

${BOLD}CI INTEGRATION:${NC}
    Add to your CI workflow:

    - name: Check binding drift
      run: ./scripts/check-binding-drift.sh

    If this fails in CI, run locally and commit changes:
      ./scripts/check-binding-drift.sh --fix
      git add <generated-files>
      git commit -m "chore: regenerate bindings"

EOF
    exit 0
}

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }
log_verbose() { [ "$VERBOSE" = true ] && echo -e "${BLUE}→${NC} $1" || true; }

# Find binding generation scripts
find_binding_scripts() {
    log_verbose "Looking for binding generation scripts..."

    if [ -f "$REPO_ROOT/scripts/generate-sdk.sh" ]; then
        log_verbose "Found generate-sdk.sh"
        echo "generate-sdk"
    fi

    # Look for TypeScript/JavaScript binding generators
    if [ -f "$REPO_ROOT/package.json" ]; then
        log_verbose "Checking package.json for binding scripts"
        if grep -q '"generate"' "$REPO_ROOT/package.json" 2>/dev/null; then
            echo "npm-generate"
        fi
    fi
}

# Regenerate TypeScript bindings
regenerate_bindings() {
    log_header "Regenerating TypeScript Bindings"

    local scripts
    scripts=$(find_binding_scripts) || true

    if [ -z "$scripts" ]; then
        log_warning "No binding generation scripts found"
        return 0
    fi

    while IFS= read -r script; do
        [ -z "$script" ] && continue

        case "$script" in
            generate-sdk)
                log_info "Running generate-sdk.sh..."
                if bash "$REPO_ROOT/scripts/generate-sdk.sh"; then
                    log_success "SDK generation completed"
                else
                    log_error "SDK generation failed"
                    return 2
                fi
                ;;
            npm-generate)
                log_info "Running npm run generate..."
                if npm run generate --prefix "$REPO_ROOT" 2>/dev/null; then
                    log_success "npm generate completed"
                else
                    log_warning "npm generate not configured"
                fi
                ;;
        esac
    done <<< "$scripts"

    return 0
}

# Check for uncommitted changes in binding files
check_binding_changes() {
    log_header "Checking for Binding Changes"

    # Get list of common generated binding paths
    local binding_patterns=(
        "web/src/generated"
        "api/src/generated"
        "packages/*/src/generated"
        "**/generated/**/*.ts"
        "**/.generated/**"
    )

    # Check git status for generated files
    local changes=false

    for pattern in "${binding_patterns[@]}"; do
        # Expand pattern
        for dir in $REPO_ROOT/$pattern 2>/dev/null; do
            [ -d "$dir" ] || continue

            log_verbose "Checking $dir for changes..."

            # Check if any generated files have changed
            if git -C "$REPO_ROOT" diff --quiet --name-only -- "$dir" 2>/dev/null | grep -q .; then
                log_error "Binding changes detected in $dir"
                changes=true
            fi
        done
    done

    # Also check if git status shows modified files in common locations
    local modified
    modified=$(git -C "$REPO_ROOT" status --porcelain | grep -E "(generated|\.generated)" || true)

    if [ -n "$modified" ]; then
        log_error "Uncommitted binding changes detected:"
        echo "$modified" | while read -r line; do
            log_error "  $line"
        done
        changes=true
    fi

    return $([ "$changes" = true ] && echo 1 || echo 0)
}

# Main check flow
check_drift() {
    log_header "Binding Drift Check"

    log_info "Regenerating bindings to detect drift..."

    if ! regenerate_bindings; then
        log_error "Binding regeneration failed"
        return 2
    fi

    log_info "Checking for changes..."

    if check_binding_changes; then
        log_success "Bindings are up-to-date"
        return 0
    else
        log_error "Bindings are out of sync with source"

        if [ "$FIX_MODE" = true ]; then
            log_info "Fix mode enabled - changes will be regenerated"
            return 0
        else
            log_error "Run with --fix to auto-regenerate, or regenerate locally:"
            log_error "  ./scripts/generate-sdk.sh"
            log_error "  git add <binding-files>"
            log_error "  git commit -m 'chore: regenerate bindings'"
            return 1
        fi
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        --fix)
            FIX_MODE=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Run the check
check_drift
