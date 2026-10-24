#!/usr/bin/env python3
"""
CI check: every `#[test]` a crate declares in its `src/` must be compiled and
listed by `cargo test` (#1305).

Rust only compiles modules that are declared. A test module that is never
registered is invisible twice over: the compiler never sees it, and the test
runner never lists it, so `cargo test --workspace` reports success while the
crate contributes zero tests. `contracts/pool` shipped that way for its entire
life — a `src/test.rs` plus a `src/test/` directory, 1554 lines of tests, a
`testutils` dev-dependency paid for, and a CI step that read as if the crate was
covered.

This check counts the tests a crate declares in its source and compares that
against the number `cargo test -- --list` reports. Declared > listed means some
tests are outside the module graph, which is the failure this issue is about.

Two things it deliberately does not do:

  * Require tests. A crate that declares none is reported and skipped, so
    "every crate must have tests" is not the assertion here. The assertion is
    "tests you wrote must be the tests that run".

  * Report a build failure as a test-coverage failure. If a crate does not
    compile, `cargo test -- --list` cannot produce a list, and reporting that
    as "0 of 562 tests compiled" would blame undeclared modules for a type
    error. Such a crate is reported as unbuildable and skipped: it is already
    as loud as it gets, and `cargo test --workspace` fails on it in the same
    job. The declared count is still printed, so the tests waiting behind the
    build error stay visible.
"""

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

TEST_ATTR_RE = re.compile(r'#\s*\[\s*test\s*\]')
# A listed test looks like `module::path::name: test`.
LISTED_TEST_RE = re.compile(r':\s*test$')
PACKAGE_NAME_RE = re.compile(r'^\s*name\s*=\s*"([^"]+)"', re.MULTILINE)
RAW_STRING_RE = re.compile(r'r(#*)"')
CHAR_LITERAL_RE = re.compile(r"'(\\.|[^\\'])'")
BYTE_CHAR_LITERAL_RE = re.compile(r"b'(\\.|[^\\'])'")


