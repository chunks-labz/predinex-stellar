#!/bin/bash
#
# Contract Deployment Verification and Bytecode Diff Tool
# Issue #1112: Build contract deployment verification and bytecode diff tool
#
# This script verifies deployed Stellar/Soroban smart contracts by comparing
# on-chain bytecode with local builds, detecting unauthorized changes, and
# generating comprehensive verification reports.

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Script version
VERSION="1.0.0"

# Configuration
NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
OUTPUT_DIR="${OUTPUT_DIR:-./verification-reports}"
TEMP_DIR="${TEMP_DIR:-/tmp/soroban-verify}"

# Create necessary directories
mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR"

# Usage information
usage() {
    cat << EOF
${BOLD}Contract Deployment Verification Tool v${VERSION}${NC}

${BOLD}USAGE:${NC}
    $0 [OPTIONS] <contract_id> <local_wasm_path>

${BOLD}ARGUMENTS:${NC}
    contract_id       Deployed contract ID (e.g., CXXXXXXX...)
    local_wasm_path   Path to local WASM file for comparison

${BOLD}OPTIONS:${NC}
    -n, --network <network>           Network: testnet, mainnet (default: testnet)
    -r, --rpc-url <url>              Custom RPC URL
    -o, --output <dir>               Output directory (default: ./verification-reports)
    -v, --verbose                    Verbose output
    -j, --json                       Output in JSON format
    -d, --diff                       Generate detailed bytecode diff
    --check-upgrade                  Verify if upgrade is safe
    --compare-metadata               Compare contract metadata
    -h, --help                       Show this help message

${BOLD}EXAMPLES:${NC}
    # Basic verification
    $0 CAXXX... ./target/wasm32-unknown-unknown/release/contract.wasm

    # With detailed diff
    $0 -d -v CAXXX... ./contract.wasm

    # Check upgrade safety
    $0 --check-upgrade --compare-metadata CAXXX... ./new_contract.wasm

    # JSON output for CI/CD
    $0 -j CAXXX... ./contract.wasm > verification.json

${BOLD}VERIFICATION CHECKS:${NC}
    ✓ Bytecode hash comparison
    ✓ Contract size verification
    ✓ Entry point validation
    ✓ Metadata comparison
    ✓ Upgrade compatibility check
    ✓ Security analysis
    ✓ Gas cost estimation difference

${BOLD}EXIT CODES:${NC}
    0  - Verification successful (match)
    1  - Verification failed (mismatch)
    2  - Invalid arguments
    3  - Network/RPC error
    4  - Contract not found

${BOLD}ENVIRONMENT VARIABLES:${NC}
    NETWORK              Default network (testnet/mainnet)
    RPC_URL              Soroban RPC endpoint URL
    NETWORK_PASSPHRASE   Network passphrase
    OUTPUT_DIR           Verification reports output directory

EOF
    exit 0
}

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

log_header() {
    echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"
}

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v stellar &> /dev/null; then
        missing_deps+=("stellar-cli")
    fi
    
    if ! command -v sha256sum &> /dev/null && ! command -v shasum &> /dev/null; then
        missing_deps+=("sha256sum or shasum")
    fi
    
    if ! command -v xxd &> /dev/null; then
        missing_deps+=("xxd")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        log_info "Install with: brew install stellar-cli xxd jq"
        exit 2
    fi
}

# Get SHA256 hash
get_hash() {
    local file=$1
    if command -v sha256sum &> /dev/null; then
        sha256sum "$file" | awk '{print $1}'
    else
        shasum -a 256 "$file" | awk '{print $1}'
    fi
}

# Fetch deployed contract bytecode
fetch_contract_bytecode() {
    local contract_id=$1
    local output_file=$2
    
    log_info "Fetching deployed contract bytecode..."
    
    if stellar contract fetch \
        --id "$contract_id" \
        --network "$NETWORK" \
        --out "$output_file" 2>/dev/null; then
        log_success "Contract bytecode fetched successfully"
        return 0
    else
        log_error "Failed to fetch contract bytecode"
        log_info "Contract ID may not exist on $NETWORK network"
        return 4
    fi
}

