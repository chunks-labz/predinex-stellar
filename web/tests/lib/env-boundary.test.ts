import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertClientEnvAccessIsSafe,
  CLIENT_SAFE_RUNTIME_ENV_KEYS,
  DEPRECATED_RUNTIME_ENV_ALIASES,
} from '../../app/lib/env-boundary';

const CLIENT_SOURCE_ROOTS = ['app', 'lib'];
const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Matches an assignment at the start of a line, ignoring comments, so
// NEXT_PUBLIC_FOO=<value> in the example is the only thing that counts as
// "documented" and a mention inside prose does not satisfy the check.
const ENV_ASSIGNMENT_PATTERN = /^([A-Z0-9_]+)=/gm;

// Next.js App Router route handlers run only on the server and are never bundled
// for the browser, so reading server-only env there is correct. The guard exists
// to protect client bundles, so these are excluded (#1286: the webhook dispatch
// route reads WEBHOOK_SECRET, which is exactly what it should do).
const SERVER_ONLY_PATH_SEGMENTS = [path.join('app', 'api')];
// Matches both:
// - process.env.MY_KEY
// - process.env?.MY_KEY
const ENV_ACCESS_PATTERN = /process\.env\??\.([A-Z0-9_]+)/g;

function isServerOnly(filePath: string): boolean {
  return SERVER_ONLY_PATH_SEGMENTS.some((segment) => filePath.includes(segment));
}

function walkSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name)) && !isServerOnly(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectClientEnvAccesses(webRoot: string): string[] {
  const accesses: string[] = [];
  for (const root of CLIENT_SOURCE_ROOTS) {
    const rootPath = path.join(webRoot, root);
    if (!fs.existsSync(rootPath)) continue;

    for (const filePath of walkSourceFiles(rootPath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const match of content.matchAll(ENV_ACCESS_PATTERN)) {
        accesses.push(match[1]);
      }
    }
  }
  return accesses;
}

function collectDocumentedEnvKeys(webRoot: string): Set<string> {
  const examplePath = path.join(webRoot, '.env.example');
  expect(
    fs.existsSync(examplePath),
    'web/.env.example is missing — it is the documented source of truth for runtime env'
  ).toBe(true);

  const content = fs.readFileSync(examplePath, 'utf8');
  return new Set([...content.matchAll(ENV_ASSIGNMENT_PATTERN)].map((match) => match[1]));
}

describe('env boundary guardrails', () => {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);
  const webRoot = path.resolve(currentDirPath, '..', '..');

  it('allows only documented public runtime config keys in client source', () => {
    const accessedEnvKeys = collectClientEnvAccesses(webRoot);
    expect(accessedEnvKeys.length).toBeGreaterThan(0);
    expect(() => assertClientEnvAccessIsSafe(accessedEnvKeys)).not.toThrow();
  });

  it('documents the public runtime keys that are safe to expose', () => {
    expect(CLIENT_SAFE_RUNTIME_ENV_KEYS).toMatchInlineSnapshot(`
      [
        "NEXT_PUBLIC_ACTIVITY_FIXTURES",
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_APP_VERSION",
        "NEXT_PUBLIC_CONTRACT_ADDRESS",
        "NEXT_PUBLIC_CONTRACT_NAME",
        "NEXT_PUBLIC_DISABLE_TELEMETRY",
        "NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER",
        "NEXT_PUBLIC_NETWORK",
        "NEXT_PUBLIC_PREDINEX_ALLOWED_EMBED_ORIGIN",
        "NEXT_PUBLIC_SOROBAN_CONTRACT_ID",
        "NEXT_PUBLIC_SOROBAN_RPC_URL",
        "NEXT_PUBLIC_TOKEN_NAME",
        "NEXT_PUBLIC_TOKEN_SYMBOL",
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
        "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
        "NEXT_PUBLIC_WEBHOOK_ENABLED",
        "NEXT_PUBLIC_WEBHOOK_URL",
      ]
    `);
  });

  // #1308 — a key that the app reads but that is absent from .env.example is
  // invisible to anyone auditing a deployment's environment, so it silently
  // takes whatever default runtime-config picks. Driven off the allowlist so the
  // allowlist stays the single source of truth: add a key there and this fails
  // until it is documented, remove one and it drops out of scope.
  it('documents every client-safe runtime env key in .env.example', () => {
    const documentedKeys = collectDocumentedEnvKeys(webRoot);
    const undocumented = CLIENT_SAFE_RUNTIME_ENV_KEYS.filter((key) => !documentedKeys.has(key));

    expect(
      undocumented,
      `These keys are readable by the browser bundle but missing from web/.env.example: ${undocumented.join(', ')}`
    ).toEqual([]);
  });

  it('keeps deprecated aliases pointed at a key that is still documented', () => {
    const documentedKeys = collectDocumentedEnvKeys(webRoot);

    for (const [alias, canonical] of Object.entries(DEPRECATED_RUNTIME_ENV_ALIASES)) {
      expect(CLIENT_SAFE_RUNTIME_ENV_KEYS).toContain(alias);
      expect(
        documentedKeys.has(alias),
        `Deprecated alias ${alias} must stay in .env.example so operators can find and rename it`
      ).toBe(true);
      expect(
        documentedKeys.has(canonical),
        `Canonical name ${canonical} must be documented in .env.example`
      ).toBe(true);
    }
  });

  it('does not allow the webhook signing secret to be exposed to the client', () => {
    // #1286 — NEXT_PUBLIC_WEBHOOK_SECRET shipped the HMAC key in the browser
    // bundle, letting anyone forge signed webhook deliveries. It must never be
    // re-added to the allowlist; the server reads WEBHOOK_SECRET instead.
    expect(CLIENT_SAFE_RUNTIME_ENV_KEYS).not.toContain('NEXT_PUBLIC_WEBHOOK_SECRET');
    expect(() => assertClientEnvAccessIsSafe(['NEXT_PUBLIC_WEBHOOK_SECRET'])).toThrow(
      /Disallowed client env access detected: NEXT_PUBLIC_WEBHOOK_SECRET/
    );
    expect(CLIENT_SAFE_RUNTIME_ENV_KEYS).not.toContain('WEBHOOK_SECRET');
  });

  it('catches accidental server-only env access before it reaches client bundles', () => {
    const candidateClientAccesses = ['NEXT_PUBLIC_NETWORK', 'DATABASE_URL'];
    expect(() => assertClientEnvAccessIsSafe(candidateClientAccesses)).toThrow(
      /Disallowed client env access detected: DATABASE_URL/
    );
  });
});
