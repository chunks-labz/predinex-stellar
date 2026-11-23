"""Tests for the migration rollback dry run, scripts/verify-migrations.sh (#1663).

The static checks run everywhere. The database checks need a scratch Postgres:
set PREDINEX_TEST_DATABASE_URL to a server URL whose user may create databases
(each test gets its own throwaway database). Without it they are skipped.
"""

import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

SCRIPT = Path(__file__).resolve().parents[1] / 'verify-migrations.sh'
SERVER_URL = os.environ.get('PREDINEX_TEST_DATABASE_URL')


def run(migrations_dir, *args, database_url=None):
    env = {**os.environ, 'MIGRATIONS_DIR': str(migrations_dir)}
    env.pop('DATABASE_URL', None)
    if database_url:
        env['DATABASE_URL'] = database_url
    return subprocess.run(
        ['bash', str(SCRIPT), *args], env=env, capture_output=True, text=True, check=False)


class MigrationsDir:
    def __init__(self):
        self.path = Path(tempfile.mkdtemp(prefix='migrations-'))

    def add(self, name, up=None, down=None):
        if up is not None:
            (self.path / f'{name}.up.sql').write_text(up)
        if down is not None:
            (self.path / f'{name}.down.sql').write_text(down)
        return self

    def cleanup(self):
        shutil.rmtree(self.path, ignore_errors=True)


class StaticChecks(unittest.TestCase):
    def setUp(self):
        self.dir = MigrationsDir()
        self.addCleanup(self.dir.cleanup)

    def lint(self):
        return run(self.dir.path, '--lint-only')

    def test_paired_migrations_pass(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', 'DROP TABLE a;')
        self.dir.add('002_b', 'CREATE TABLE b (id int);', '-- undo\nDROP TABLE b;')
        result = self.lint()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('static checks passed for 2 migration(s)', result.stdout)

    def test_missing_down_file_fails(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);')
        result = self.lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: missing rollback file 001_a.down.sql', result.stderr)

    def test_down_file_without_sql_fails(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', '-- TODO\n\n   \n')
        result = self.lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: rollback file 001_a.down.sql has no SQL statements', result.stderr)

    def test_orphan_down_file_fails(self):
        self.dir.add('001_a', down='DROP TABLE a;')
        result = self.lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: rollback file has no matching 001_a.up.sql', result.stderr)

    def test_irreversible_marker_fails(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', '-- irreversible: data is dropped\nSELECT 1;')
        result = self.lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: 001_a.down.sql is marked irreversible', result.stderr)

    def test_reports_every_problem_at_once(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);')
        self.dir.add('002_b', 'CREATE TABLE b (id int);', '')
        result = self.lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: missing rollback file', result.stderr)
        self.assertIn('002_b: rollback file 002_b.down.sql has no SQL statements', result.stderr)

    def test_database_url_required_without_lint_only(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', 'DROP TABLE a;')
        result = run(self.dir.path)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DATABASE_URL must point at the scratch database', result.stderr)

    def test_repository_migrations_pass_static_checks(self):
        repo_migrations = SCRIPT.parents[1] / 'db' / 'migrations'
        result = run(repo_migrations, '--lint-only')
        self.assertEqual(result.returncode, 0, result.stderr)


@unittest.skipUnless(SERVER_URL and shutil.which('psql') and shutil.which('pg_dump'),
                     'set PREDINEX_TEST_DATABASE_URL (and install psql/pg_dump) to run')
class DatabaseChecks(unittest.TestCase):
    def setUp(self):
        self.dir = MigrationsDir()
        self.addCleanup(self.dir.cleanup)
        self.db = f'mig_{uuid.uuid4().hex[:12]}'
        subprocess.run(['psql', '-q', SERVER_URL, '-c', f'CREATE DATABASE {self.db}'], check=True)
        self.addCleanup(subprocess.run,
                        ['psql', '-q', SERVER_URL, '-c', f'DROP DATABASE IF EXISTS {self.db}'],
                        check=False)
        parts = urlsplit(SERVER_URL)
        self.url = urlunsplit(parts._replace(path=f'/{self.db}'))

    def dry_run(self):
        return run(self.dir.path, database_url=self.url)

    def test_reversible_migrations_pass(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', 'DROP TABLE a;')
        self.dir.add('002_b', 'CREATE INDEX a_id ON a (id);', 'DROP INDEX a_id;')
        result = self.dry_run()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ok  001_a: up, down and re-up', result.stdout)
        self.assertIn('ok  002_b: up, down and re-up', result.stdout)
        self.assertIn('rollback dry run passed for 2 migration(s)', result.stdout)

    def test_incomplete_rollback_names_the_migration(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', 'DROP TABLE a;')
        self.dir.add('002_b', 'CREATE TABLE b (id int); CREATE TABLE c (id int);', 'DROP TABLE b;')
        result = self.dry_run()
        self.assertEqual(result.returncode, 1)
        self.assertIn('002_b: rolling back did not restore the schema', result.stderr)
        self.assertIn('ok  001_a', result.stdout)

    def test_failing_down_step_fails(self):
        self.dir.add('001_a', 'CREATE TABLE a (id int);', 'DROP TABLE does_not_exist;')
        result = self.dry_run()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: down step failed', result.stderr)

    def test_down_step_that_blocks_a_rerun_fails(self):
        # The down step drops the table but leaves the sequence behind, so the
        # schema differs and a re-run of the up step would collide.
        self.dir.add('001_a',
                     'CREATE SEQUENCE a_seq; CREATE TABLE a (id int DEFAULT nextval(\'a_seq\'));',
                     'DROP TABLE a;')
        result = self.dry_run()
        self.assertEqual(result.returncode, 1)
        self.assertIn('001_a: rolling back did not restore the schema', result.stderr)


if __name__ == '__main__':
    unittest.main()
