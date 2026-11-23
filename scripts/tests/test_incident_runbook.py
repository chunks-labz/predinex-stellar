"""Regression tests for the production incident runbook (#1639)."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / 'docs' / 'INCIDENT_RUNBOOK.md'

REQUIRED_SECTIONS = (
    '1. Severity and escalation',
    '2. First five minutes',
    '3. Settlement stalled or incorrect',
    '4. RPC degraded or unavailable',
    '5. API or frontend unavailable',
    '6. Database or indexer saturation',
    '7. Contract paused unexpectedly',
    '8. Stale oracle or TWAP',
    '9. Suspected key compromise or exploit',
    '10. Bad deployment or rollback needed',
    '11. Closure',
)

REQUIRED_COMMANDS = (
    'is_paused',
    'get_pool_count',
    'soroban-rpc-client get_events',
    'soroban-rpc-client health-check',
    '$API_URL/healthz',
    '$API_URL/readyz',
    '$BOT_HEALTH_URL/health/metrics',
    'pg_stat_activity',
    'scripts/monitor-stuck-markets.sh',
    'curl -fsS "$API_URL/healthz"',
)


def anchor(text):
    return re.sub(r'[^a-z0-9 -]', '', text.lower()).strip().replace(' ', '-')


class IncidentRunbookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = DOC.read_text(encoding='utf-8')
        cls.headings = re.findall(r'^## (.+)$', cls.content, re.MULTILINE)

    def test_all_common_incident_playbooks_are_present(self):
        for heading in REQUIRED_SECTIONS:
            with self.subTest(section=heading):
                self.assertIn(heading, self.headings)

    def test_playbooks_include_copyable_diagnostics(self):
        for command in REQUIRED_COMMANDS:
            with self.subTest(command=command):
                self.assertIn(command, self.content)

    def test_internal_anchors_resolve(self):
        anchors = {anchor(heading) for heading in self.headings}
        for target in re.findall(r'\]\(#([^)]+)\)', self.content):
            with self.subTest(anchor=target):
                self.assertIn(target, anchors)

    def test_relative_links_point_to_existing_files(self):
        for target in re.findall(r'\]\((?!https?://|#)([^)]+)\)', self.content):
            path = (DOC.parent / target.split('#', 1)[0]).resolve()
            with self.subTest(link=target):
                self.assertTrue(path.exists(), f'broken link: {target}')


if __name__ == '__main__':
    unittest.main()
