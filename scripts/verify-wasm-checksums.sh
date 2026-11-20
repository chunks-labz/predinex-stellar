#!/bin/bash
#
# WASM Artifact Checksum Verification
# Issue #1608: Pin wasm artifacts and verify checksums
#
# This script manages and verifies SHA256 checksums for compiled WASM artifacts
# to ensure deployment doesn't silently use changed contract binaries.
#
# Usage:
#   ./scripts/verify-wasm-checksums.sh [COMMAND] [OPTIONS]
#
# Commands:
#   generate    Generate checksums for current WASM artifacts
#   verify      Verify checksums against compiled WASM
#   check       Quick verification without generation
#
# Examples:
#   ./scripts/verify-wasm-checksums.sh generate
#   ./scripts/verify-wasm-checksums.sh verify
#   ./scripts/verify-wasm-checksums.sh check

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
CONTRACT_DIR="${CONTRACT_DIR:-$REPO_ROOT/contracts/predinex}"
BUILD_DIR="${BUILD_DIR:-$CONTRACT_DIR/target/wasm32-unknown-unknown/release}"
CHECKSUMS_FILE="${CHECKSUMS_FILE:-$REPO_ROOT/.wasm-checksums}"
VERBOSE=false

usage() {
    cat << EOF
${BOLD}WASM Artifact Checksum Verifier v${VERSION}${NC}

${BOLD}USAGE:${NC}
    $0 [COMMAND] [OPTIONS]

${BOLD}COMMANDS:${NC}
    generate                Generate and commit checksums for WASM artifacts
    verify                  Verify current WASM matches committed checksums
    check                   Quick check of checksums (read-only)
    list                    List all tracked checksums

${BOLD}OPTIONS:${NC}
    -c, --contract <dir>    Contract directory (default: ./contracts/predinex)
    -b, --build <dir>       Build directory (default: <contract>/target/...)
    -f, --checksums <file>  Checksums file (default: .wasm-checksums)
    -v, --verbose           Verbose output
    -h, --help              Show this help

${BOLD}EXAMPLES:${NC}
    # Generate checksums (run after building)
    $0 generate

    # Verify checksums before deployment
    $0 verify

    # Quick check
    $0 check

    # List tracked artifacts
    $0 list

EOF
    exit 0
}

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }
log_verbose() { [ "$VERBOSE" = true ] && echo -e "${BLUE}→${NC} $1" || true; }

# Find all WASM artifacts
find_wasm_artifacts() {
    log_verbose "Scanning for WASM artifacts in $BUILD_DIR"

    if [ ! -d "$BUILD_DIR" ]; then
        log_error "Build directory not found: $BUILD_DIR"
        return 1
    fi

    find "$BUILD_DIR" -maxdepth 1 -name "*.wasm" -type f | sort || true
}

# Calculate SHA256 checksum for a file
calculate_checksum() {
    local file=$1

    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        return 1
    fi

    if command -v sha256sum &> /dev/null; then
        sha256sum "$file" | awk '{print $1}'
    else
        # macOS uses shasum
        shasum -a 256 "$file" | awk '{print $1}'
    fi
}

# Generate checksums for all WASM artifacts
generate_checksums() {
    log_header "Generating WASM Checksums"

    local wasm_files
    wasm_files=$(find_wasm_artifacts) || return 1

    if [ -z "$wasm_files" ]; then
        log_error "No WASM artifacts found in $BUILD_DIR"
        return 1
    fi

    log_info "Found WASM artifacts:"

    # Backup existing checksums
    if [ -f "$CHECKSUMS_FILE" ]; then
        cp "$CHECKSUMS_FILE" "${CHECKSUMS_FILE}.bak"
        log_verbose "Backed up existing checksums to ${CHECKSUMS_FILE}.bak"
    fi

    # Generate new checksums
    > "$CHECKSUMS_FILE"

    local count=0
    while IFS= read -r wasm_file; do
        if [ -z "$wasm_file" ]; then
            continue
        fi

        local filename
        filename=$(basename "$wasm_file")

        local checksum
        checksum=$(calculate_checksum "$wasm_file") || return 1

        echo "$checksum  $filename" >> "$CHECKSUMS_FILE"
        log_success "[$filename] $checksum"
        ((count++))
    done <<< "$wasm_files"

    log_header "Checksum Generation Summary"
    echo "Total artifacts: $count"
    echo "Checksums file: $CHECKSUMS_FILE"

    log_warning "Commit these checksums to version control:"
    echo "  git add .wasm-checksums"
    echo "  git commit -m 'chore: pin wasm checksums'"

    return 0
}