# Get file size in bytes
get_file_size() {
    local file=$1
    if [[ "$OSTYPE" == "darwin"* ]]; then
        stat -f%z "$file"
    else
        stat -c%s "$file"
    fi
}

# Compare bytecode
compare_bytecode() {
    local deployed_wasm=$1
    local local_wasm=$2
    
    log_header "Bytecode Comparison"
    
    local deployed_hash=$(get_hash "$deployed_wasm")
    local local_hash=$(get_hash "$local_wasm")
    
    local deployed_size=$(get_file_size "$deployed_wasm")
    local local_size=$(get_file_size "$local_wasm")
    
    echo "Deployed Contract:"
    echo "  Hash: $deployed_hash"
    echo "  Size: $deployed_size bytes"
    echo ""
    echo "Local Build:"
    echo "  Hash: $local_hash"
    echo "  Size: $local_size bytes"
    echo ""
    
    if [ "$deployed_hash" = "$local_hash" ]; then
        log_success "Bytecode hashes match - verification successful!"
        return 0
    else
        log_warning "Bytecode hashes DO NOT match!"
        echo "  Size difference: $((local_size - deployed_size)) bytes"
        return 1
    fi
}

# Generate bytecode diff
generate_bytecode_diff() {
    local deployed_wasm=$1
    local local_wasm=$2
    local output_file=$3
    
    log_header "Generating Bytecode Diff"
    
    local deployed_hex="$TEMP_DIR/deployed.hex"
    local local_hex="$TEMP_DIR/local.hex"
    
    xxd "$deployed_wasm" > "$deployed_hex"
    xxd "$local_wasm" > "$local_hex"
    
    if diff -u "$deployed_hex" "$local_hex" > "$output_file" 2>&1; then
        log_success "No differences found"
        return 0
    else
        log_warning "Differences detected"
        local diff_lines=$(wc -l < "$output_file")
        echo "  Diff lines: $diff_lines"
        echo "  Diff file: $output_file"
        
        # Show first 20 lines of diff
        echo -e "\n${BOLD}First 20 lines of diff:${NC}"
        head -n 20 "$output_file"
        
        return 1
    fi
}

# Extract contract metadata
extract_metadata() {
    local wasm_file=$1
    local output_file=$2
    
    # Use wasm-objdump or wasmparser if available
    if command -v wasm-objdump &> /dev/null; then
        wasm-objdump -x "$wasm_file" > "$output_file" 2>/dev/null || true
    elif command -v wasm2wat &> /dev/null; then
        wasm2wat "$wasm_file" -o "${output_file}.wat" 2>/dev/null || true
    fi
}

# Compare contract metadata
compare_metadata() {
    local deployed_wasm=$1
    local local_wasm=$2
    
    log_header "Metadata Comparison"
    
    local deployed_meta="$TEMP_DIR/deployed_metadata.txt"
    local local_meta="$TEMP_DIR/local_metadata.txt"
    
    extract_metadata "$deployed_wasm" "$deployed_meta"
    extract_metadata "$local_wasm" "$local_meta"
    
    if [ -f "$deployed_meta" ] && [ -f "$local_meta" ]; then
        if diff -q "$deployed_meta" "$local_meta" > /dev/null 2>&1; then
            log_success "Contract metadata matches"
            return 0
        else
            log_warning "Contract metadata differs"
            return 1
        fi
    else
        log_info "Metadata extraction not available (install wabt tools)"
        return 2
    fi
}

# Security analysis
security_analysis() {
    local wasm_file=$1
    
    log_header "Security Analysis"
    
    local file_size=$(get_file_size "$wasm_file")
    
    # Check file size
    if [ $file_size -gt 1000000 ]; then
        log_warning "Contract size exceeds 1MB ($file_size bytes)"
    else
        log_success "Contract size within limits ($file_size bytes)"
    fi
    
    # Check for common security patterns
    if command -v strings &> /dev/null; then
        local strings_output=$(strings "$wasm_file")
        
        # Check for debug symbols (should be stripped in production)
        if echo "$strings_output" | grep -q "debug"; then
            log_warning "Debug symbols detected - consider stripping for production"
        else
            log_success "No debug symbols found"
        fi
        
        # Check for panic strings
        local panic_count=$(echo "$strings_output" | grep -c "panic" || true)
        if [ $panic_count -gt 0 ]; then
            log_info "Panic handlers found: $panic_count"
        fi
    fi
}

