"""Regression tests for the post-deployment HTTP health check (#1637)."""

import importlib.util
import io
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import Mock

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
WORKFLOWS = SCRIPTS_DIR.parent / '.github' / 'workflows'

# The script uses the repo's hyphenated script naming, so load it by path.
spec = importlib.util.spec_from_file_location(
    'check_deployment_health', SCRIPTS_DIR / 'check-deployment-health.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
check_health = health.check_health
main = health.main


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def close(self):
        pass


def http_error(status):
    return urllib.error.HTTPError('https://preview.example', status,
                                  'error', {}, None)


class HealthCheckTests(unittest.TestCase):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_empty_url_is_rejected(self):
        code, _, err = self.run_main(['--url', '   '])
        self.assertEqual(code, 2)
        self.assertIn('http(s) URL', err)

    def test_non_http_url_is_rejected(self):
        code, _, err = self.run_main(['--url', 'ftp://preview.example'])
        self.assertEqual(code, 2)
        self.assertIn('http(s) URL', err)

    def test_invalid_attempt_count_is_rejected(self):
        code, _, err = self.run_main(['--url', 'https://preview.example',
                                      '--attempts', '0'])
        self.assertEqual(code, 2)
        self.assertIn('--attempts', err)

    def test_healthy_response_succeeds_on_first_attempt(self):
        opener = Mock(return_value=FakeResponse(200))
        healthy = check_health('https://preview.example', 5, 0, 1,
                               opener=opener, sleep=Mock())
        self.assertTrue(healthy)
        opener.assert_called_once()

    def test_transient_error_then_success_retries(self):
        opener = Mock(side_effect=[http_error(503), FakeResponse(200)])
        sleep = Mock()
        healthy = check_health('https://preview.example', 5, 2, 1,
                               opener=opener, sleep=sleep)
        self.assertTrue(healthy)
        self.assertEqual(opener.call_count, 2)
        sleep.assert_called_once_with(2)

    def test_exhausted_retries_fail(self):
        opener = Mock(side_effect=[http_error(503)] * 3)
        healthy = check_health('https://preview.example', 3, 0, 1,
                               opener=opener, sleep=Mock())
        self.assertFalse(healthy)
        self.assertEqual(opener.call_count, 3)

    def test_client_error_fails_fast(self):
        opener = Mock(side_effect=[http_error(404), FakeResponse(200)])
        healthy = check_health('https://preview.example', 5, 0, 1,
                               opener=opener, sleep=Mock())
        self.assertFalse(healthy)
        opener.assert_called_once()

    def test_connection_error_is_retried(self):
        failure = urllib.error.URLError('connection refused')
        opener = Mock(side_effect=[failure, failure, FakeResponse(204)])
        healthy = check_health('https://preview.example', 3, 0, 1,
                               opener=opener, sleep=Mock())
        self.assertTrue(healthy)
        self.assertEqual(opener.call_count, 3)

    def test_deploy_workflows_have_a_post_deploy_health_step(self):
        guards = {
            'deploy-testnet.yml': 'exit 1',
            'preview-deploy.yml': 'scripts/check-deployment-health.py',
        }
        for name, guard in guards.items():
            with self.subTest(workflow=name):
                content = (WORKFLOWS / name).read_text(encoding='utf-8')
                self.assertIn('id: health_check', content)
                self.assertIn(guard, content)


if __name__ == '__main__':
    unittest.main()
