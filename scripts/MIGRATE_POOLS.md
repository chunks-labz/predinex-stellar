# migrate_pools.py

Safe scaffold for migrating assets between lending pools.

Security measures included in this scaffold:
- Default `--dry-run` mode (no changes applied)
- `--no-dry-run` must be explicitly provided to allow applying
- `--confirm` flag is required to actually apply changes when `--no-dry-run` is used
- Basic pool id validation to avoid accidental execution on malformed identifiers

Usage examples:

Dry-run (default):

```bash
python3 scripts/migrate_pools.py --source srcpool --target dstpool --asset USD --amount 10
```

Apply (dangerous — requires both flags):

```bash
python3 scripts/migrate_pools.py --source srcpool --target dstpool --asset USD --amount 10 --no-dry-run --confirm
```

Notes:
- This is a scaffold and does not perform on-chain operations. Replace `apply_plan` with an audited implementation.
- Add integration tests and benchmarks before using in production.
