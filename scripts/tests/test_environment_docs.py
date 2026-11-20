"""Regression tests for the cross-repo environment variable reference (#1638)."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOC = ROOT / 'docs' / 'ENVIRONMENT_VARIABLES.md'


def required_vars_from_env_example(relative_path):
    """Extract variables from the REQUIRED VARIABLES block of an example file."""
    lines = (ROOT / relative_path).read_text(encoding='utf-8').splitlines()
    in_required = False
    names = set()
    for line in lines:
        if 'REQUIRED VARIABLES' in line:
            in_required = True
            continue
        if 'OPTIONAL VARIABLES' in line:
            break
        if in_required:
            match = re.match(r'^([A-Z][A-Z0-9_]*)=', line)
            if match:
                names.add(match.group(1))
    if not names:
        raise AssertionError(f'no REQUIRED VARIABLES found in {relative_path}')
    return names


def required_bot_vars():
    text = (ROOT / 'bot' / 'DEPLOYMENT.md').read_text(encoding='utf-8')
    return set(re.findall(r'^\| `([A-Z][A-Z0-9_]*)` \| ✅ \|', text, re.MULTILINE))


def workflow_secrets():
    secrets = set()
    for path in (ROOT / '.github' / 'workflows').glob('*.y*ml'):
        secrets.update(re.findall(r'secrets\.([A-Z][A-Z0-9_]+)',
                                  path.read_text(encoding='utf-8')))
    # Provided automatically by GitHub Actions; not a repository setting.
    secrets.discard('GITHUB_TOKEN')
    return secrets


class EnvironmentDocsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = DOC.read_text(encoding='utf-8')

    def assert_documented(self, names, source):
        for name in sorted(names):
            with self.subTest(variable=name):
                self.assertIn(f'`{name}`', self.content,
                              f'{name} is required by {source} but missing from {DOC.name}')

    def test_web_required_variables_are_documented(self):
        self.assert_documented(
            required_vars_from_env_example('web/.env.example'), 'web/.env.example')

    def test_api_required_variables_are_documented(self):
        self.assert_documented(
            required_vars_from_env_example('api/.env.example'), 'api/.env.example')

    def test_bot_required_variables_are_documented(self):
        self.assert_documented(required_bot_vars(), 'bot/DEPLOYMENT.md')

    def test_workflow_secrets_are_documented(self):
        self.assert_documented(workflow_secrets(), 'GitHub workflows')

    def test_docs_index_links_the_reference(self):
        index = (ROOT / 'docs' / 'README.md').read_text(encoding='utf-8')
        self.assertIn('ENVIRONMENT_VARIABLES.md', index)

    def test_stale_variable_names_are_removed_from_setup_docs(self):
        stale = ('NEXT_PUBLIC_CONTRACT_ID', 'NEXT_PUBLIC_CONTRACT_ADDRESS',
                 'NEXT_PUBLIC_TOKEN_ID', 'NEXT_PUBLIC_NETWORK_PASSPHRASE',
                 'NEXT_PUBLIC_STACKS_API_URL', 'SLACK_WEBHOOK_URL',
                 'DISCORD_WEBHOOK_URL')
        paths = ('docs/deployment.md', 'docs/local-runbook.md',
                 'docs/preview-deployments.md', 'docs/deployments/testnet.md')
        for relative_path in paths:
            text = (ROOT / relative_path).read_text(encoding='utf-8')
            for name in stale:
                with self.subTest(path=relative_path, variable=name):
                    self.assertNotIn(name, text)


if __name__ == '__main__':
    unittest.main()
