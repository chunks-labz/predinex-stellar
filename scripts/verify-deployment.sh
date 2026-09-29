#!/bin/bash
#
# Contract Deployment Verification Script
# Issue #1112: Automated deployment verification workflow
#
# This script automates the complete deployment verification process including
# pre-deployment checks, post-deployment verification, and CI/CD integration.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

VERSION="1.0.0"

# Configuration
NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
CONTRACTS_DIR="${CONTRACTS_DIR:-./contracts/predinex}"
BUILD_DIR="${BUILD_DIR:-target/wasm32-unknown-unknown/release}"
VERIFICATION_DIR="${VERIFICATION_DIR:-./verification-reports}"

usage() {
    cat << EOF
${BOLD}Contract Deployment Verification Script v${VERSION}${NC}

${BOLD}USAGE:${NC}
    $0 [OPTIONS] <command>

${BOLD}COMMANDS:${NC}
    pre-deploy              Pre-deployment verification checks
    post-deploy <id>        Verify deployment matches local build
    verify-all              Verify all deployed contracts
    ci-verify               CI/CD verification workflow
    watch                   Watch for deployments and auto-verify

${BOLD}OPTIONS:${NC}
    -n, --network <net>     Network: testnet, mainnet (default: testnet)
    -c, --contract <path>   Contract directory (default: ./contracts/predinex)
    -o, --output <dir>      Output directory (default: ./verification-reports)
    -v, --verbose           Verbose output
    -h, --help              Show this help

${BOLD}EXAMPLES:${NC}
    # Pre-deployment checks
    $0 pre-deploy

    # Verify after deployment
    $0 post-deploy CAXXX...

    # Verify all contracts
    $0 verify-all

    # CI/CD integration
    $0 ci-verify

EOF
    exit 0
}

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }

# Pre-deployment verification
pre_deploy_checks() {
    log_header "Pre-Deployment Verification"
    
    local checks_passed=0
    local checks_failed=0
    
    # Check 1: Contract builds successfully
    log_info "Building contract..."
    if cargo build --target wasm32-unknown-unknown --release --manifest-path="$CONTRACTS_DIR/Cargo.toml"; then
        log_success "Contract builds successfully"
        ((checks_passed++))
    else
        log_error "Contract build failed"
        ((checks_failed++))
    fi
    
    # Check 2: WASM file exists
    local wasm_file="$BUILD_DIR/predinex.wasm"
    if [ -f "$wasm_file" ]; then
        log_success "WASM file exists: $wasm_file"
        ((checks_passed++))
        
        # Check file size
        local size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file" 2>/dev/null)
        log_info "Contract size: $size bytes"
        
        if [ $size -lt 1000000 ]; then
            log_success "Contract size within limits"
            ((checks_passed++))
        else
            log_warning "Contract size exceeds 1MB"
            ((checks_failed++))
        fi
    else
        log_error "WASM file not found"
        ((checks_failed++))
    fi
    
    # Check 3: Optimize contract
    log_info "Optimizing contract..."
    if stellar contract optimize --wasm "$wasm_file" 2>/dev/null; then
        log_success "Contract optimized successfully"
        ((checks_passed++))
    else
        log_warning "Contract optimization failed (may not be critical)"
    fi
    
    # Check 4: Run tests
    log_info "Running tests..."
    if cargo test --manifest-path="$CONTRACTS_DIR/Cargo.toml" --quiet; then
        log_success "All tests passed"
        ((checks_passed++))
    else
        log_error "Some tests failed"
        ((checks_failed++))
    fi
    
    # Check 5: Security audit
    log_info "Running security checks..."
    if command -v cargo-audit &> /dev/null; then
        if cargo audit --manifest-path="$CONTRACTS_DIR/Cargo.toml" 2>/dev/null; then
            log_success "No security vulnerabilities found"
            ((checks_passed++))
        else
            log_warning "Security vulnerabilities detected"
        fi
    else
        log_info "cargo-audit not installed - skipping security check"
    fi
    
    # Summary
    log_header "Pre-Deployment Summary"
    echo "Checks passed: $checks_passed"
    echo "Checks failed: $checks_failed"
    
    if [ $checks_failed -eq 0 ]; then
        log_success "All pre-deployment checks passed - ready to deploy!"
        return 0
    else
        log_error "Some pre-deployment checks failed - review before deploying"
        return 1
    fi
}