def count_test_attrs(text: str) -> int:
    """Counts `#[test]` attributes that are real code.

    Comments and literals are skipped, so a commented-out or quoted `#[test]`
    cannot inflate the total and fail this check against a suite that is fine.
    Regex-based comment stripping is not usable here: deleting comments first
    leaves quotes unbalanced in any line containing a `//` inside a string
    (`"https://..."`), and the string pass then pairs off across the rest of
    the file and deletes real code. This walks the source instead, tracking
    line comments, nested block comments, strings, raw strings and char
    literals, and only counts attributes in between.
    """
    count = 0
    index = 0
    length = len(text)

    while index < length:
        char = text[index]

        if char == '/' and text.startswith('//', index):
            newline = text.find('\n', index)
            index = length if newline == -1 else newline
            continue

        if char == '/' and text.startswith('/*', index):
            depth = 1
            index += 2
            while index < length and depth:
                if text.startswith('/*', index):
                    depth += 1
                    index += 2
                elif text.startswith('*/', index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            continue

        if char == 'r' and (match := RAW_STRING_RE.match(text, index)):
            terminator = '"' + match.group(1)
            end = text.find(terminator, match.end())
            index = length if end == -1 else end + len(terminator)
            continue

        if char == '"':
            index = _skip_string(text, index)
            continue

        if char == 'b' and (match := BYTE_CHAR_LITERAL_RE.match(text, index)):
            index = match.end()
            continue

        if char == "'" and (match := CHAR_LITERAL_RE.match(text, index)):
            index = match.end()
            continue

        if char == '#' and (match := TEST_ATTR_RE.match(text, index)):
            count += 1
            index = match.end()
            continue

        index += 1

    return count


def _skip_string(text: str, index: int) -> int:
    """Returns the index just past the string literal opening at `index`."""
    index += 1
    length = len(text)
    while index < length:
        if text[index] == '\\':
            index += 2
            continue
        if text[index] == '"':
            return index + 1
        index += 1
    return length


def declared_test_count(src_dir: Path) -> int:
    """Number of `#[test]` attributes in a crate's `src/` tree."""
    total = 0
    for path in sorted(src_dir.rglob('*.rs')):
        try:
            source = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        total += count_test_attrs(source)
    return total


def package_name(crate_dir: Path) -> str | None:
    """The crate's cargo package name.

    Read from `Cargo.toml` rather than assumed from the directory name: two
    members here are `stellar-lend/contracts/hello-world` (package
    `stellar-lend-hello-world`) and `stellar-lend/contracts/compliance` (package
    `stellar-lend-compliance`). `cargo test -p <dirname>` rejects those names,
    so a directory-derived lookup silently reports "0 tests ran" for both.
    """
    manifest = crate_dir / 'Cargo.toml'
    if not manifest.is_file():
        return None
    try:
        text = manifest.read_text(encoding='utf-8')
    except (OSError, UnicodeDecodeError):
        return None
    match = PACKAGE_NAME_RE.search(text)
    return match.group(1) if match else None


def listed_test_count(package: str) -> int | None:
    """Tests `cargo test` lists for a package, or None if it does not build.

    `--list` builds the test binaries, so a crate that fails to compile exits
    non-zero and prints no test names. The two cases are kept apart because
    only the second is a missing-module problem.
    """
    result = subprocess.run(
        ['cargo', 'test', '-p', package, '--', '--list'],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return sum(1 for line in result.stdout.splitlines() if LISTED_TEST_RE.search(line))


def crate_dirs(only: list[str]) -> list[Path]:
    """Crates to check.

    With no arguments, every crate declared as a workspace member in the root
    Cargo.toml is checked. Passing explicit crate directories narrows the scope.
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

    text = cargo_toml.read_text(encoding='utf-8')
    match = re.search(r'members\s*=\s*\[(.*?)\]', text, re.DOTALL)
    if not match:
        return []

    crates = []
    for member in re.findall(r'"([^"]+)"', match.group(1)):
        crate_dir = (REPO_ROOT / member).resolve()
        if (crate_dir / 'Cargo.toml').is_file():
            crates.append(crate_dir)
    return crates


def main() -> int:
    crates = crate_dirs(sys.argv[1:])
    if not crates:
        print('No workspace crates found; nothing to verify.')
        return 0

    short: list[tuple[str, int, int]] = []
    unbuildable: list[tuple[str, int]] = []

    for crate_dir in sorted(crates):
        src_dir = crate_dir / 'src'
        if not src_dir.is_dir():
            continue

        package = package_name(crate_dir)
        if package is None:
            print(f'Error: no package name in {(crate_dir / "Cargo.toml")}')
            return 2

        declared = declared_test_count(src_dir)
        if declared == 0:
            print(f'{package}: no tests declared')
            continue

        ran = listed_test_count(package)
        if ran is None:
            print(f'{package}: SKIPPED, does not build ({declared} test(s) declared, 0 listed)')
            unbuildable.append((package, declared))
            continue

        print(f'{package}: {ran}/{declared} tests compiled and listed')
        if ran < declared:
            short.append((package, declared, ran))

    if short:
        print()
        print('Error: tests are declared in source but never compiled:')
        for package, declared, ran in short:
            print(
                f' - {package}: {declared} declared, {ran} listed '
                f'({declared - ran} unreachable)'
            )
        print()
        print('Rust only builds modules that are declared, so a test behind an')
        print('undeclared module is invisible to both the compiler and the test')
        print('runner, and `cargo test --workspace` still reports success. Either')
        print('declare the test module in lib.rs, or delete the dead copy.')
        print('See #1305, and `python3 scripts/verify-module-declarations.py` for')
        print('the companion check that finds undeclared source files.')
        return 1

    if unbuildable:
        print()
        print('Note: the following crates declare tests but do not build, so none')
        print('of them can be listed. This is a compile error, not a missing module')
        print('declaration, and `cargo test --workspace` fails on them in this job:')
        for package, declared in unbuildable:
            print(f' - {package}: {declared} test(s) waiting on a successful build')

    return 0


if __name__ == '__main__':
    sys.exit(main())
