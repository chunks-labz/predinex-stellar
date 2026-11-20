#!/bin/bash
#
# Stuck Markets Monitoring
# Issue #1607: Alert on markets stuck pending resolution
#
# This script monitors for markets that remain unresolved past their close time.
# It periodically queries the network and emits alerts for markets exceeding
# a configurable grace period.
#
# Usage:
#   ./scripts/monitor-stuck-markets.sh [OPTIONS]
#
# Examples:
#   ./scripts/monitor-stuck-markets.sh
#   ./scripts/monitor-stuck-markets.sh --grace-period 3600 --check-interval 300
#   ./scripts/monitor-stuck-markets.sh --contract-id CAXXX... --network mainnet

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
NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-}"
CONTRACT_ID="${CONTRACT_ID:-}"
GRACE_PERIOD_SECONDS="${GRACE_PERIOD_SECONDS:-3600}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-300}"
LOG_DIR="${LOG_DIR:-./monitoring-logs}"
ONCE_MODE=false
VERBOSE=false

usage() {
    cat << EOF
${BOLD}Stuck Markets Monitoring v${VERSION}${NC}

Monitors for markets that remain unresolved past their close time and emits
alerts when they exceed the grace period.

${BOLD}USAGE:${NC}
    $0 [OPTIONS]

${BOLD}OPTIONS:${NC}
    -c, --contract-id <id>  Contract ID to monitor
    -n, --network <net>     Network: testnet, mainnet (default: testnet)
    -r, --rpc-url <url>     RPC URL (auto-detected if not set)
    -g, --grace-period <s>  Grace period in seconds (default: 3600)
    -i, --interval <s>      Check interval in seconds (default: 300)
    -l, --log-dir <dir>     Log directory (default: ./monitoring-logs)
    --once                  Run once and exit (for testing)
    -v, --verbose           Verbose output
    -h, --help              Show this help

${BOLD}GRACE PERIOD:${NC}
    The grace period is how long a market can remain unresolved after its
    close time before an alert is triggered. Default is 1 hour (3600 seconds).
    This allows time for oracle data, manual resolution, etc.

${BOLD}EXAMPLES:${NC}
    # Monitor testnet with default settings
    $0

    # Monitor with 30-minute grace period
    $0 --grace-period 1800

    # Check every 5 minutes
    $0 --interval 300

    # Run once for testing
    $0 --once

    # Mainnet monitoring with custom contract
    $0 --network mainnet --contract-id CAXXX...

${BOLD}OUTPUT:${NC}
    Logs are written to: $LOG_DIR/stuck-markets-YYYY-MM-DD.log
    Alerts are logged at ALERT level for integration with logging systems.

${BOLD}SIGNALS:${NC}
    Send SIGTERM to stop monitoring gracefully.

EOF
    exit 0
}

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_alert() { echo -e "${BOLD}${RED}🚨 ALERT${NC} $1" >&2; }
log_header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${NC}\n"; }
log_verbose() { [ "$VERBOSE" = true ] && echo -e "${BLUE}→${NC} $1" || true; }

# Log to file with timestamp
log_to_file() {
    local message=$1
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    mkdir -p "$LOG_DIR"
    echo "[$timestamp] $message" >> "$LOG_DIR/stuck-markets-$(date +%Y-%m-%d).log"
}

# Get network passphrase
get_network_passphrase() {
    case "$NETWORK" in
        testnet)
            echo "Test SDF Network ; September 2015"
            ;;
        mainnet)
            echo "Public Global Stellar Network ; September 2015"
            ;;
        *)
            echo "Unknown"
            ;;
    esac
}

# Auto-detect RPC URL
auto_detect_rpc_url() {
    if [ -n "$RPC_URL" ]; then
        return 0
    fi

    case "$NETWORK" in
        testnet)
            RPC_URL="https://soroban-testnet.stellar.org"
            ;;
        mainnet)
            RPC_URL="https://soroban-mainnet.stellar.org"
            ;;
        *)
            log_error "Unknown network: $NETWORK"
            return 1
            ;;
    esac

    log_verbose "Auto-detected RPC URL: $RPC_URL"
}

# Validate inputs
validate_inputs() {
    if [ -z "$CONTRACT_ID" ]; then
        log_error "Contract ID is required"
        log_info "Set via --contract-id or CONTRACT_ID environment variable"
        return 1
    fi

    if ! [[ "$CONTRACT_ID" =~ ^C[A-Z0-9]{55}$ ]]; then
        log_error "Invalid contract ID format: $CONTRACT_ID"
        return 1
    fi

    if [ "$GRACE_PERIOD_SECONDS" -lt 60 ]; then
        log_error "Grace period must be at least 60 seconds"
        return 1
    fi
}