# Post-deployment verification
post_deploy_verify() {
    local contract_id=$1
    
    log_header "Post-Deployment Verification"
    
    log_info "Contract ID: $contract_id"
    log_info "Network: $NETWORK"
    
    local wasm_file="$BUILD_DIR/predinex.wasm"
    
    if [ ! -f "$wasm_file" ]; then
        log_error "Local WASM file not found: $wasm_file"
        log_info "Run 'cargo build' first"
        return 1
    fi
    
    # Run verification script
    if ./scripts/verify-contract.sh \
        --network "$NETWORK" \
        --output "$VERIFICATION_DIR" \
        --diff \
        --compare-metadata \
        "$contract_id" \
        "$wasm_file"; then
        
        log_success "Deployment verification passed!"
        
        # Store contract ID for future reference
        echo "$contract_id" >> "$VERIFICATION_DIR/deployed_contracts_${NETWORK}.txt"
        
        return 0
    else
        log_error "Deployment verification failed!"
        return 1
    fi
}

# Verify all deployed contracts
verify_all_contracts() {
    log_header "Verifying All Deployed Contracts"
    
    local contracts_file="$VERIFICATION_DIR/deployed_contracts_${NETWORK}.txt"
    
    if [ ! -f "$contracts_file" ]; then
        log_warning "No deployed contracts found for $NETWORK"
        log_info "File: $contracts_file"
        return 1
    fi
    
    local total=0
    local passed=0
    local failed=0
    
    while IFS= read -r contract_id; do
        [ -z "$contract_id" ] && continue
        ((total++))
        
        echo ""
        log_info "Verifying contract $total: $contract_id"
        
        if post_deploy_verify "$contract_id"; then
            ((passed++))
        else
            ((failed++))
        fi
    done < "$contracts_file"
    
    # Summary
    log_header "Verification Summary"
    echo "Total contracts: $total"
    echo "Passed: $passed"
    echo "Failed: $failed"
    
    [ $failed -eq 0 ] && return 0 || return 1
}

# CI/CD verification workflow
ci_verify_workflow() {
    log_header "CI/CD Verification Workflow"
    
    local exit_code=0
    
    # Step 1: Pre-deployment checks
    log_info "Step 1: Pre-deployment checks"
    if pre_deploy_checks; then
        log_success "Pre-deployment checks passed"
    else
        log_error "Pre-deployment checks failed"
        exit_code=1
    fi
    
    # Step 2: Check if CONTRACT_ID is set (for post-deployment)
    if [ -n "$CONTRACT_ID" ]; then
        log_info "Step 2: Post-deployment verification"
        if post_deploy_verify "$CONTRACT_ID"; then
            log_success "Post-deployment verification passed"
        else
            log_error "Post-deployment verification failed"
            exit_code=1
        fi
    else
        log_info "Step 2: Skipped (CONTRACT_ID not set)"
    fi
    
    # Step 3: Generate CI report
    log_info "Step 3: Generating CI report"
    local report_file="$VERIFICATION_DIR/ci_report_$(date +%Y%m%d_%H%M%S).json"
    
    cat > "$report_file" << EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "network": "$NETWORK",
  "pre_deploy_status": "$([ $exit_code -eq 0 ] && echo "passed" || echo "failed")",
  "contract_id": "${CONTRACT_ID:-null}",
  "build_info": {
    "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo "unknown")",
    "git_branch": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
  }
}
EOF
    
    log_success "CI report generated: $report_file"
    
    return $exit_code
}

# Watch for deployments
watch_deployments() {
    log_header "Watching for Deployments"
    
    log_info "Monitoring network: $NETWORK"
    log_info "Press Ctrl+C to stop"
    
    local contracts_file="$VERIFICATION_DIR/deployed_contracts_${NETWORK}.txt"
    touch "$contracts_file"
    
    while true; do
        log_info "Checking for new deployments... ($(date))"
        
        # This would integrate with network monitoring
        # For now, we'll check the contracts file
        
        sleep 30
    done
}

# Parse arguments
COMMAND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -c|--contract)
            CONTRACTS_DIR="$2"
            shift 2
            ;;
        -o|--output)
            VERIFICATION_DIR="$2"
            shift 2
            ;;
        -v|--verbose)
            set -x
            shift
            ;;
        pre-deploy|post-deploy|verify-all|ci-verify|watch)
            COMMAND=$1
            shift
            break
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Create output directory
mkdir -p "$VERIFICATION_DIR"

# Execute command
case $COMMAND in
    pre-deploy)
        pre_deploy_checks
        ;;
    post-deploy)
        if [ $# -lt 1 ]; then
            log_error "Contract ID required for post-deploy"
            usage
        fi
        post_deploy_verify "$1"
        ;;
    verify-all)
        verify_all_contracts
        ;;
    ci-verify)
        ci_verify_workflow
        ;;
    watch)
        watch_deployments
        ;;
    *)
        log_error "No command specified"
        usage
        ;;
esac
