/**
 * WalletConnect Configuration
 * Enhanced configuration for Stacks wallet integration
 */

export const WALLETCONNECT_CONFIG = {
  // Project ID from WalletConnect Cloud (if using WalletConnect protocol)
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',

  // App metadata for wallet display
  metadata: {
    name: 'Predinex',
    description: 'Decentralized Prediction Market on Stellar',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://predinex.app',
    icons: ['https://predinex.app/logo.png'],
  },

  // Supported Stellar/Soroban networks
  networks: {
    mainnet: {
      chainId: 'stellar:mainnet',
      name: 'Stellar Mainnet',
      rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
      explorerUrl: 'https://stellar.expert/explorer/public',
      coreApiUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
    },
    testnet: {
      chainId: 'stellar:testnet',
      name: 'Stellar Testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      coreApiUrl: 'https://soroban-testnet.stellar.org',
    },
  },

  // Stellar / Soroban RPC endpoints (used by the Soroban event service)
  soroban: {
    mainnet: {
      rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
      explorerUrl: 'https://stellar.expert/explorer/public',
    },
    testnet: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
    },
  },

  // Supported wallet methods
  methods: [
    'stx_call_read_only',
    'stx_call_contract_function',
    'stx_transfer',
    'stx_sign_message',
    'stx_get_accounts',
    'stx_get_balance',
  ],

  // Supported wallet events
  events: [
    'chainChanged',
    'accountsChanged',
    'sessionProposed',
    'sessionApproved',
    'sessionRejected',
    'sessionDisconnected',
  ],

  // UI Configuration
  ui: {
    showQrCode: true,
    showWalletList: true,
    autoConnect: true,
    persistSession: true,
    theme: 'dark',
  },

  // Connection timeouts
  timeouts: {
    sessionProposal: 300000, // 5 minutes
    sessionApproval: 300000, // 5 minutes
    sessionConnection: 60000, // 1 minute
    transactionSigning: 300000, // 5 minutes
  },

  // Session storage configuration
  storage: {
    key: 'predinex_wallet_session',
    ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
    version: '1.0.0',
  },

  // Error recovery settings
  recovery: {
    maxRetries: 3,
    retryDelays: [1000, 2000, 4000], // Progressive backoff
    enableAutoRecovery: true,
  },

  // Feature flags
  features: {
    multiWallet: true,
    networkSwitching: true,
    sessionValidation: true,
    errorRecovery: true,
    balanceRefresh: true,
  },
} as const;

export type WalletConnectConfig = typeof WALLETCONNECT_CONFIG;