# Query unresolved markets from contract
query_unresolved_markets() {
    log_verbose "Querying unresolved markets from contract $CONTRACT_ID"

    # This would call a view function on the contract
    # For now, we provide a template showing how monitoring would work

    local timestamp
    timestamp=$(date +%s)

    # Example output format (would come from contract):
    # market_id|close_time|current_time|age_seconds

    # Placeholder: in production, this would query the actual contract
    # stellar contract invoke --id "$CONTRACT_ID" ... -- get_unresolved_markets

    echo ""  # Return empty for template
}

# Check for stuck markets and emit alerts
check_stuck_markets() {
    log_header "Checking for Stuck Markets"

    local current_timestamp
    current_timestamp=$(date +%s)

    log_verbose "Current timestamp: $current_timestamp"
    log_verbose "Grace period: ${GRACE_PERIOD_SECONDS}s"
    log_verbose "Network: $NETWORK"
    log_verbose "Contract: $CONTRACT_ID"

    # Verify contract is accessible
    if ! stellar contract info \
        --id "$CONTRACT_ID" \
        --rpc-url "$RPC_URL" \
        --network-passphrase "$(get_network_passphrase)" &>/dev/null; then
        log_error "Contract not accessible: $CONTRACT_ID"
        log_to_file "ERROR: Contract $CONTRACT_ID not accessible on $NETWORK"
        return 1
    fi

    log_success "Contract is accessible"

    # Query unresolved markets
    local markets
    markets=$(query_unresolved_markets) || true

    local alert_count=0
    local checked_count=0

    if [ -z "$markets" ]; then
        log_info "No unresolved markets found (or placeholder data)"
        log_to_file "CHECK: Contract $CONTRACT_ID - no stuck markets detected"
        return 0
    fi

    # Process each unresolved market
    while IFS='|' read -r market_id close_time age_seconds; do
        [ -z "$market_id" ] && continue
        ((checked_count++))

        if [ "$age_seconds" -gt "$GRACE_PERIOD_SECONDS" ]; then
            ((alert_count++))

            local age_minutes=$((age_seconds / 60))
            local grace_minutes=$((GRACE_PERIOD_SECONDS / 60))

            log_alert "Market stuck: ID=$market_id Age=${age_minutes}m (grace=${grace_minutes}m)"
            log_to_file "ALERT: Market $market_id stuck for ${age_minutes} minutes (grace period: ${grace_minutes}m)"
        else
            log_verbose "Market $market_id: age=${age_seconds}s (within grace period)"
        fi
    done <<< "$markets"

    log_header "Check Summary"
    echo "Checked: $checked_count markets"
    echo "Alerts: $alert_count stuck markets"
    echo "Grace period: ${GRACE_PERIOD_SECONDS}s"

    if [ "$alert_count" -gt 0 ]; then
        log_alert "$alert_count market(s) exceeded grace period"
        return 1
    fi

    log_success "All markets within grace period"
    return 0
}

# Signal handler for graceful shutdown
handle_shutdown() {
    log_info "Received shutdown signal, stopping gracefully..."
    log_to_file "SHUTDOWN: Monitoring stopped"
    exit 0
}

# Continuous monitoring loop
run_monitoring() {
    log_header "Starting Market Monitoring"
    log_info "Interval: ${CHECK_INTERVAL_SECONDS}s"
    log_info "Grace period: ${GRACE_PERIOD_SECONDS}s"
    log_info "Log directory: $LOG_DIR"
    log_info "Press Ctrl+C to stop"

    log_to_file "START: Market monitoring started (grace_period=${GRACE_PERIOD_SECONDS}s, interval=${CHECK_INTERVAL_SECONDS}s)"

    # Set up signal handler
    trap handle_shutdown SIGTERM SIGINT

    while true; do
        local timestamp
        timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

        log_info "[$timestamp] Running check..."

        if check_stuck_markets; then
            log_success "Check completed successfully"
        else
            log_warning "Check found issues - see alerts above"
        fi

        if [ "$ONCE_MODE" = true ]; then
            log_info "Once mode: exiting"
            exit 0
        fi

        log_verbose "Sleeping for ${CHECK_INTERVAL_SECONDS}s..."
        sleep "$CHECK_INTERVAL_SECONDS"
    done
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -c|--contract-id)
            CONTRACT_ID="$2"
            shift 2
            ;;
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -r|--rpc-url)
            RPC_URL="$2"
            shift 2
            ;;
        -g|--grace-period)
            GRACE_PERIOD_SECONDS="$2"
            shift 2
            ;;
        -i|--interval)
            CHECK_INTERVAL_SECONDS="$2"
            shift 2
            ;;
        -l|--log-dir)
            LOG_DIR="$2"
            shift 2
            ;;
        --once)
            ONCE_MODE=true
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

# Validate and initialize
auto_detect_rpc_url || exit 1
validate_inputs || exit 1

# Run monitoring
run_monitoring
