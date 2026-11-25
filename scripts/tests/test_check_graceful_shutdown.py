"""Tests for the graceful shutdown smoke check, scripts/check-graceful-shutdown.py (#1689).

Covers:
- Clean shutdown on SIGTERM
- In-flight request completion before process exit
- Detection and failure on hanging workers / timeout
- Detection and failure on non-zero exit codes
- Recording of structured results into deployment logs
- CLI argument validation
"""

import importlib.util
import json
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location(
    'check_graceful_shutdown', SCRIPTS_DIR / 'check-graceful-shutdown.py'
)
shutdown_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shutdown_mod)

check_graceful_shutdown = shutdown_mod.check_graceful_shutdown
main = shutdown_mod.main


def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class GracefulShutdownSmokeCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.log_file = Path(self.temp_dir.name) / 'deployment.log'

    def tearDown(self):
        self.temp_dir.cleanup()

    def _create_server_script(self, port, sigterm_action='exit_0', request_delay=0.0):
        script_path = Path(self.temp_dir.name) / f'server_{port}.py'
        content = f"""
import http.server
import signal
import socketserver
import sys
import time

active_requests = 0

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        global active_requests
        active_requests += 1
        try:
            if {request_delay} > 0:
                time.sleep({request_delay})
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{{"status":"ok"}}')
        finally:
            active_requests -= 1

class ThreadedServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

server = ThreadedServer(('127.0.0.1', {port}), Handler)

def on_sigterm(signum, frame):
    action = '{sigterm_action}'
    if action == 'ignore':
        pass
    elif action == 'exit_42':
        server.server_close()
        sys.exit(42)
    else:
        # Graceful drain: wait for worker threads
        start = time.time()
        while active_requests > 0 and (time.time() - start) < 3.0:
            time.sleep(0.02)
        server.server_close()
        sys.exit(0)

if '{sigterm_action}' == 'ignore':
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
else:
    signal.signal(signal.SIGTERM, on_sigterm)
server.serve_forever()
"""
        script_path.write_text(content, encoding='utf-8')
        return script_path

    def test_clean_exit_on_sigterm_passes(self):
        """A process that terminates with code 0 on SIGTERM succeeds."""
        port = find_free_port()
        script = self._create_server_script(port, sigterm_action='exit_0')
        cmd = f'{sys.executable} {script}'

        success, record, message = check_graceful_shutdown(
            command=cmd,
            port=port,
            health_path='/health',
            startup_timeout=5.0,
            shutdown_timeout=5.0,
            log_file=str(self.log_file),
            simulate_inflight=True,
        )

        self.assertTrue(success, message)
        self.assertEqual(record['status'], 'PASSED')
        self.assertEqual(record['exit_code'], 0)
        self.assertFalse(record['hanging_workers'])
        self.assertFalse(record['unclosed_connections'])
        self.assertTrue(record['inflight_request']['completed'])

        # Verify deployment log was recorded
        self.assertTrue(self.log_file.exists())
        log_content = self.log_file.read_text(encoding='utf-8').strip()
        logged_data = json.loads(log_content)
        self.assertEqual(logged_data['status'], 'PASSED')
        self.assertEqual(logged_data['signal'], 'SIGTERM')
        self.assertEqual(logged_data['check'], 'graceful_shutdown_smoke_check')

    def test_inflight_request_drains_during_shutdown(self):
        """In-flight slow request is allowed to finish while process shuts down."""
        port = find_free_port()
        script = self._create_server_script(port, sigterm_action='exit_0', request_delay=0.4)
        cmd = f'{sys.executable} {script}'

        success, record, message = check_graceful_shutdown(
            command=cmd,
            port=port,
            health_path='/health',
            startup_timeout=5.0,
            shutdown_timeout=5.0,
            log_file=str(self.log_file),
            simulate_inflight=True,
        )

        self.assertTrue(success, message)
        self.assertTrue(record['inflight_request']['completed'])
        self.assertEqual(record['inflight_request']['status_code'], 200)

    def test_hanging_process_fails_and_records_deployment_log(self):
        """A process that ignores SIGTERM and hangs is killed and fails."""
        port = find_free_port()
        script = self._create_server_script(port, sigterm_action='ignore')
        cmd = f'{sys.executable} {script}'

        success, record, message = check_graceful_shutdown(
            command=cmd,
            port=port,
            health_path='/health',
            startup_timeout=5.0,
            shutdown_timeout=1.0,  # Short timeout for test speed
            log_file=str(self.log_file),
            simulate_inflight=False,
        )

        self.assertFalse(success)
        self.assertEqual(record['status'], 'FAILED')
        self.assertTrue(record['hanging_workers'])
        self.assertIn('Process hung', record['details'])

        # Verify deployment log recorded failure
        self.assertTrue(self.log_file.exists())
        log_content = self.log_file.read_text(encoding='utf-8').strip()
        logged_data = json.loads(log_content)
        self.assertEqual(logged_data['status'], 'FAILED')
        self.assertTrue(logged_data['hanging_workers'])

    def test_nonzero_exit_fails(self):
        """A process that exits with code != 0 on SIGTERM fails."""
        port = find_free_port()
        script = self._create_server_script(port, sigterm_action='exit_42')
        cmd = f'{sys.executable} {script}'

        success, record, message = check_graceful_shutdown(
            command=cmd,
            port=port,
            health_path='/health',
            startup_timeout=5.0,
            shutdown_timeout=5.0,
            log_file=str(self.log_file),
            simulate_inflight=False,
        )

        self.assertFalse(success)
        self.assertEqual(record['status'], 'FAILED')
        self.assertEqual(record['exit_code'], 42)
        self.assertIn('non-zero code 42', record['details'])

    def test_cli_missing_required_args(self):
        """CLI requires either --command or --pid."""
        code = main(['--log-file', str(self.log_file)])
        self.assertEqual(code, 2)

    def test_cli_invalid_port(self):
        """CLI rejects invalid port numbers."""
        code = main(['--command', 'echo 1', '--port', '999999'])
        self.assertEqual(code, 2)

    def test_cli_invalid_timeout(self):
        """CLI rejects negative or zero timeouts."""
        code = main(['--command', 'echo 1', '--shutdown-timeout-seconds', '0'])
        self.assertEqual(code, 2)


if __name__ == '__main__':
    unittest.main()
