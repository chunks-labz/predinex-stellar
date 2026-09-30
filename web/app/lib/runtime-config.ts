import { WALLETCONNECT_CONFIG } from './walletconnect-config';
import { NETWORK_CONFIG as ANALYTICS_NETWORK_CONFIG } from './analytics/config';
import { DEPRECATED_RUNTIME_ENV_ALIASES } from './env-boundary';

export type SupportedNetwork = 'mainnet' | 'testnet';

export type ContractConfig = {
  /** Contract address (strkey) used as `contractAddress` in Stellar contract calls. */
  address: string;
  /** Legacy field, kept for compatibility. */
  name: string;
  /** Full contract id. */
  id: string;
};

export type StacksApiConfig = {
  /** Hiro Core API base URL used for chain tip / tx / address endpoints. */
  coreApiUrl: string;
  /** Explorer base URL (for linking). */
  explorerUrl: string;
  /** RPC URL (for wallet/rpc integrations). */
  rpcUrl: string;
};

export type SorobanConfig = {
  /** Soroban RPC URL used for getEvents and other Soroban RPC calls. */
  rpcUrl: string;
  /** Stellar explorer base URL (for linking to transactions). */
  explorerUrl: string;
  /** Deployed Soroban contract ID (C... strkey). */
  contractId: string;
  /** Bridge contract ID (C... strkey) that settles cross-chain pool mirrors. Optional until a mirror is created. */
  bridgeContractId?: string;
};

/**
 * Client-visible webhook settings.
 *
 * #1286 — the `secret` field was removed. Webhook signing is a server concern:
 * the secret now lives only in the server-only `WEBHOOK_SECRET` env var and is
 * read inside `app/api/webhooks/notify`. A `NEXT_PUBLIC_` secret is compiled
 * into the client bundle, so it cannot be used for signing.
 */
export type WebhookSettings = {
  /** Global webhook URL for all pools */
  url: string;
  /** Whether global webhook is enabled */
  enabled: boolean;
};

export type PoolWebhookSettings = {
  /** Per-pool webhook URL */
  url: string;
  /** Whether per-pool webhook is enabled */
  enabled: boolean;
};

export type RuntimeConfig = {
  network: SupportedNetwork;
  appVersion: string;
  contract: ContractConfig;
  api: StacksApiConfig;
  soroban: SorobanConfig;
  /** Global webhook configuration */
  webhook?: WebhookSettings;
  /** Per-pool webhook configurations (poolId -> settings) */
  poolWebhooks?: Record<number, PoolWebhookSettings>;
  /**
   * Default oracle provider address pre-filled in the oracle registration form.
   * Sourced from `NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS`. Empty string when not configured.
   */
  defaultOracleAddress: string;
};

const DEFAULT_NETWORK: SupportedNetwork = 'testnet';
const DEFAULT_APP_VERSION = 'unknown';

function parseNetwork(raw: string): SupportedNetwork {
  const v = raw.trim().toLowerCase();
  if (v === 'mainnet' || v === 'testnet') return v;
  throw new Error(`Invalid config NEXT_PUBLIC_NETWORK='${raw}'. Expected 'mainnet' or 'testnet'.`);
}

function parseContractId(contractAddress: string): { address: string; name: string; id: string } {
  const trimmed = contractAddress.trim();

  // Stellar Soroban contract ID (C-prefixed strkey).
  if (trimmed.startsWith('C')) {
    return { address: trimmed, name: '', id: trimmed };
  }

  throw new Error(
    `Invalid contract id '${trimmed}'. Expected a Stellar contract ID (C... strkey).`
  );
}

function getOptionalEnv(name: string): string | undefined {
  const env =
    typeof process !== 'undefined' && process.env ? process.env[name]?.trim() : undefined;
  return env ? env : undefined;
}

const warnedDeprecatedAliases = new Set<string>();

function warnDeprecatedAliasOnce(alias: string, canonical: string): void {
  if (warnedDeprecatedAliases.has(alias)) return;
  warnedDeprecatedAliases.add(alias);
  // eslint-disable-next-line no-console
  console.warn(
    `[runtime-config] ${alias} is deprecated. Set ${canonical} instead; ` +
      `both resolve to the same contract id, so this can be renamed with no behaviour change.`
  );
}

/**
 * Resolve the single deployed contract id.
 *
 * #1308 — `NEXT_PUBLIC_SOROBAN_CONTRACT_ID` is canonical. The former
 * `NEXT_PUBLIC_CONTRACT_ADDRESS` is still honoured as a deprecated alias so
 * existing deployments keep working, but both names now feed the same value.
 * Previously the two were read into different fields, so a deployment that set
 * only one of them could have contract reads and Soroban event reads pointed at
 * two different contracts.
 *
 * When both are set the canonical name wins, so an operator who migrates takes
 * effect immediately instead of being shadowed by the value they just replaced.
 */
