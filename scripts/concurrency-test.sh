#!/usr/bin/env bash
#
# Multi-user concurrent interaction simulation test runner
#
# This script runs the comprehensive concurrent testing suite for the
# Predinex contract, including performance benchmarks and stress tests.
#
# Usage:
#   ./scripts/concurrency-test.sh [OPTIONS]
#
# Options:
#   --quick       Run only quick tests (skip stress tests)
#   --stress      Run only stress/performance tests
#   --verbose     Show detailed test output
#   --json        Output results in JSON format
#   --help        Show this help message
#
# Examples:
#   ./scripts/concurrency-test.sh                    # Run all tests
#   ./scripts/concurrency-test.sh --quick            # Quick tests only
#   ./scripts/concurrency-test.sh --stress --verbose # Stress tests with details
#
# Issue #1114: Build multi-user concurrent interaction simulation tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
RUN_QUICK=true
RUN_STRESS=true
VERBOSE=false
JSON_OUTPUT=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            RUN_STRESS=false
            shift
            ;;
        --stress)
            RUN_QUICK=false
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --help)
            grep '^#' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Print banner
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Predinex Concurrent Interaction Simulation Test Suite   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Change to contract directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACT_DIR="$PROJECT_ROOT/contracts/predinex"

cd "$CONTRACT_DIR"

# Check if cargo is available
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}Error: cargo not found. Please install Rust.${NC}"
    exit 1
fi

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
START_TIME=$(date +%s)

# Function to run a test and track results
run_test() {
    local test_name=$1
    local test_filter=$2
    
    echo -e "${YELLOW}Running: ${test_name}${NC}"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$VERBOSE" = true ]; then
        if cargo test --lib "$test_filter" -- --nocapture; then
            echo -e "${GREEN}✓ Passed: ${test_name}${NC}\n"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}✗ Failed: ${test_name}${NC}\n"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
    else
        if cargo test --lib "$test_filter" --quiet 2>&1 | grep -q "test result: ok"; then
            echo -e "${GREEN}✓ Passed: ${test_name}${NC}\n"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}✗ Failed: ${test_name}${NC}\n"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
    fi
}

# Quick tests (basic concurrent operations)
if [ "$RUN_QUICK" = true ]; then
    echo -e "${BLUE}═══ Running Quick Concurrent Tests ═══${NC}\n"
    
    run_test "Concurrent bets on same pool" "c1_concurrent_bets_on_same_pool"
    run_test "Concurrent bets both sides" "c2_concurrent_bets_both_sides"
    run_test "Repeated concurrent bets" "c3_repeated_concurrent_bets"
    run_test "Concurrent bets with referrals" "c4_concurrent_bets_with_referrals"
    run_test "Concurrent bet cancellations" "c5_concurrent_bet_cancellations"
    run_test "Concurrent claims after settlement" "c6_concurrent_claims_after_settlement"
    run_test "Concurrent pool extensions" "c7_concurrent_pool_extensions"
    run_test "Multiple pools concurrent ops" "c9_multiple_pools_concurrent_operations"
    run_test "Concurrent mixed operations" "c11_concurrent_mixed_operations"
    run_test "Concurrent participant count" "c12_concurrent_participant_count"
    run_test "Event emission concurrent" "c13_event_emission_concurrent"
fi

# Stress tests (high load and performance)
if [ "$RUN_STRESS" = true ]; then
    echo -e "${BLUE}═══ Running Stress & Performance Tests ═══${NC}\n"
    
    run_test "High-volume concurrent betting" "c8_high_volume_concurrent_betting"
    run_test "Concurrent ops during state transitions" "c10_concurrent_ops_during_state_transitions"
    run_test "Scalability - increasing users" "c14_scalability_increasing_users"
    run_test "Data consistency comprehensive" "c15_data_consistency_comprehensive"
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Print summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                     Test Summary                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Total Tests:   ${TOTAL_TESTS}"
echo -e "Passed:        ${GREEN}${PASSED_TESTS}${NC}"
echo -e "Failed:        ${RED}${FAILED_TESTS}${NC}"
echo -e "Duration:      ${DURATION}s"
echo ""

# JSON output if requested
if [ "$JSON_OUTPUT" = true ]; then
    cat << EOF
{
  "summary": {
    "total": ${TOTAL_TESTS},
    "passed": ${PASSED_TESTS},
    "failed": ${FAILED_TESTS},
    "duration_seconds": ${DURATION}
  },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "success": $([ $FAILED_TESTS -eq 0 ] && echo "true" || echo "false")
}
EOF
fi

# Exit with appropriate code
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
