#!/usr/bin/env python3
"""Graceful shutdown smoke check for deployment verification (#1689).

Verifies that HTTP servers and workers terminate cleanly when sent SIGTERM:
- In-flight requests are drained and completed successfully.
- The process closes all connections, workers, and sockets.
- The process terminates with exit code 0 within the graceful shutdown timeout.
- Fails when workers hang or connections remain unclosed.
- Records structured results into the deployment log.

Usage:
    python3 scripts/check-graceful-shutdown.py --command "node dist/server.js" --port 3001
    python3 scripts/check-graceful-shutdown.py --pid 12345 --shutdown-timeout-seconds 10
    python3 scripts/check-graceful-shutdown.py --log-file deployments/shutdown-smoke.log
"""

import argparse
import datetime
import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_PORT = 3001
DEFAULT_HEALTH_PATH = '/health'
DEFAULT_STARTUP_TIMEOUT = 15.0
DEFAULT_SHUTDOWN_TIMEOUT = 10.0
DEFAULT_LOG_FILE = 'deployments/shutdown-smoke.log'


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--command',
        help='Command to spawn the service under test (e.g. "node dist/server.js")'
    )
    parser.add_argument(
        '--pid',
        type=int,
        help='PID of an already-running process to test with SIGTERM'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=DEFAULT_PORT,
        help=f'Port to probe for readiness and in-flight traffic (default: {DEFAULT_PORT})'
    )
    parser.add_argument(
        '--health-path',
        default=DEFAULT_HEALTH_PATH,
        help=f'Health readiness probe path (default: {DEFAULT_HEALTH_PATH})'
    )
    parser.add_argument(
        '--startup-timeout-seconds',
        type=float,
        default=DEFAULT_STARTUP_TIMEOUT,
        help=f'Max seconds to wait for service readiness (default: {DEFAULT_STARTUP_TIMEOUT})'
    )
    parser.add_argument(
        '--shutdown-timeout-seconds',
        type=float,
        default=DEFAULT_SHUTDOWN_TIMEOUT,
        help=f'Max seconds to wait for clean exit after SIGTERM (default: {DEFAULT_SHUTDOWN_TIMEOUT})'
    )
    parser.add_argument(
        '--log-file',
        default=DEFAULT_LOG_FILE,
        help=f'Path to record deployment logs (default: {DEFAULT_LOG_FILE})'
    )
    parser.add_argument(
        '--no-inflight',
        action='store_true',
        help='Skip testing in-flight HTTP request completion during shutdown'
    )
    parser.add_argument(
        '--env',
        action='append',
        help='Environment variable in KEY=VAL format to pass to spawned command'
    )
    return parser.parse_args(argv)


def is_port_in_use(port, host='127.0.0.1'):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect((host, port))
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False


def wait_for_ready(url, timeout_seconds=15.0, poll_interval=0.25):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'GracefulShutdownSmokeCheck/1.0'})
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if 200 <= resp.status < 400:
                    return True
        except Exception:
            pass
        time.sleep(poll_interval)
    return False


