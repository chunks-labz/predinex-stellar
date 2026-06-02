export const APP_NAME = "Predinex";
export const REWARDS_VERSION = "v1.0";

export const SOROBAN_CONTRACT_ID = "C0000000000000000000000000000000000000000000000000000000";

export const DEFAULT_NETWORK = 'mainnet';

export const SOROBAN_RPC_BASE_URL = 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc';

export const NETWORK_CONFIG = {
  mainnet: {
    sorobanRpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
    explorerUrl: 'https://stellar.expert/explorer/public',
    network: 'mainnet',
  },
  testnet: {
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
    network: 'testnet',
  },
} as const;

export type NetworkType = keyof typeof NETWORK_CONFIG;
