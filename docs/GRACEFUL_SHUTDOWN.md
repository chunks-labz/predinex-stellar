# Graceful Shutdown Smoke Check

This document outlines the graceful shutdown verification tooling for Predinex services (#1689).

---

## Overview & Acceptance Criteria

When deploying updates or scaling services down, workers must exit cleanly upon receiving a `SIGTERM` signal without abruptly dropping in-flight requests or leaving sockets hanging open.

1. **Smoke Check:** Sends `SIGTERM` to the process and verifies clean termination (exit code 0).
2. **Failure Handling:** Fails immediately on hanging workers (exceeding shutdown timeout) or lingering unclosed connections.
3. **Deployment Log Recording:** Records structured audit records in deployment logs (`deployments/shutdown-smoke.log`).

---

## Script: `scripts/check-graceful-shutdown.py`

The smoke check tool can either launch and manage a child service or monitor an existing running process by PID.

### Features
- **Readiness Probing:** Polls `--health-path` (default `/health`) until the service answers or startup timeout expires.
- **In-flight Request Draining:** Simulates an active HTTP request concurrently with sending `SIGTERM` to ensure in-flight requests drain properly.
- **Clean Exit Verification:** Asserts the process exits with code 0 within `--shutdown-timeout-seconds`.
- **Hanging Worker Detection:** If the worker does not stop within the grace period, it sends `SIGKILL` and marks the test failed.
- **Unclosed Connection Detection:** Verifies the port is released and no listening sockets remain open.
- **Structured Deployment Logs:** Appends JSON logs to `--log-file` (default `deployments/shutdown-smoke.log`).

---

## Usage Examples

### 1. Launching and Verifying a Service Command

```bash
python3 scripts/check-graceful-shutdown.py \
  --command "node dist/server.js" \
  --port 3001 \
  --health-path "/health" \
  --startup-timeout-seconds 10 \
  --shutdown-timeout-seconds 10 \
  --simulate-inflight \
  --log-file "deployments/shutdown-smoke.log"
```

### 2. Probing an Existing Running Process

```bash
python3 scripts/check-graceful-shutdown.py \
  --pid 12345 \
  --port 3001 \
  --health-path "/health" \
  --shutdown-timeout-seconds 15
```

### 3. Running Unit Tests

```bash
python3 -m unittest scripts/tests/test_check_graceful_shutdown.py -v
```

---

## Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| `0` | Success: Clean shutdown with code 0, no hanging workers, all connections closed. |
| `1` | Failure: Process hung, exited with non-zero code, or left open connections. |
| `2` | Bad Usage: Missing or invalid CLI arguments. |

---

## Log Output Format

Logs are formatted as newline-delimited JSON objects with timestamps, execution metrics, and status:

```json
{
  "timestamp": "2026-04-20T12:00:00Z",
  "status": "PASSED",
  "command": "node dist/server.js",
  "pid": 9801,
  "port": 3001,
  "exit_code": 0,
  "startup_duration_ms": 250.4,
  "shutdown_duration_ms": 32.1,
  "inflight_completed": true,
  "connections_closed": true
}
```
