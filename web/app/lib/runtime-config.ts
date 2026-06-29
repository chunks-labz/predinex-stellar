import { WALLETCONNECT_CONFIG } from './walletconnect-config';
import { NETWORK_CONFIG as ANALYTICS_NETWORK_CONFIG } from './analytics/config';

export type SupportedNetwork = 'mainnet' | 'testnet';

export type ContractConfig = {
  /** Contract address (principal) used as `contractAddress` in Stacks contract calls. */
  address: string;
  /** Contract name used as `contractName` in Stacks contract calls. */
  name: string;
  /** Full contract id in `<address>.<name>` form. */
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
};

export type WebhookSettings = {
  /** Global webhook URL for all pools */
  url: string;
  /** Shared secret for HMAC signature verification */
  secret: string;
  /** Whether global webhook is enabled */
  enabled: boolean;
};

export type PoolWebhookSettings = {
  /** Per-pool webhook URL */
  url: string;
  /** Per-pool secret for HMAC signature */
  secret: string;
  /** Whether per-pool webhook is enabled */
  enabled: boolean;
};

export type RuntimeConfig = {
  network: SupportedNetwork;
  contract: ContractConfig;
  api: StacksApiConfig;
  soroban: SorobanConfig;
  /** Global webhook configuration */
  webhook?: WebhookSettings;
  /** Per-pool webhook configurations (poolId -> settings) */
  poolWebhooks?: Record<number, PoolWebhookSettings>;
};

const DEFAULT_NETWORK: SupportedNetwork = 'testnet';

function parseNetwork(raw: string): SupportedNetwork {
  const v = raw.trim().toLowerCase();
  if (v === 'mainnet' || v === 'testnet') return v;
  throw new Error(`Invalid config NEXT_PUBLIC_NETWORK='${raw}'. Expected 'mainnet' or 'testnet'.`);
}

function parseContractId(contractAddress: string): { address: string; name: string; id: string } {
  const trimmed = contractAddress.trim();
  const separatorIndex = trimmed.indexOf('.');

  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw new Error(
      `Invalid contract id '${trimmed}'. Expected '<address>.<name>' coordinates for Stacks reads/writes.`
    );
  }

  const address = trimmed.slice(0, separatorIndex).trim();
  const name = trimmed.slice(separatorIndex + 1).trim();
  return { address, name, id: `${address}.${name}` };
}

function getOptionalEnv(name: string): string | undefined {
  const env =
    typeof process !== 'undefined' && process.env ? process.env[name]?.trim() : undefined;
  return env ? env : undefined;
}

function resolveContractConfig(network: SupportedNetwork): ContractConfig {
  const envAddress = getOptionalEnv('NEXT_PUBLIC_CONTRACT_ADDRESS');
  const envName = getOptionalEnv('NEXT_PUBLIC_CONTRACT_NAME');

  if (envAddress || envName) {
    if (!envAddress || !envName) {
      throw new Error(
        'NEXT_PUBLIC_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_NAME must both be set when overriding contract coordinates.'
      );
    }

    return {
      address: envAddress,
      name: envName,
      id: `${envAddress}.${envName}`,
    };
  }

  type AnalyticsNetworkKey = keyof typeof ANALYTICS_NETWORK_CONFIG;
  const analyticsKey: AnalyticsNetworkKey = network === 'mainnet' ? 'MAINNET' : 'TESTNET';
  const contractIdFromAnalytics = ANALYTICS_NETWORK_CONFIG[analyticsKey]?.CONTRACT_ADDRESS;

  if (!contractIdFromAnalytics || typeof contractIdFromAnalytics !== 'string') {
    throw new Error(
      `Missing contract id for network '${network}'. Expected it in analytics NETWORK_CONFIG[${analyticsKey}].CONTRACT_ADDRESS.`
    );
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

  // Soroban contract ID — used by the Stellar event/read path.
  const sorobanContractId =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SOROBAN_CONTRACT_ID) || '';
  const contract = resolveContractConfig(network);

  cachedConfig = {
    network,
    contract,
    api: {
      coreApiUrl: walletNet.coreApiUrl,
      explorerUrl: walletNet.explorerUrl,
      rpcUrl: walletNet.rpcUrl,
    },
    soroban: {
      rpcUrl: sorobanNet.rpcUrl,
      explorerUrl: sorobanNet.explorerUrl,
      contractId: sorobanContractId,
    },
    // Webhook configuration from environment
    webhook: parseWebhookConfig(),
  };

  return cachedConfig;
}

function parseWebhookConfig(): WebhookSettings | undefined {
  const url = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WEBHOOK_URL;
  const secret = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WEBHOOK_SECRET;
  const enabled = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_WEBHOOK_ENABLED === 'true';
  
  if (!url || !secret) {
    // Return undefined if not configured (webhook disabled by default)
    return undefined;
  }
  
  return {
    url,
    secret,
    enabled,
  };
}

/**
 * Useful for unit tests to force re-evaluation after env changes.
 */
export function __resetRuntimeConfigForTests(): void {
  cachedConfig = null;
}

