/**
 * Build and contract version metadata served by `GET /api/version` (#1665).
 *
 * Everything here is public by construction: an allowlist of fields, each
 * either a constant from this repository or a value that is already public
 * (the network, the contract ID that ships in the browser bundle, a git
 * commit). Values that don't look like what they claim to be are reported as
 * `null` rather than echoed, so a misconfigured variable can't leak through.
 */

import { getRuntimeConfig } from './runtime-config';

/** `version` in contracts/predinex/Cargo.toml. A test keeps the two in sync. */
export const CONTRACT_CRATE_VERSION = '0.1.0';
/** `EVENT_SCHEMA_VERSION` in contracts/predinex/src/lib.rs. Kept in sync by a test. */
export const CONTRACT_EVENT_SCHEMA_VERSION = 'v1';
/** `CONTRACT_STATE_VERSION` in contracts/predinex/src/lib.rs. Kept in sync by a test. */
export const CONTRACT_STATE_VERSION = 'v1';

export interface VersionInfo {
  service: 'predinex-web';
  /** `NEXT_PUBLIC_APP_VERSION`, or null when unset. */
  appVersion: string | null;
  build: {
    /** Git commit the build was made from (7–40 hex characters). */
    commit: string | null;
    /** ISO-8601 build timestamp. */
    builtAt: string | null;
  };
  contract: {
    /** Soroban contract ID (C… strkey) the deployment talks to. */
    id: string | null;
    network: 'mainnet' | 'testnet' | null;
    /** Crate version of the contract source this build targets. */
    crateVersion: string;
    eventSchemaVersion: string;
    stateVersion: string;
  };
}

type Env = Record<string, string | undefined>;

/**
 * The variables this module reads, each referenced literally on `process.env`
 * so Next.js inlines them at build time and the env-doc test sees them.
 */
function readEnv(): Env {
  return {
    BUILD_COMMIT_SHA: process.env.BUILD_COMMIT_SHA,
    BUILD_TIME: process.env.BUILD_TIME,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    GITHUB_SHA: process.env.GITHUB_SHA,
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION,
    NEXT_PUBLIC_NETWORK: process.env.NEXT_PUBLIC_NETWORK,
    NEXT_PUBLIC_SOROBAN_CONTRACT_ID: process.env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID,
  };
}

const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const APP_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

function pick(value: string | undefined, pattern: RegExp): string | null {
  const trimmed = value?.trim();
  return trimmed && pattern.test(trimmed) ? trimmed : null;
}

function isoTime(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const time = new Date(trimmed);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function resolveContract(
  env: Env,
  useRuntimeConfig: boolean
): { id: string | null; network: 'mainnet' | 'testnet' | null } {
  const rawNetwork = env.NEXT_PUBLIC_NETWORK?.trim() || 'testnet';
  const network = rawNetwork === 'mainnet' || rawNetwork === 'testnet' ? rawNetwork : null;
  let id = pick(env.NEXT_PUBLIC_SOROBAN_CONTRACT_ID, CONTRACT_ID_RE);
  if (id === null && useRuntimeConfig) {
    // Fall back to the app's own resolution (aliases, network defaults). It
    // throws on a broken configuration, which must not take this endpoint down.
    try {
      id = pick(getRuntimeConfig().soroban.contractId, CONTRACT_ID_RE);
    } catch {
      id = null;
    }
  }
  return { id, network };
}

/**
 * Version metadata for the running build.
 *
 * @param overrides environment to use instead of the process's (tests).
 */
export function getVersionInfo(overrides?: Env): VersionInfo {
  const env = overrides ?? readEnv();
  const commit =
    pick(env.BUILD_COMMIT_SHA, COMMIT_RE) ??
    pick(env.VERCEL_GIT_COMMIT_SHA, COMMIT_RE) ??
    pick(env.GITHUB_SHA, COMMIT_RE);

  return {
    service: 'predinex-web',
    appVersion: pick(env.NEXT_PUBLIC_APP_VERSION, APP_VERSION_RE),
    build: {
      commit: commit?.toLowerCase() ?? null,
      builtAt: isoTime(env.BUILD_TIME),
    },
    contract: {
      ...resolveContract(env, overrides === undefined),
      crateVersion: CONTRACT_CRATE_VERSION,
      eventSchemaVersion: CONTRACT_EVENT_SCHEMA_VERSION,
      stateVersion: CONTRACT_STATE_VERSION,
    },
  };
}
