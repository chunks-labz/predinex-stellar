#!/usr/bin/env python3
"""
CI check: every Rust source file under a crate's `src/` must be reachable from
that crate's root via a `mod` declaration (#1310).

Rust only compiles modules that are declared. A file sitting in `src/` with no
`mod` declaration anywhere is silently excluded from the build: it never
compiles, never runs, and never breaks, so it cannot surface as a CI failure.
That is how `contracts/pool` ended up with three copies of its tests — an
inline `#[cfg(test)] mod test` in `contract.rs` that was actually registered,
plus an unregistered `src/test.rs` and an unregistered `src/test/` directory,
none of which agreed with each other or with the implementation.

This check fails when a `.rs` file is not reachable from the crate root, so an
unregistered file can be caught in review instead of rotting.

Reachability is computed by following `mod` declarations from the crate root
(`src/lib.rs` or `src/main.rs`), honouring the Rust 2018+ module layout:

    mod foo;            -> src/foo.rs   or  src/foo/mod.rs
    mod foo { .. }      -> inline; the parent file is reachable, not a new one
    #[path = "x.rs"]    -> src/x.rs
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Matches `mod name;` / `mod name {` and captures an optional preceding
# #[path = "..."] attribute so explicit paths are honoured.
MOD_RE = re.compile(
    r'(?:#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]\s*)?'
    r'\b(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*(;|\{)',
    re.MULTILINE,
)


def strip_comments_and_strings(text: str) -> str:
    """Removes line/block comments and string literals so matches are real code."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    text = re.sub(r'//[^\n]*', '', text)
    text = re.sub(r'r#*".*?"#*', '""', text, flags=re.DOTALL)
    text = re.sub(r'"(\\.|[^"\\])*"', '""', text)
    return text


def declared_targets(source: str, module_dir: Path) -> list[Path]:
    """Resolves every `mod` declaration in `source` to candidate file paths."""
    targets: list[Path] = []
    for path_attr, name, terminator in MOD_RE.findall(source):
        if terminator == '{':
            # Inline module: the contents live in this same file, so there is no
            # separate file to reach.
            continue
        if path_attr:
            targets.append((module_dir / path_attr).resolve())
            continue
        targets.append((module_dir / f'{name}.rs').resolve())
        targets.append((module_dir / name / 'mod.rs').resolve())
    return targets


def walk_crate(crate_root: Path) -> tuple[set[Path], set[Path]]:
    """Returns (reachable, all_source_files) for a crate, or empty sets if it
    is not a Rust library/bin crate."""
    src_dir = crate_root / 'src'
    if not src_dir.is_dir():
        return set(), set()

    all_files = {p.resolve() for p in src_dir.rglob('*.rs')}

    roots = [p for p in (src_dir / 'lib.rs', src_dir / 'main.rs') if p.is_file()]
    if not roots:
        return set(), all_files

    reachable: set[Path] = set()
    queue: list[Path] = [p.resolve() for p in roots]

    while queue:
        current = queue.pop()
        if current in reachable or not current.is_file():
            continue
        reachable.add(current)

        try:
            source = strip_comments_and_strings(current.read_text(encoding='utf-8'))
        except (OSError, UnicodeDecodeError):
            # A file we cannot read is not something this check can judge.
            continue

        for target in declared_targets(source, current.parent):
            if target.is_file() and target not in reachable:
                queue.append(target)

    return reachable, all_files


def crate_dirs(only: list[str]) -> list[Path]:
    """Crates to check.

    With no arguments, every crate declared as a workspace member in the root
    Cargo.toml is checked. Passing explicit crate directories narrows the scope,
    which is how CI currently limits this to the crates that have been audited.
    """
    if only:
        crates: list[Path] = []
        for entry in only:
            crate_dir = (REPO_ROOT / entry).resolve()
            if not (crate_dir / 'Cargo.toml').is_file():
                print(f'Error: not a crate directory: {entry}')
                sys.exit(2)
            crates.append(crate_dir)
        return crates

    cargo_toml = REPO_ROOT / 'Cargo.toml'
    if not cargo_toml.is_file():
        return []

    members: list[str] = []
    in_members = False
    for line in cargo_toml.read_text(encoding='utf-8').splitlines():
        stripped = line.strip()
        if stripped.startswith('members'):
            in_members = True
            remainder = stripped.partition('=')[2]
            if remainder.strip().startswith('['):
                remainder = remainder.partition('[')[2]
            members.append(remainder)
            continue
        if in_members:
            members.append(line)
            if ']' in line:
                break

    crates = []
    for chunk in ''.join(members).split(']')[0].split('['):
        for match in re.finditer(r'"([^"]+)"', chunk):
            crate_dir = (REPO_ROOT / match.group(1)).resolve()
            if (crate_dir / 'Cargo.toml').is_file():
                crates.append(crate_dir)
    return crates


def main() -> int:
    crates = crate_dirs(sys.argv[1:])
    if not crates:
        print('No workspace crates found; nothing to verify.')
        return 0

    orphans: list[tuple[Path, Path]] = []
    total_reachable = 0

    for crate_dir in sorted(crates):
        reachable, all_files = walk_crate(crate_dir)
        if not all_files:
            continue
        total_reachable += len(reachable)
        for orphan in sorted(all_files - reachable):
            orphans.append((crate_dir, orphan))

    if orphans:
        print('Error: Rust source files not reachable from their crate root:')
        for crate_dir, orphan in orphans:
            rel = orphan.relative_to(REPO_ROOT)
            print(f' - {rel}  (crate: {crate_dir.relative_to(REPO_ROOT)})')
        print()
        print('Rust only builds modules that are declared, so these files are')
        print('never compiled and never run. Either register them, or delete them')
        print('if they are dead copies. See #1310.')
        return 1

    print(
        f'All Rust source files across {len(crates)} workspace crates are '
        f'reachable from their crate root ({total_reachable} files).'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
