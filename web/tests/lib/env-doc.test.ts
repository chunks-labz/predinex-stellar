import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLIENT_SAFE_RUNTIME_ENV_KEYS } from '../../app/lib/env-boundary';

/**
 * #1308 — keeps `web/.env.example` in sync with the code that reads env vars.
 *
 * Before this check, a variable could be added to the app and never documented:
 * the example file was a hand-maintained list, so a fresh setup silently fell
 * back to whatever default the code chose. These assertions fail CI when that
 * happens, which is what makes the example file a source of truth rather than
 * a suggestion.
 */

const ENV_EXAMPLE_RELATIVE_PATH = path.join('.env.example');
const SOURCE_ROOTS = ['app', 'lib', 'components', 'providers'];
const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// Supplied by the build/runtime platform, not by the operator, so they are
// deliberately absent from .env.example. Documenting them would be misleading:
// setting NODE_ENV by hand does not work.
const PLATFORM_PROVIDED_KEYS = new Set(['NODE_ENV', 'CI', 'VERCEL_URL', 'VERCEL_ENV']);

// Matches `process.env.FOO`, `process.env?.FOO` and `process.env['FOO']`.
const ENV_ACCESS_PATTERN =
  /process\.env\??\.([A-Z0-9_]+)|process\.env\??\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g;

const IGNORED_PATH_SEGMENTS = ['node_modules', '.next', 'out', 'build'];

function isTestFile(filePath: string): boolean {
  return (
    filePath.includes(`${path.sep}__tests__${path.sep}`) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
  );
}

function walkSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_PATH_SEGMENTS.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name)) && !isTestFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectReferencedEnvKeys(webRoot: string): Set<string> {
  const keys = new Set<string>();

  for (const root of SOURCE_ROOTS) {
    const rootPath = path.join(webRoot, root);
    if (!fs.existsSync(rootPath)) continue;

    for (const filePath of walkSourceFiles(rootPath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(ENV_ACCESS_PATTERN)) {
        const key = match[1] ?? match[2];
        if (key) keys.add(key);
      }
    }
  }

  return keys;
}

function readDocumentedEnvKeys(envExamplePath: string): Set<string> {
  const documented = new Set<string>();

  for (const line of fs.readFileSync(envExamplePath, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match) documented.add(match[1]);
  }

  return documented;
}

describe('web/.env.example stays in sync with the code (#1308)', () => {
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const envExamplePath = path.join(webRoot, ENV_EXAMPLE_RELATIVE_PATH);

  it('has a readable .env.example to check against', () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
  });

  it('documents every environment variable referenced in web/ source', () => {
    const referenced = collectReferencedEnvKeys(webRoot);
    const documented = readDocumentedEnvKeys(envExamplePath);

    expect(referenced.size).toBeGreaterThan(0);

    const undocumented = [...referenced]
      .filter((key) => !PLATFORM_PROVIDED_KEYS.has(key))
      .filter((key) => !documented.has(key))
      .sort();

    expect(
      undocumented,
      `Undocumented environment variable(s) in web/.env.example: ${undocumented.join(
        ', '
      )}. Add each one with a comment explaining what it controls.`
    ).toEqual([]);
  });

  it('documents every client-safe runtime key allowed to reach the browser', () => {
    const documented = readDocumentedEnvKeys(envExamplePath);

    const undocumented = [...CLIENT_SAFE_RUNTIME_ENV_KEYS]
      .filter((key) => !documented.has(key))
      .sort();

    expect(
      undocumented,
      `CLIENT_SAFE_RUNTIME_ENV_KEYS in web/app/lib/env-boundary.ts are not documented in ` +
        `web/.env.example: ${undocumented.join(
          ', '
        )}. Document them, or remove them from the allowlist if nothing reads them.`
    ).toEqual([]);
  });

  it('does not reintroduce the browser-exposed webhook signing secret (#1286)', () => {
    const documented = readDocumentedEnvKeys(envExamplePath);

    // A NEXT_PUBLIC_ secret is inlined into the browser bundle, which would let
    // anyone forge signed webhook deliveries. Only the server-only WEBHOOK_SECRET
    // is valid, and it is already documented.
    expect(documented.has('WEBHOOK_SECRET')).toBe(true);
    expect(documented.has('NEXT_PUBLIC_WEBHOOK_SECRET')).toBe(false);
    expect(CLIENT_SAFE_RUNTIME_ENV_KEYS).not.toContain('NEXT_PUBLIC_WEBHOOK_SECRET');
  });

  it('documents both mock-data switches so neither looks like the only one (#1308)', () => {
    const documented = readDocumentedEnvKeys(envExamplePath);

    expect(documented.has('NEXT_PUBLIC_ACTIVITY_FIXTURES')).toBe(true);
    expect(documented.has('NEXT_PUBLIC_ENABLE_DISPUTE_MOCK_DATA')).toBe(true);
  });
});
