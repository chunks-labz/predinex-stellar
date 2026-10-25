#!/usr/bin/env python3
"""
CI check: `SECURITY.md` must point at a working private disclosure channel.

The policy used to advertise `security@predinex.io` as the reporting address,
but the `predinex.io` domain no longer resolves, so every report bounced with
a DNS error. It also shipped placeholder PGP key blocks, placeholder
fingerprint strings and "Coming Soon" audit links, which made the policy look
complete while offering no way to report anything at all.

This check fails when the policy reintroduces a placeholder or an unreachable
contact, and when the private advisory channel is missing, so the file cannot
rot back into a dead end.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
POLICY = REPO_ROOT / "SECURITY.md"

# Placeholders and dead contacts that must not reappear in the policy.
FORBIDDEN = {
    "TO BE ADDED": "placeholder text",
    "Coming Soon": "placeholder text",
    "PGP PUBLIC KEY TO BE ADDED": "placeholder PGP key block",
    "COMMIT SIGNING KEY TO BE ADDED": "placeholder commit signing key",
    "predinex.io": "unreachable domain (the domain no longer resolves)",
    "security@": "unreachable security mailbox",
    "emergency@": "unreachable emergency mailbox",
    "press@": "unreachable press mailbox",
    "hello@": "unreachable general mailbox",
}

# The private channel the policy has to document.
REQUIRED = {
    "security/advisories/new": "link to the private GitHub advisory form",
}


def main() -> int:
    if not POLICY.exists():
        print(f"::error file={POLICY.name}::SECURITY.md is missing")
        return 1

    text = POLICY.read_text(encoding="utf-8")
    errors: list[str] = []

    for needle, reason in FORBIDDEN.items():
        if needle in text:
            errors.append(f"contains {reason}: '{needle}'")

    for needle, reason in REQUIRED.items():
        if needle not in text:
            errors.append(f"is missing the {reason} ('{needle}')")

    if errors:
        print(f"::error file={POLICY.name}::SECURITY.md is not a working disclosure policy:")
        for error in errors:
            print(f"  - {error}")
        print(
            "  Point reporters at the private GitHub advisory form and remove "
            "placeholder or unreachable contacts."
        )
        return 1

    print("✓ SECURITY.md documents a private disclosure channel")
    return 0


if __name__ == "__main__":
    sys.exit(main())
