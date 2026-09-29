#!/usr/bin/env python3
"""
CI check to verify that every GitHub workflow file in .github/workflows/
declares explicit top-level 'permissions:' and 'concurrency:' blocks (#1168, #1169).
"""

import sys
from pathlib import Path
import re

WORKFLOWS_DIR = Path(__file__).resolve().parent.parent / '.github' / 'workflows'

def check_workflows():
    if not WORKFLOWS_DIR.is_dir():
        print(f"Error: Workflows directory not found at {WORKFLOWS_DIR}", file=sys.stderr)
        return 1

    workflow_files = sorted(
        list(WORKFLOWS_DIR.glob('*.yml')) + list(WORKFLOWS_DIR.glob('*.yaml'))
    )

    if not workflow_files:
        print("Error: No workflow files found.", file=sys.stderr)
        return 1

    failed = False
    print(f"Checking {len(workflow_files)} workflow files in {WORKFLOWS_DIR.relative_to(WORKFLOWS_DIR.parent.parent)}...")

    for wf in workflow_files:
        content = wf.read_text(encoding='utf-8')
        rel_path = wf.name

        # Check for top-level permissions: (at start of line, no leading spaces)
        has_permissions = bool(re.search(r'^[ \t]*permissions:', content, re.MULTILINE))
        # Check for top-level concurrency: (at start of line, no leading spaces)
        has_concurrency = bool(re.search(r'^[ \t]*concurrency:', content, re.MULTILINE))

        errors = []
        if not has_permissions:
            errors.append("missing 'permissions:' block")
        if not has_concurrency:
            errors.append("missing 'concurrency:' block")

        if errors:
            print(f"  [FAIL] {rel_path}: {', '.join(errors)}", file=sys.stderr)
            failed = True
        else:
            print(f"  [PASS] {rel_path}")

    if failed:
        print("\nWorkflow verification failed. Every workflow must declare top-level 'permissions:' and 'concurrency:' blocks.", file=sys.stderr)
        return 1

    print("\nAll workflows pass permissions and concurrency checks.")
    return 0

if __name__ == '__main__':
    sys.exit(check_workflows())