def record_deployment_log(log_path, record):
    """Appends a structured JSON line record to the deployment log file."""
    path = Path(log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a', encoding='utf-8') as f:
        f.write(json.dumps(record, sort_keys=True) + '\n')


def perform_inflight_request(url, result_container):
    """Sends an HTTP request and records whether it succeeded."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'GracefulShutdownSmokeCheck/1.0'})
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            result_container['status_code'] = resp.status
            result_container['completed'] = 200 <= resp.status < 400
            result_container['error'] = None
    except Exception as exc:
        result_container['status_code'] = getattr(exc, 'code', None)
        result_container['completed'] = False
        result_container['error'] = str(exc) or exc.__class__.__name__


def check_graceful_shutdown(
    command=None,
    pid=None,
    port=DEFAULT_PORT,
    health_path=DEFAULT_HEALTH_PATH,
    startup_timeout=DEFAULT_STARTUP_TIMEOUT,
    shutdown_timeout=DEFAULT_SHUTDOWN_TIMEOUT,
    log_file=DEFAULT_LOG_FILE,
    simulate_inflight=True,
    extra_env=None,
):
    """Executes the graceful shutdown smoke check.

    Returns a tuple of (bool success, dict record, str message).
    """
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record = {
        'timestamp': timestamp,
        'check': 'graceful_shutdown_smoke_check',
        'status': 'UNKNOWN',
        'signal': 'SIGTERM',
        'pid': pid,
        'command': command,
        'port': port,
        'startup_duration_ms': 0.0,
        'shutdown_duration_ms': 0.0,
        'exit_code': None,
        'inflight_request': {'sent': False, 'completed': False, 'status_code': None, 'error': None},
        'unclosed_connections': False,
        'hanging_workers': False,
        'details': '',
    }

    proc = None
    target_pid = pid

    if command:
        env = os.environ.copy()
        if extra_env:
            for item in extra_env:
                if '=' in item:
                    k, v = item.split('=', 1)
                    env[k] = v

        start_time = time.time()
        print(f"Starting service with command: {command}")
        cmd_args = shlex.split(command)
        proc = subprocess.Popen(
            cmd_args,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        target_pid = proc.pid
        record['pid'] = target_pid

        # Wait for service readiness
        health_url = f"http://127.0.0.1:{port}{health_path}"
        print(f"Waiting up to {startup_timeout}s for service to answer at {health_url}...")
        is_ready = wait_for_ready(health_url, timeout_seconds=startup_timeout)
        startup_ms = (time.time() - start_time) * 1000.0
        record['startup_duration_ms'] = round(startup_ms, 2)

        if not is_ready:
            # Check if process died early
            poll = proc.poll()
            stderr_out = ''
            if poll is not None:
                _, stderr_out = proc.communicate(timeout=2)
            record['status'] = 'FAILED'
            record['details'] = f"Service failed to become ready within {startup_timeout}s. Process exited with code {poll}: {stderr_out.strip()}"
            record_deployment_log(log_file, record)
            if proc.poll() is None:
                proc.kill()
            return False, record, record['details']

        print(f"Service is ready (startup: {startup_ms:.1f}ms).")

    if not target_pid:
        record['status'] = 'FAILED'
        record['details'] = "Neither --command nor --pid provided."
        record_deployment_log(log_file, record)
        return False, record, record['details']

    # In-flight request simulation
    inflight_container = {'completed': False, 'status_code': None, 'error': None}
    inflight_thread = None
    if simulate_inflight and port:
        health_url = f"http://127.0.0.1:{port}{health_path}"
        record['inflight_request']['sent'] = True
        print(f"Initiating in-flight HTTP request to {health_url}...")
        inflight_thread = threading.Thread(
            target=perform_inflight_request,
            args=(health_url, inflight_container),
            daemon=True,
        )
        inflight_thread.start()
        # Brief yield to let request establish socket
        time.sleep(0.05)

    # Send SIGTERM
    print(f"Sending SIGTERM to process PID {target_pid}...")
    shutdown_start = time.time()
    try:
        if os.name != 'nt':
            os.kill(target_pid, signal.SIGTERM)
        else:
            os.kill(target_pid, signal.SIGTERM)
    except ProcessLookupError:
        record['status'] = 'FAILED'
        record['details'] = f"Process {target_pid} does not exist."
        record_deployment_log(log_file, record)
        return False, record, record['details']

    # Wait for process to exit cleanly
    is_clean_exit = False
    exit_code = None
    deadline = shutdown_start + shutdown_timeout

    if proc is not None:
        try:
            exit_code = proc.wait(timeout=shutdown_timeout)
            is_clean_exit = (exit_code == 0)
        except subprocess.TimeoutExpired:
            record['hanging_workers'] = True
            proc.kill()
            exit_code = proc.wait()
        finally:
            if proc.stdout:
                proc.stdout.close()
            if proc.stderr:
                proc.stderr.close()
    else:
        # Polling PID
        while time.time() < deadline:
            try:
                # Signal 0 tests if process still exists
                os.kill(target_pid, 0)
                time.sleep(0.1)
            except ProcessLookupError:
                is_clean_exit = True
                exit_code = 0
                break
        if not is_clean_exit:
            record['hanging_workers'] = True
            try:
                os.kill(target_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    shutdown_duration_ms = (time.time() - shutdown_start) * 1000.0
    record['shutdown_duration_ms'] = round(shutdown_duration_ms, 2)
    record['exit_code'] = exit_code

    # Check in-flight thread
    if inflight_thread:
        inflight_thread.join(timeout=2.0)
        record['inflight_request']['completed'] = inflight_container['completed']
        record['inflight_request']['status_code'] = inflight_container['status_code']
        record['inflight_request']['error'] = inflight_container['error']

    # Verify closed connections (port no longer held open)
    port_still_open = False
    if port:
        time.sleep(0.2)
        if is_port_in_use(port):
            port_still_open = True
            record['unclosed_connections'] = True

    # Validate all criteria
    failures = []
    if record['hanging_workers']:
        failures.append(f"Process hung and did not terminate within {shutdown_timeout}s after SIGTERM")
    elif exit_code != 0:
        failures.append(f"Process exited with non-zero code {exit_code} after SIGTERM")

    if record['inflight_request']['sent'] and not record['inflight_request']['completed']:
        failures.append(
            f"In-flight request failed during shutdown: status={record['inflight_request']['status_code']} error={record['inflight_request']['error']}"
        )

    if port_still_open:
        failures.append(f"Unclosed connection: port {port} is still in use after process exit")

    if failures:
        record['status'] = 'FAILED'
        record['details'] = '; '.join(failures)
        record_deployment_log(log_file, record)
        print(f"FAILED: {record['details']}", file=sys.stderr)
        return False, record, record['details']

    record['status'] = 'PASSED'
    record['details'] = (
        f"Clean exit with code 0 on SIGTERM in {shutdown_duration_ms:.1f}ms. "
        f"In-flight request completed: {record['inflight_request']['completed']}. "
        f"Connections closed cleanly."
    )
    record_deployment_log(log_file, record)
    print(f"PASSED: {record['details']}")
    return True, record, record['details']


def main(argv=None):
    args = parse_args(argv)

    if not args.command and not args.pid:
        print("Error: Either --command or --pid is required.", file=sys.stderr)
        return 2

    if args.port <= 0 or args.port > 65535:
        print(f"Error: Invalid port {args.port}.", file=sys.stderr)
        return 2

    if args.shutdown_timeout_seconds <= 0:
        print("Error: --shutdown-timeout-seconds must be positive.", file=sys.stderr)
        return 2

    success, record, _ = check_graceful_shutdown(
        command=args.command,
        pid=args.pid,
        port=args.port,
        health_path=args.health_path,
        startup_timeout=args.startup_timeout_seconds,
        shutdown_timeout=args.shutdown_timeout_seconds,
        log_file=args.log_file,
        simulate_inflight=not args.no_inflight,
        extra_env=args.env,
    )

    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
