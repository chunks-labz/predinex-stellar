/**
 * Shared constants for the Predinex frontend UI.
 */

// ---------------------------------------------------------------------------
// Network / API configuration
// ---------------------------------------------------------------------------

export type NetworkName = 'mainnet' | 'testnet';

export const DEFAULT_NETWORK: NetworkName =
    (process.env.NEXT_PUBLIC_NETWORK as NetworkName) || 'testnet';

export const SOROBAN_RPC_URL: string =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

export const CONTRACT_ADDRESS: string =
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || 'SP2WWKKF25SED3K5P6ETY7MDDNBQH50GPSP8EJM8N';

export const CONTRACT_NAME: string =
    process.env.NEXT_PUBLIC_CONTRACT_NAME || 'predinex-contract';

// Maximum pool duration that the frontend allows when creating a new market.
// This mirrors the contract-side maximum and protects against long-lived pools.
export const MAX_POOL_DURATION_SECONDS = 1_000_000;

export interface NetworkConfig {
    rpcUrl: string;
    explorerUrl: string;
}

export const NETWORK_CONFIG: Record<NetworkName, NetworkConfig> = {
    mainnet: {
        rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
        explorerUrl: 'https://stellar.expert/explorer/public',
    },
    testnet: {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        explorerUrl: 'https://stellar.expert/explorer/testnet',
    },
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

/**
 * Standard sizes for Lucide icons (numeric)
 */
export const ICON_SIZE = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * Standard CSS classes for Lucide icons
 */
export const ICON_CLASS = {
  xs: 'w-3 h-3', // 12px
  sm: 'w-4 h-4', // 16px
  md: 'w-5 h-5', // 20px
  lg: 'w-6 h-6', // 24px
  xl: 'w-8 h-8', // 32px
} as const;

/**
 * Common animation duration classes
 */
export const ANIMATION_DURATION = {
  fast: 'duration-150',
  base: 'duration-300',
  slow: 'duration-500',
} as const;