# Verify checksums match current artifacts
verify_checksums() {
    log_header "Verifying WASM Checksums"

    if [ ! -f "$CHECKSUMS_FILE" ]; then
        log_error "Checksums file not found: $CHECKSUMS_FILE"
        log_info "Run 'generate' command first to create it"
        return 1
    fi

    log_verbose "Checksums file: $CHECKSUMS_FILE"

    local total=0
    local passed=0
    local failed=0
    local missing=0

    while IFS= read -r checksum filename; do
        # Skip empty lines and comments
        [ -z "$checksum" ] && continue
        [[ "$checksum" =~ ^# ]] && continue

        ((total++))

        local wasm_file="$BUILD_DIR/$filename"

        if [ ! -f "$wasm_file" ]; then
            log_error "[$filename] MISSING"
            ((missing++))
            continue
        fi

        local current_checksum
        current_checksum=$(calculate_checksum "$wasm_file") || return 1

        if [ "$checksum" = "$current_checksum" ]; then
            log_success "[$filename] OK"
            ((passed++))
        else
            log_error "[$filename] CHECKSUM MISMATCH"
            log_error "  Expected: $checksum"
            log_error "  Got:      $current_checksum"
            ((failed++))
        fi
    done < "$CHECKSUMS_FILE"

    log_header "Verification Summary"
    echo "Total artifacts: $total"
    echo "Verified: $passed"
    echo "Mismatched: $failed"
    echo "Missing: $missing"

    if [ $failed -eq 0 ] && [ $missing -eq 0 ]; then
        log_success "All checksums verified!"
        return 0
    else
        log_error "Checksum verification failed!"
        log_warning "Do not deploy until checksums match. This may indicate:"
        log_warning "  - Contract source changed without rebuild"
        log_warning "  - Build output was corrupted"
        log_warning "  - Wrong build directory"
        return 1
    fi
}

# List tracked checksums
list_checksums() {
    if [ ! -f "$CHECKSUMS_FILE" ]; then
        log_error "Checksums file not found: $CHECKSUMS_FILE"
        return 1
    fi

    log_header "Tracked WASM Artifacts"

    while IFS= read -r checksum filename; do
        [ -z "$checksum" ] && continue
        [[ "$checksum" =~ ^# ]] && continue

        local size=""
        local wasm_file="$BUILD_DIR/$filename"
        if [ -f "$wasm_file" ]; then
            size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file" 2>/dev/null)
            size=" (${size} bytes)"
        fi

        printf "%s\n" "$filename"
        printf "  SHA256: %s%s\n" "$checksum" "$size"
    done < "$CHECKSUMS_FILE"
}

# Parse arguments
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -c|--contract)
            CONTRACT_DIR="$2"
            BUILD_DIR="$CONTRACT_DIR/target/wasm32-unknown-unknown/release"
            shift 2
            ;;
        -b|--build)
            BUILD_DIR="$2"
            shift 2
            ;;
        -f|--checksums)
            CHECKSUMS_FILE="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        generate|verify|check|list)
            COMMAND=$1
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Ensure repo root is set
if [ ! -f "$REPO_ROOT/Cargo.toml" ]; then
    log_error "Not in repo root or Cargo.toml not found"
    exit 1
fi

# Execute command
case "$COMMAND" in
    generate)
        generate_checksums
        ;;
    verify)
        verify_checksums
        ;;
    check)
        # Alias for verify with no generation prompts
        verify_checksums
        ;;
    list)
        list_checksums
        ;;
    *)
        log_error "No command specified"
        usage
        ;;
esac
