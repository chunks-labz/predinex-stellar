"""Regression tests for the API integration examples documentation (#1640)."""

import base64
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / 'docs' / 'API_INTEGRATION_EXAMPLES.md'
OPENAPI = ROOT / 'api' / 'schema' / 'openapi.json'
CI_WORKFLOW = ROOT / '.github' / 'workflows' / 'ci.yml'

REQUIRED_SECTIONS = (
    'Base URL',
    'Headers and API keys',
    'API versioning',
    'Errors and correlation IDs',
    'Rate limits',
    'Liveness probe',
    'Readiness probe',
    'Detailed health',
    'List markets',
    'List events',
    'Estimate gas',
    'Get a reputation profile',
    'Pagination',
    'Reference',
)

REQUIRED_REQUEST_FRAGMENTS = (
    '"$PREDINEX_API_URL/healthz"',
    '"$PREDINEX_API_URL/readyz"',
    '"$PREDINEX_API_URL/health"',
    '"$PREDINEX_API_URL/api/markets',
    '"$PREDINEX_API_URL/api/v1/markets',
    '"$PREDINEX_API_URL/api/events',
    '"$PREDINEX_API_URL/api/gas-estimate/estimate"',
    '"$PREDINEX_API_URL/api/reputation/profile/',
)

OPENAPI_PATHS = (
    '/api/markets',
    '/api/events',
    '/api/gas-estimate/estimate',
    '/api/reputation/profile/{address}',
)

REQUIRED_CONTRACT_TOKENS = (
    'x-api-key',
    'X-API-Version',
    'Accept-Version',
    'Deprecation',
    'Sunset',
    'UNSUPPORTED_API_VERSION',
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'INTERNAL_ERROR',
    'RATE_LIMITED',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
    'Retry-After',
    'X-Correlation-ID',
    'correlationId',
)


def anchor(text):
    return re.sub(r'[^a-z0-9 -]', '', text.lower()).strip().replace(' ', '-')


class ApiExamplesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = DOC.read_text(encoding='utf-8')
        cls.headings = re.findall(r'^#{1,3} (.+)$', cls.content, re.MULTILINE)

    @staticmethod
    def json_blocks(text):
        return [
            json.loads(block)
            for block in re.findall(r'```json\s*\n(.*?)\n```', text, re.DOTALL)
        ]

    def section(self, heading):
        pattern = re.compile(
            r'^### ' + re.escape(heading) + r'\s*$\n(.*?)(?=^#{1,3} |\Z)',
            re.MULTILINE | re.DOTALL,
        )
        match = pattern.search(self.content)
        self.assertIsNotNone(match, f'missing section: {heading}')
        return match.group(1)

    def test_required_sections_are_present(self):
        for heading in REQUIRED_SECTIONS:
            with self.subTest(section=heading):
                self.assertIn(heading, self.headings)

    def test_copyable_requests_cover_the_documented_endpoints(self):
        for fragment in REQUIRED_REQUEST_FRAGMENTS:
            with self.subTest(request=fragment):
                self.assertIn(fragment, self.content)

    def test_all_json_examples_are_valid(self):
        blocks = self.json_blocks(self.content)
        self.assertGreaterEqual(len(blocks), 10)
        for index, block in enumerate(blocks):
            with self.subTest(block=index):
                self.assertIsInstance(block, dict)

    def test_health_response_examples_match_the_routes(self):
        liveness = self.json_blocks(self.section('Liveness probe'))
        self.assertEqual(liveness, [{'status': 'ok'}])

        readiness = self.json_blocks(self.section('Readiness probe'))
        self.assertEqual(len(readiness), 2)
        for block in readiness:
            self.assertIn('status', block)
            self.assertIn('checks', block)
            self.assertIn('config', block['checks'])
            self.assertIn('api', block['checks'])
        self.assertEqual(readiness[0]['status'], 'ok')
        self.assertEqual(readiness[1]['status'], 'unavailable')

        health = self.json_blocks(self.section('Detailed health'))[0]
        for key in (
            'success',
            'status',
            'service',
            'version',
            'uptimeSecs',
            'timestamp',
            'dependencies',
            'healthCachedAt',
        ):
            self.assertIn(key, health)
        self.assertEqual(health['status'], 'healthy')
        self.assertTrue({'database', 'rpc', 'queue'} <= set(health['dependencies']))

    def test_endpoint_response_examples_match_the_routes(self):
        markets = self.json_blocks(self.section('List markets'))[0]
        for key in ('success', 'data', 'pagination', 'timestamp'):
            self.assertIn(key, markets)
        for key in (
            'total',
            'limit',
            'offset',
            'count',
            'hasMore',
            'nextOffset',
            'prevOffset',
            'page',
            'pageSize',
        ):
            self.assertIn(key, markets['pagination'])

        events = self.json_blocks(self.section('List events'))[0]
        self.assertIn('nextCursor', events['pagination'])
        self.assertIsNotNone(events['pagination']['nextCursor'])
        cursor_json = base64.urlsafe_b64decode(
            events['pagination']['nextCursor'] + '=='
        ).decode('utf-8')
        cursor = json.loads(cursor_json)
        self.assertTrue({'ledgerSeq', 'eventIndex', 'eventId'} <= set(cursor))

        gas = self.json_blocks(self.section('Estimate gas'))[0]
        self.assertTrue(gas['success'])
        for key in (
            'operation',
            'estimatedInstructions',
            'estimatedCpuCost',
            'estimatedMemoryCost',
            'estimatedStorageCost',
            'totalCost',
            'optimizationLevel',
            'timestamp',
        ):
            self.assertIn(key, gas['estimate'])

        reputation = self.json_blocks(self.section('Get a reputation profile'))[0]
        for key in (
            'user',
            'score',
            'tier',
            'totalBorrowedVolume',
            'totalRepaidVolume',
            'ltvBoostBps',
            'rateDiscountBps',
        ):
            self.assertIn(key, reputation['data'])
        self.assertEqual(reputation['data']['score'], 300)
        self.assertEqual(reputation['data']['tier'], 'Bronze')

    def test_request_and_error_contract_is_documented(self):
        for token in REQUIRED_CONTRACT_TOKENS:
            with self.subTest(token=token):
                self.assertIn(token, self.content)
        self.assertIn('query string', self.content)
        self.assertIn('`Retry-After` in seconds', self.content)

    def test_documented_api_paths_exist_in_the_openapi_spec(self):
        spec = json.loads(OPENAPI.read_text(encoding='utf-8'))
        paths = spec.get('paths', {})
        for path in OPENAPI_PATHS:
            with self.subTest(path=path):
                self.assertIn(path, paths)

    def test_relative_links_and_internal_anchors_resolve(self):
        for target in re.findall(r'\]\((?!https?://|#)([^)]+)\)', self.content):
            path = (DOC.parent / target.split('#', 1)[0]).resolve()
            with self.subTest(link=target):
                self.assertTrue(path.exists(), f'broken link: {target}')

        anchors = {anchor(heading) for heading in self.headings}
        for target in re.findall(r'\]\(#([^)]+)\)', self.content):
            with self.subTest(anchor=target):
                self.assertIn(target, anchors)

    def test_indexes_link_to_the_new_guide(self):
        docs_index = (ROOT / 'docs' / 'README.md').read_text(encoding='utf-8')
        api_index = (ROOT / 'api' / 'README.md').read_text(encoding='utf-8')
        self.assertIn('./API_INTEGRATION_EXAMPLES.md', docs_index)
        self.assertIn('../docs/API_INTEGRATION_EXAMPLES.md', api_index)

    def test_ci_runs_this_regression_test(self):
        workflow = CI_WORKFLOW.read_text(encoding='utf-8')
        self.assertIn('Test API integration examples', workflow)
        self.assertIn("test_api_examples.py", workflow)


if __name__ == '__main__':
    unittest.main()
