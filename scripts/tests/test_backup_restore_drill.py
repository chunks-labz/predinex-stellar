"""Tests for the backup restore drill script, scripts/drill-backup-restore.sh (#1688).

Phase 1 static checks run anywhere without a database.
Phase 2 database checks run when PREDINEX_TEST_DATABASE_URL is set and psql is installed.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

SCRIPT = Path(__file__).resolve().parents[1] / 'drill-backup-restore.sh'
FIXTURE = Path(__file__).resolve().parents[2] / 'db' / 'fixtures' / 'latest_backup.sql'
SERVER_URL = os.environ.get('PREDINEX_TEST_DATABASE_URL')


def run_drill(*args, database_url=None, fixture=None):
    cmd = ['bash', str(SCRIPT)]
    if fixture:
        cmd.extend(['--fixture', str(fixture)])
    cmd.extend(args)
    env = {**os.environ}
    env.pop('DATABASE_URL', None)
    if database_url:
        env['DATABASE_URL'] = database_url
    return subprocess.run(cmd, env=env, capture_output=True, text=True, check=False)


class StaticChecks(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp(prefix='backup-drill-'))
        self.addCleanup(lambda: shutil.rmtree(self.temp_dir, ignore_errors=True))

    def create_fixture(self, content):
        path = self.temp_dir / 'test_backup.sql'
        path.write_text(content, encoding='utf-8')
        return path

    def test_repository_fixture_passes_static_checks(self):
        self.assertTrue(FIXTURE.is_file(), f"Expected fixture file at {FIXTURE}")
        result = run_drill('--lint-only', fixture=FIXTURE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Static checks passed", result.stdout)

    def test_missing_fixture_fails(self):
        non_existent = self.temp_dir / 'does_not_exist.sql'
        result = run_drill('--lint-only', fixture=non_existent)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Backup fixture file not found", result.stderr)

    def test_empty_fixture_fails(self):
        fixture = self.create_fixture("")
        result = run_drill('--lint-only', fixture=fixture)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Backup fixture file is empty", result.stderr)

    def test_missing_table_definition_fails(self):
        # Missing pools table
        content = """
        CREATE TABLE migration_probe (id int primary key, marker text);
        INSERT INTO migration_probe VALUES (1, 'ok');
        CREATE TABLE indexer_state (id serial primary key, indexed_ledger bigint, cursor text);
        INSERT INTO indexer_state VALUES (1, 100, 'cur');
        CREATE TABLE bets (id serial primary key, pool_id bigint, amount bigint);
        INSERT INTO bets VALUES (1, 1, 100);
        CREATE TABLE claims (id serial primary key, pool_id bigint, amount bigint);
        INSERT INTO claims VALUES (1, 1, 100);
        """
        fixture = self.create_fixture(content)
        result = run_drill('--lint-only', fixture=fixture)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing table definition: pools", result.stderr)

    def test_missing_insert_rows_fails(self):
        # Has pools table but no INSERT
        content = """
        CREATE TABLE migration_probe (id int primary key, marker text);
        INSERT INTO migration_probe VALUES (1, 'ok');
        CREATE TABLE indexer_state (id serial primary key, indexed_ledger bigint, cursor text);
        INSERT INTO indexer_state VALUES (1, 100, 'cur');
        CREATE TABLE pools (id bigint primary key, status text);
        CREATE TABLE bets (id serial primary key, pool_id bigint, amount bigint);
        INSERT INTO bets VALUES (1, 1, 100);
        CREATE TABLE claims (id serial primary key, pool_id bigint, amount bigint);
        INSERT INTO claims VALUES (1, 1, 100);
        """
        fixture = self.create_fixture(content)
        result = run_drill('--lint-only', fixture=fixture)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing representative INSERT rows for table: pools", result.stderr)

    def test_unknown_cli_argument_fails(self):
        result = run_drill('--bogus-flag')
        self.assertEqual(result.returncode, 2)
        self.assertIn("unknown argument", result.stderr)

    def test_fixture_flag_without_argument_fails(self):
        result = run_drill('--fixture')
        self.assertEqual(result.returncode, 2)
        self.assertIn("--fixture requires a file path argument", result.stderr)

    def test_database_url_required_without_lint_only(self):
        result = run_drill(fixture=FIXTURE)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DATABASE_URL must point to the target database", result.stderr)


@unittest.skipUnless(SERVER_URL and shutil.which('psql'),
                     'set PREDINEX_TEST_DATABASE_URL and install psql to run database restore tests')
class DatabaseChecks(unittest.TestCase):
    def setUp(self):
        self.db = f'drill_{uuid.uuid4().hex[:12]}'
        subprocess.run(['psql', '-q', SERVER_URL, '-c', f'CREATE DATABASE {self.db}'], check=True)
        self.addCleanup(subprocess.run,
                         ['psql', '-q', SERVER_URL, '-c', f'DROP DATABASE IF EXISTS {self.db}'],
                         check=False)
        parts = urlsplit(SERVER_URL)
        self.url = urlunsplit(parts._replace(path=f'/{self.db}'))

    def test_restore_drill_succeeds_with_fixture(self):
        result = run_drill(fixture=FIXTURE, database_url=self.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BACKUP RESTORE DRILL SUCCESS", result.stdout)
        self.assertIn("Verified tables:", result.stdout)
        self.assertIn("Total pools restored:", result.stdout)


if __name__ == '__main__':
    unittest.main()
