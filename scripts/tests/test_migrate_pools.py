import sys
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[2]))  # allow importing scripts/migrate_pools

from migrate_pools import validate_pool_id, plan_migration, main


def test_validate_pool_id_accepts_good_ids():
    assert validate_pool_id("pool123")
    assert validate_pool_id("A_B-9")


def test_validate_pool_id_rejects_bad_ids():
    assert not validate_pool_id("ab")
    assert not validate_pool_id("invalid id with spaces")


def test_plan_migration_steps_count():
    plan = plan_migration("poolA", "poolB", "USD", 100.0)
    assert isinstance(plan, list)
    assert len(plan) >= 4


def test_main_default_dry_run_returns_0(tmp_path, capsys):
    # default is dry-run, should return 0 and not require --confirm
    rc = main(["--source", "srcpool", "--target", "dstpool", "--asset", "USD", "--amount", "1.5"])
    assert rc == 0


def test_main_requires_confirm_when_not_dry_run():
    rc = main(["--source", "srcpool", "--target", "dstpool", "--asset", "USD", "--amount", "1.5", "--no-dry-run"])
    assert rc == 3