function resolveContractIdFromEnv(): string | undefined {
  const legacy = getOptionalEnv('NEXT_PUBLIC_CONTRACT_ADDRESS');
  if (legacy) {
    warnDeprecatedAliasOnce(
      'NEXT_PUBLIC_CONTRACT_ADDRESS',
      DEPRECATED_RUNTIME_ENV_ALIASES.NEXT_PUBLIC_CONTRACT_ADDRESS
    );
  }

  return getOptionalEnv('NEXT_PUBLIC_SOROBAN_CONTRACT_ID') ?? legacy;
}

function resolveContractConfig(
  network: SupportedNetwork,
  envContractId: string | undefined
): ContractConfig {
  const envName = getOptionalEnv('NEXT_PUBLIC_CONTRACT_NAME');

  if (envContractId) {
    // The env-supplied id is passed through unvalidated: deployments have
    // historically used both C... contract ids and the legacy S... account
    // form, and rejecting either here would break them. Only the built-in
    // analytics fallback is format-checked.
    return {
      address: envContractId,
      name: envName ?? '',
      id: envName ? `${envContractId}.${envName}` : envContractId,
    };
  }

  if (envName) {
    throw new Error(
      'NEXT_PUBLIC_CONTRACT_NAME must not be set on its own. Set ' +
        'NEXT_PUBLIC_SOROBAN_CONTRACT_ID (or the deprecated NEXT_PUBLIC_CONTRACT_ADDRESS) ' +
        'to the contract name NEXT_PUBLIC_CONTRACT_NAME refers to.'
    );
  }

  type AnalyticsNetworkKey = keyof typeof ANALYTICS_NETWORK_CONFIG;
  const analyticsKey: AnalyticsNetworkKey = network === 'mainnet' ? 'MAINNET' : 'TESTNET';
  const contractIdFromAnalytics = ANALYTICS_NETWORK_CONFIG[analyticsKey]?.CONTRACT_ADDRESS;

  // When no contract ID is configured (e.g. test/dev environments without a
  // deployed contract), return a safe placeholder rather than throwing.
  // Contract calls will fail gracefully at the RPC layer; the UI degrades.
  if (!contractIdFromAnalytics || typeof contractIdFromAnalytics !== 'string') {
    return { address: '', name: '', id: '' };
  }

  return parseContractId(contractIdFromAnalytics);
}

let cachedConfig: RuntimeConfig | null = null;

/**
 * Typed runtime config (contract, network selection, API endpoints).
 *
 * Behavior:
 * - Defaults to `testnet` when `NEXT_PUBLIC_NETWORK` is not set.
 * - Throws if derived contract/API configuration cannot be resolved.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const network = parseNetwork(getOptionalEnv('NEXT_PUBLIC_NETWORK') ?? DEFAULT_NETWORK);

  const walletNet = WALLETCONNECT_CONFIG.networks[network];
  if (!walletNet?.coreApiUrl || !walletNet?.explorerUrl || !walletNet?.rpcUrl) {
    throw new Error(`Missing Stacks API URLs for network '${network}' in wallet configuration.`);
  }

  const sorobanNet = WALLETCONNECT_CONFIG.soroban[network];
  if (!sorobanNet?.rpcUrl || !sorobanNet?.explorerUrl) {
    throw new Error(`Missing Soroban RPC URLs for network '${network}' in wallet configuration.`);
  }

  // Deployed contract id — one canonical value feeding both the contract
  // coordinates and the Soroban event/read path (#1308).
  const envContractId = resolveContractIdFromEnv();
  const contract = resolveContractConfig(network, envContractId);

  const appVersion = getOptionalEnv('NEXT_PUBLIC_APP_VERSION') ?? DEFAULT_APP_VERSION;

  cachedConfig = {
    network,
    appVersion,
    contract,
    api: {
      coreApiUrl: walletNet.coreApiUrl,
      explorerUrl: walletNet.explorerUrl,
      rpcUrl: walletNet.rpcUrl,
    },
    soroban: {
      rpcUrl: sorobanNet.rpcUrl,
      explorerUrl: sorobanNet.explorerUrl,
      contractId: envContractId ?? '',
      bridgeContractId: getOptionalEnv('NEXT_PUBLIC_SOROBAN_BRIDGE_CONTRACT_ID'),
    },
    // Webhook configuration from environment
    webhook: parseWebhookConfig(),
    // Default oracle address for the oracle management registration form.
    defaultOracleAddress: getOptionalEnv('NEXT_PUBLIC_DEFAULT_ORACLE_ADDRESS') ?? '',
  };

  return cachedConfig;
}

function parseWebhookConfig(): WebhookSettings | undefined {
  const url = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WEBHOOK_URL;
  const enabled = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WEBHOOK_ENABLED === 'true';

  if (!url) {
    // Return undefined if not configured (webhook disabled by default)
    return undefined;
  }

  // No secret here by design (#1286) — see WebhookSettings.
  return {
    url,
    enabled,
  };
}

/**
 * Useful for unit tests to force re-evaluation after env changes.
 */
export function __resetRuntimeConfigForTests(): void {
  cachedConfig = null;
  warnedDeprecatedAliases.clear();
}

