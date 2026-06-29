import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertClientEnvAccessIsSafe,
  CLIENT_SAFE_RUNTIME_ENV_KEYS,
} from '../../app/lib/env-boundary';

const CLIENT_SOURCE_ROOTS = ['app', 'lib'];
const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Matches both:
// - process.env.MY_KEY
// - process.env?.MY_KEY
const ENV_ACCESS_PATTERN = /process\.env\??\.([A-Z0-9_]+)/g;

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

    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
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
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_APP_VERSION",
        "NEXT_PUBLIC_CONTRACT_ADDRESS",
        "NEXT_PUBLIC_CONTRACT_NAME",
        "NEXT_PUBLIC_ENABLE_ORACLE_MANAGEMENT_PLACEHOLDER",
        "NEXT_PUBLIC_NETWORK",
        "NEXT_PUBLIC_NETWORK_TYPE",
        "NEXT_PUBLIC_SOROBAN_CONTRACT_ID",
        "NEXT_PUBLIC_SOROBAN_RPC_URL",
        "NEXT_PUBLIC_TOKEN_NAME",
        "NEXT_PUBLIC_TOKEN_SYMBOL",
        "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
        "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
        "NEXT_PUBLIC_WEBHOOK_ENABLED",
        "NEXT_PUBLIC_WEBHOOK_SECRET",
        "NEXT_PUBLIC_WEBHOOK_URL",
      ]
    `);
  });

  it('catches accidental server-only env access before it reaches client bundles', () => {
    const candidateClientAccesses = ['NEXT_PUBLIC_NETWORK', 'DATABASE_URL'];
    expect(() => assertClientEnvAccessIsSafe(candidateClientAccesses)).toThrow(
      /Disallowed client env access detected: DATABASE_URL/
    );
  });
});