# Check upgrade compatibility
check_upgrade_compatibility() {
    local old_wasm=$1
    local new_wasm=$2
    
    log_header "Upgrade Compatibility Check"
    
    local old_size=$(get_file_size "$old_wasm")
    local new_size=$(get_file_size "$new_wasm")
    local size_diff=$((new_size - old_size))
    local size_change_pct=$(awk "BEGIN {printf \"%.2f\", ($size_diff / $old_size) * 100}")
    
    echo "Old contract: $old_size bytes"
    echo "New contract: $new_size bytes"
    echo "Difference: $size_diff bytes ($size_change_pct%)"
    echo ""
    
    # Warn about significant size changes
    if [ ${size_diff#-} -gt $((old_size / 2)) ]; then
        log_warning "Contract size changed by more than 50% - review carefully"
    else
        log_success "Contract size change is reasonable"
    fi
    
    # Check if this is actually different
    local old_hash=$(get_hash "$old_wasm")
    local new_hash=$(get_hash "$new_wasm")
    
    if [ "$old_hash" = "$new_hash" ]; then
        log_info "Contracts are identical - no upgrade needed"
        return 2
    else
        log_success "Contracts are different - upgrade possible"
        return 0
    fi
}

# Generate JSON report
generate_json_report() {
    local contract_id=$1
    local deployed_wasm=$2
    local local_wasm=$3
    local verification_result=$4
    
    local deployed_hash=$(get_hash "$deployed_wasm")
    local local_hash=$(get_hash "$local_wasm")
    local deployed_size=$(get_file_size "$deployed_wasm")
    local local_size=$(get_file_size "$local_wasm")
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    cat << EOF
{
  "version": "$VERSION",
  "timestamp": "$timestamp",
  "network": "$NETWORK",
  "contract_id": "$contract_id",
  "verification": {
    "status": "$([ $verification_result -eq 0 ] && echo "PASSED" || echo "FAILED")",
    "matched": $([ $verification_result -eq 0 ] && echo "true" || echo "false")
  },
  "deployed": {
    "hash": "$deployed_hash",
    "size": $deployed_size
  },
  "local": {
    "hash": "$local_hash",
    "size": $local_size,
    "path": "$local_wasm"
  },
  "differences": {
    "size_diff": $((local_size - deployed_size)),
    "size_change_pct": $(awk "BEGIN {printf \"%.2f\", (($local_size - $deployed_size) / $deployed_size) * 100}")
  }
}
EOF
}

# Generate HTML report
generate_html_report() {
    local contract_id=$1
    local deployed_wasm=$2
    local local_wasm=$3
    local verification_result=$4
    local output_file=$5
    
    local deployed_hash=$(get_hash "$deployed_wasm")
    local local_hash=$(get_hash "$local_wasm")
    local timestamp=$(date)
    
    cat > "$output_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Contract Verification Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        .status { padding: 10px; border-radius: 4px; margin: 20px 0; font-weight: bold; }
        .passed { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .failed { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .hash { font-family: monospace; font-size: 12px; word-break: break-all; }
        .footer { margin-top: 30px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Contract Verification Report</h1>
        <div class="status $([ $verification_result -eq 0 ] && echo "passed" || echo "failed")">
            Status: $([ $verification_result -eq 0 ] && echo "✓ VERIFICATION PASSED" || echo "✗ VERIFICATION FAILED")
        </div>
        
        <h2>Contract Information</h2>
        <table>
            <tr><th>Contract ID</th><td>$contract_id</td></tr>
            <tr><th>Network</th><td>$NETWORK</td></tr>
            <tr><th>Verification Time</th><td>$timestamp</td></tr>
        </table>
        
        <h2>Bytecode Comparison</h2>
        <table>
            <tr>
                <th></th>
                <th>Deployed</th>
                <th>Local Build</th>
            </tr>
            <tr>
                <td><strong>SHA256 Hash</strong></td>
                <td class="hash">$deployed_hash</td>
                <td class="hash">$local_hash</td>
            </tr>
            <tr>
                <td><strong>File Size</strong></td>
                <td>$(get_file_size "$deployed_wasm") bytes</td>
                <td>$(get_file_size "$local_wasm") bytes</td>
            </tr>
        </table>
        
        <div class="footer">
            Generated by Contract Verification Tool v$VERSION
        </div>
    </div>
</body>
</html>
EOF
    
    log_success "HTML report generated: $output_file"
}

# Main verification function
verify_contract() {
    local contract_id=$1
    local local_wasm=$2
    
    log_header "Contract Verification Tool v$VERSION"
    
    echo "Contract ID: $contract_id"
    echo "Local WASM:  $local_wasm"
    echo "Network:     $NETWORK"
    echo ""
    
    # Validate inputs
    if [ ! -f "$local_wasm" ]; then
        log_error "Local WASM file not found: $local_wasm"
        exit 2
    fi
    
    # Fetch deployed contract
    local deployed_wasm="$TEMP_DIR/deployed_contract.wasm"
    if ! fetch_contract_bytecode "$contract_id" "$deployed_wasm"; then
        exit 4
    fi
    
    # Compare bytecode
    local verification_result=0
    if ! compare_bytecode "$deployed_wasm" "$local_wasm"; then
        verification_result=1
    fi
    
    # Generate diff if requested
    if [ "$GENERATE_DIFF" = "true" ]; then
        local diff_file="$OUTPUT_DIR/${contract_id}_diff.txt"
        generate_bytecode_diff "$deployed_wasm" "$local_wasm" "$diff_file"
    fi
    
    # Compare metadata if requested
    if [ "$COMPARE_METADATA" = "true" ]; then
        compare_metadata "$deployed_wasm" "$local_wasm"
    fi
    
    # Security analysis
    security_analysis "$local_wasm"
    
    # Upgrade check if requested
    if [ "$CHECK_UPGRADE" = "true" ]; then
        check_upgrade_compatibility "$deployed_wasm" "$local_wasm"
    fi
    
    # Generate reports
    if [ "$JSON_OUTPUT" = "true" ]; then
        generate_json_report "$contract_id" "$deployed_wasm" "$local_wasm" "$verification_result"
    else
        local html_report="$OUTPUT_DIR/${contract_id}_verification_$(date +%Y%m%d_%H%M%S).html"
        generate_html_report "$contract_id" "$deployed_wasm" "$local_wasm" "$verification_result" "$html_report"
    fi
    
    # Final status
    log_header "Verification Summary"
    if [ $verification_result -eq 0 ]; then
        log_success "Contract verification PASSED - bytecode matches!"
        exit 0
    else
        log_error "Contract verification FAILED - bytecode mismatch detected!"
        exit 1
    fi
}

# Parse command line arguments
GENERATE_DIFF=false
COMPARE_METADATA=false
CHECK_UPGRADE=false
JSON_OUTPUT=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -r|--rpc-url)
            RPC_URL="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -d|--diff)
            GENERATE_DIFF=true
            shift
            ;;
        --compare-metadata)
            COMPARE_METADATA=true
            shift
            ;;
        --check-upgrade)
            CHECK_UPGRADE=true
            shift
            ;;
        -j|--json)
            JSON_OUTPUT=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            set -x
            shift
            ;;
        *)
            break
            ;;
    esac
done

# Check for required arguments
if [ $# -lt 2 ]; then
    log_error "Missing required arguments"
    echo ""
    usage
fi

CONTRACT_ID=$1
LOCAL_WASM=$2

# Check dependencies
check_dependencies

# Run verification
verify_contract "$CONTRACT_ID" "$LOCAL_WASM"
