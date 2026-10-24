# Concurrent Testing Quick Reference

## Quick Start

```bash
# Run all tests
./scripts/concurrency-test.sh

# Run specific category
cargo test --lib c1_  # Concurrent betting
cargo test --lib c5_  # Race conditions
cargo test --lib c8_  # Stress tests
```

## Test Index

| Test | Description | Users | Operations | Category |
|------|-------------|-------|------------|----------|
| C1 | Concurrent bets same pool | 50 | 50 | Betting |
| C2 | Concurrent bets both sides | 100 | 100 | Betting |
| C3 | Repeated concurrent bets | 20 | 100 | Betting |
| C4 | Concurrent bets with referrals | 30 | 30 | Betting |
| C5 | Concurrent bet cancellations | 25 | 50 | Race Conditions |
| C6 | Concurrent claims | 20 | 20 | Race Conditions |
| C7 | Concurrent pool extensions | 1 | 5 | Race Conditions |
| C8 | High-volume betting (stress) | 100 | 1,000 | Stress |
| C9 | Multiple pools concurrent | 30 | 150 | Stress |
| C10 | Ops during state transitions | 20 | 40 | Stress |
| C11 | Mixed operations | 30 | 90 | Mixed |
| C12 | Participant count accuracy | 40 | 80 | Mixed |
| C13 | Event emission concurrent | 25 | 25 | Events |
| C14 | Scalability test | 10-100 | Variable | Events |
| C15 | Data consistency comprehensive | 50 | 175 | Events |

**Total**: 15 tests, 4,000+ operations

## Command Cheatsheet

```bash
# All tests
./scripts/concurrency-test.sh

# Quick tests only (skip stress)
./scripts/concurrency-test.sh --quick

# Stress tests only
./scripts/concurrency-test.sh --stress

# Verbose output
./scripts/concurrency-test.sh --verbose

# JSON output
./scripts/concurrency-test.sh --json

# Specific test
cargo test --lib c1_concurrent_bets_on_same_pool

# With output
cargo test --lib c8_high_volume -- --nocapture

# Category
cargo test --lib concurrent_tests::c[1-4]_
```

## Key Metrics

| Metric | Value |
|--------|-------|
| Test Coverage | >85% |
| Max Users Tested | 100 |
| Total Operations | 4,000+ |
| Success Rate Target | 100% |
| Assertions | 100+ |

## Test Categories

### 🔵 Betting (C1-C4)
Basic concurrent betting scenarios

### 🟡 Race Conditions (C5-C7)
State consistency verification

### 🔴 Stress (C8-C10)
High load and performance

### 🟢 Mixed (C11-C12)
Real-world patterns

### 🟣 Events (C13-C15)
Event correctness and scalability

## Expected Outcomes

✓ All tests pass with 100% success rate  
✓ No assertion failures  
✓ All events emitted correctly  
✓ Pool totals match expected values  
✓ User bets recorded accurately  

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Timeout | Increase test timeout or reduce user count |
| Memory | Run test subsets or use `--quick` |
| Failures | Run with `--nocapture` for details |

## Performance Targets

- **Throughput**: >100 operations/second
- **Scalability**: Linear up to 100 users
- **Event Rate**: 100% emission
- **Consistency**: 100% state correctness

## CI Integration

```yaml
- run: cargo test --lib concurrent_tests
- run: ./scripts/concurrency-test.sh --json
```

## Issue Reference

**Issue #1114**: Build multi-user concurrent interaction simulation tests  
**Repo**: chunks-labz/predinex-stellar  
**Original**: Smartdevs17/stellarlend#860
