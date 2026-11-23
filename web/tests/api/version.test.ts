/**
 * #1665 — GET /api/version reports build and contract metadata without
 * authentication and without secrets.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../app/api/version/route';
import {
  CONTRACT_CRATE_VERSION,
  CONTRACT_EVENT_SCHEMA_VERSION,
  CONTRACT_STATE_VERSION,
  getVersionInfo,
} from '../../app/lib/build-info';

const REPO = path.resolve(__dirname, '../../..');
const CONTRACT_ID = `C${'A'.repeat(51)}D2KM`; // 56-character C… strkey shape
const COMMIT = '3f9a1c7e5b2d4f6a8c0e1b3d5f7a9c1e3b5d7f9a';

afterEach(() => vi.unstubAllEnvs());

describe('getVersionInfo', () => {
  it('reports build, network and contract metadata', () => {
    expect(
      getVersionInfo({
        BUILD_COMMIT_SHA: COMMIT,
        BUILD_TIME: '2026-11-23T10:00:00Z',
        NEXT_PUBLIC_APP_VERSION: '1.4.0',
        NEXT_PUBLIC_NETWORK: 'mainnet',
        NEXT_PUBLIC_SOROBAN_CONTRACT_ID: CONTRACT_ID,
      })
    ).toEqual({
      service: 'predinex-web',
      appVersion: '1.4.0',
      build: { commit: COMMIT, builtAt: '2026-11-23T10:00:00.000Z' },
      contract: {
        id: CONTRACT_ID,
        network: 'mainnet',
        crateVersion: CONTRACT_CRATE_VERSION,
        eventSchemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
        stateVersion: CONTRACT_STATE_VERSION,
      },
    });
  });

  it('falls back from BUILD_COMMIT_SHA to the Vercel, then GitHub, commit', () => {
    expect(getVersionInfo({ VERCEL_GIT_COMMIT_SHA: 'ABCDEF1', GITHUB_SHA: 'bbbbbbb' }).build.commit).toBe(
      'abcdef1'
    );
    expect(getVersionInfo({ GITHUB_SHA: 'bbbbbbb' }).build.commit).toBe('bbbbbbb');
  });

  it('reports null instead of echoing values that are not what they claim to be', () => {
    const info = getVersionInfo({
      BUILD_COMMIT_SHA: 'not a commit; rm -rf /',
      BUILD_TIME: 'yesterday-ish',
      NEXT_PUBLIC_APP_VERSION: '<script>alert(1)</script>',
      NEXT_PUBLIC_NETWORK: 'devnet',
      NEXT_PUBLIC_SOROBAN_CONTRACT_ID: 'SBADSECRETKEYLOOKINGVALUE',
    });
    expect(info.appVersion).toBeNull();
    expect(info.build).toEqual({ commit: null, builtAt: null });
    expect(info.contract.id).toBeNull();
    expect(info.contract.network).toBeNull();
  });

  it('defaults the network to testnet like the rest of the app', () => {
    expect(getVersionInfo({}).contract.network).toBe('testnet');
  });
});

describe('GET /api/version', () => {
  it('answers without credentials and never includes server secrets', async () => {
    const secrets = {
      WEBHOOK_SECRET: 'whsec_super_secret_value',
      ADMIN_SESSION_SECRET: 'admin-session-secret-value',
      ADMIN_ALLOWLIST: 'GADMINADDRESSALLOWLISTVALUE',
      STELLAR_SECRET_KEY: 'SBIGSECRETSEED',
    };
    for (const [key, value] of Object.entries(secrets)) vi.stubEnv(key, value);
    vi.stubEnv('BUILD_COMMIT_SHA', COMMIT);

    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
    const text = await res.text();
    for (const value of Object.values(secrets)) expect(text).not.toContain(value);

    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['appVersion', 'build', 'contract', 'service']);
    expect(body.build.commit).toBe(COMMIT);
  });
});

describe('contract version constants', () => {
  it('match contracts/predinex/Cargo.toml', () => {
    const cargo = readFileSync(path.join(REPO, 'contracts/predinex/Cargo.toml'), 'utf8');
    expect(cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]).toBe(CONTRACT_CRATE_VERSION);
  });

  it('match the schema and state versions in contracts/predinex/src/lib.rs', () => {
    const lib = readFileSync(path.join(REPO, 'contracts/predinex/src/lib.rs'), 'utf8');
    expect(lib.match(/pub const EVENT_SCHEMA_VERSION: &str = "([^"]+)";/)?.[1]).toBe(
      CONTRACT_EVENT_SCHEMA_VERSION
    );
    expect(lib.match(/pub const CONTRACT_STATE_VERSION: &str = "([^"]+)";/)?.[1]).toBe(
      CONTRACT_STATE_VERSION
    );
  });
});
