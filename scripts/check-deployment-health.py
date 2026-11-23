#!/usr/bin/env python3
"""Post-deployment HTTP health check used by the deployment workflows.

The probe succeeds only when the deployment URL answers with a success status
within the configured retry budget. Empty/malformed URLs and exhausted retries
are hard failures so a broken deployment cannot be reported as healthy.

With --expect-commit, the deployment must also report that commit from its
version endpoint (--version-path, default /api/version, #1665), so a deploy
that is serving an older build fails the smoke test.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

# Transient responses that are worth retrying. Other 4xx responses indicate a
# deterministic configuration/client problem and fail immediately.
RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Deployment URL to probe')
    parser.add_argument('--attempts', type=int, default=5,
                        help='Total number of probes (default: 5)')
    parser.add_argument('--delay-seconds', type=float, default=3,
                        help='Delay between attempts (default: 3)')
    parser.add_argument('--timeout-seconds', type=float, default=10,
                        help='Timeout for each probe (default: 10)')
    parser.add_argument('--expect-commit', default='',
                        help='Require the version endpoint to report this git commit')
    parser.add_argument('--version-path', default='/api/version',
                        help='Path of the version endpoint (default: /api/version)')
    return parser.parse_args(argv)


def is_valid_url(url):
    parsed = urlparse(url)
    return parsed.scheme in ('http', 'https') and bool(parsed.netloc)


def check_health(url, attempts, delay_seconds, timeout_seconds,
                 opener=None, sleep=None):
    """Return True when a probe succeeds.

    ``opener`` and ``sleep`` are injectable so the retry policy can be tested
    without making network calls or waiting in real time.
    """
    opener = opener or urllib.request.urlopen
    sleep = sleep or time.sleep
    last_reason = 'no response'

    for attempt in range(1, attempts + 1):
        try:
            response = opener(url, timeout=timeout_seconds)
            status = getattr(response, 'status', None)
            if status is None:
                status = response.getcode()
            close = getattr(response, 'close', None)
            if close:
                close()

            if 200 <= status < 400:
                print(f'Deployment healthy: HTTP {status} from {url}')
                return True

            last_reason = f'HTTP {status}'
            retryable = status in RETRYABLE_STATUSES
        except urllib.error.HTTPError as exc:
            last_reason = f'HTTP {exc.code}'
            retryable = exc.code in RETRYABLE_STATUSES
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_reason = str(exc) or exc.__class__.__name__
            retryable = True

        if not retryable:
            print(f'Attempt {attempt}/{attempts}: {last_reason} (not retryable)',
                  file=sys.stderr)
            return False

        print(f'Attempt {attempt}/{attempts}: {last_reason} (retrying)')
        if attempt < attempts and delay_seconds > 0:
            sleep(delay_seconds)

    print(f'Health check exhausted {attempts} attempt(s): {last_reason}',
          file=sys.stderr)
    return False


def check_version(url, version_path, expected_commit, timeout_seconds, opener=None):
    """Return True when the version endpoint reports ``expected_commit``.

    A commit prefix of at least 7 characters matches either way round, since
    deploy tooling and the build may record short and full SHAs differently.
    """
    opener = opener or urllib.request.urlopen
    version_url = url.rstrip('/') + '/' + version_path.lstrip('/')
    try:
        response = opener(version_url, timeout=timeout_seconds)
        try:
            body = json.loads(response.read().decode('utf-8'))
        finally:
            close = getattr(response, 'close', None)
            if close:
                close()
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        print(f'::error::Could not read {version_url}: {exc or exc.__class__.__name__}',
              file=sys.stderr)
        return False

    build = body.get('build') if isinstance(body, dict) else None
    reported = build.get('commit') if isinstance(build, dict) else None
    contract = body.get('contract') if isinstance(body, dict) else None
    expected = expected_commit.strip().lower()
    if not isinstance(reported, str) or not reported:
        print(f'::error::{version_url} reports no build commit (expected {expected}).',
              file=sys.stderr)
        return False
    reported = reported.lower()
    shortest = min(len(reported), len(expected))
    if shortest < 7 or reported[:shortest] != expected[:shortest]:
        print(f'::error::{version_url} reports commit {reported}, expected {expected}.',
              file=sys.stderr)
        return False

    summary = f'commit {reported}'
    if isinstance(contract, dict):
        summary += (f", contract {contract.get('id') or 'unset'}"
                    f" on {contract.get('network') or 'unknown network'}"
                    f" (crate {contract.get('crateVersion')})")
    print(f'Deployment version verified: {summary}')
    return True


def main(argv=None):
    args = parse_args(argv)
    url = args.url.strip()

    if not is_valid_url(url):
        print('::error::Deployment health check requires an http(s) URL.',
              file=sys.stderr)
        return 2
    if args.attempts < 1:
        print('::error::--attempts must be at least 1.', file=sys.stderr)
        return 2
    if args.delay_seconds < 0 or args.timeout_seconds <= 0:
        print('::error::--delay-seconds must be >= 0 and --timeout-seconds > 0.',
              file=sys.stderr)
        return 2

    print(f'Checking deployment health at {url} '
          f'({args.attempts} attempt(s), {args.timeout_seconds}s timeout)')
    if not check_health(url, args.attempts, args.delay_seconds,
                        args.timeout_seconds):
        print(f'::error::Deployment at {url} did not become healthy.',
              file=sys.stderr)
        return 1

    if args.expect_commit.strip() and not check_version(
            url, args.version_path, args.expect_commit, args.timeout_seconds):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
