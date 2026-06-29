/**
 * Wallet Service
 * Enhanced wallet connection utilities for Stacks wallets
 */

import { AppConfig, UserSession, showConnect, FinishedAuthData, UserData } from '@stacks/connect';
import { STACKS_MAINNET, STACKS_TESTNET, StacksNetwork } from '@stacks/network';
import { ClarityValue, type PostCondition, type PostConditionMode } from '@stacks/transactions';
import { formatDisplayAddress } from './address-display';

export type WalletType = 'hiro' | 'xverse' | 'leather' | 'unknown';
export type NetworkType = 'mainnet' | 'testnet';

/**
 * Represents a wallet provider extension or service
 */
export interface WalletProvider {
  /** Display name of the wallet */
  name: string;
  /** Internal identifier for the wallet type */
  type: WalletType;
  /** Path to the wallet's icon */
  icon: string;
  /** Function to check if the wallet extension is installed in the browser */
  isInstalled: () => boolean;
  /** Function to initiate the connection flow for this provider */
  connect: () => Promise<FinishedAuthData>;
}

/**
 * Represents an active user session with a connected wallet
 */
export interface WalletSession {
  /** The user's primary Stacks address */
  address: string;
  /** The user's public key */
  publicKey: string;
  /** The currently active network (mainnet or testnet) */
  network: NetworkType;
  /** The user's current STX balance (optional) */
  balance: number;
  /** Whether the wallet is currently connected */
  isConnected: boolean;
  /** The type of wallet provider being used */
  walletType: WalletType;
  /** Timestamp of when the session was established */
  connectedAt: Date;
  /** Timestamp of the last user activity */
  lastActivity: Date;
}

/**
 * Data required to initiate a Stacks contract call transaction
 */
export interface TransactionPayload {
  /** The principal address of the contract */
  contractAddress: string;
  /** The name of the contract */
  contractName: string;
  /** The name of the function to be called */
  functionName: string;
  /** The arguments to be passed to the function */
  functionArgs: ClarityValue[];
  /** Optional post-conditions to constrain token movement. */
  postConditions?: PostCondition[];
  /** Optional post-condition mode. Defaults to Deny in the shared transaction helpers. */
  postConditionMode?: PostConditionMode;
  /** Optional transaction fee override in micro-STX */
  fee?: number;
  /** Optional nonce override for the transaction */
  nonce?: number;
}

/**
 * WalletService acts as a central hub for managing Stacks wallet connections,
 * user authentication state, and transaction orchestration.
 */
export class WalletService {
  private appConfig: AppConfig;
  private userSession: UserSession;
  private network: StacksNetwork;

  constructor(network: NetworkType = 'mainnet') {
    this.appConfig = new AppConfig(['store_write', 'publish_data']);
    this.userSession = new UserSession({ appConfig: this.appConfig });
    this.network = network === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET;
  }

  /**
   * Returns a list of all wallet providers supported by the platform.
   * Filters out providers that are not currently installed in the user's browser.
   * 
   * @returns An array of available WalletProvider objects
   */
  getAvailableWallets(): WalletProvider[] {
    const providers: WalletProvider[] = [
      {
        name: 'Hiro Wallet',
        type: 'hiro',
        icon: '/icons/hiro-wallet.svg',
        isInstalled: () => typeof window !== 'undefined' && !!window.HiroWalletProvider,
        connect: () => this.connectWithHiro()
      },
      {
        name: 'Xverse',
        type: 'xverse',
        icon: '/icons/xverse.svg',
        isInstalled: () => typeof window !== 'undefined' && !!window.XverseProviders,
        connect: () => this.connectWithXverse()
      },
      {
        name: 'Leather',
        type: 'leather',
        icon: '/icons/leather.svg',
        isInstalled: () => typeof window !== 'undefined' && !!window.LeatherProvider,
        connect: () => this.connectWithLeather()
      }
    ];

    return providers.filter(provider => provider.isInstalled());
  }

  /**
   * Connect with Hiro Wallet
   */
  private async connectWithHiro(): Promise<FinishedAuthData> {
    return new Promise((resolve, reject) => {
      showConnect({
        appDetails: {
          name: 'Predinex',
          icon: '/logo.png',
        },
        redirectTo: '/',
        onFinish: (authData: FinishedAuthData) => {
          resolve(authData);
        },
        onCancel: () => {
          reject(new Error('User cancelled connection'));
        },
        userSession: this.userSession,
      });
    });
  }

  /**
   * Connect with Xverse wallet.
   * Not yet implemented — requires the Xverse SDK.
   */
  private async connectWithXverse(): Promise<FinishedAuthData> {
    throw new Error('Xverse integration not yet implemented');
  }

  /**
   * Connect with Leather wallet.
   * Not yet implemented — requires the Leather SDK.
   */
  private async connectWithLeather(): Promise<FinishedAuthData> {
    throw new Error('Leather integration not yet implemented');
  }

  /**
   * Checks if a user is currently authenticated with a wallet.
   * 
   * @returns True if a user is signed in, false otherwise
   */
  isSignedIn(): boolean {
    return this.userSession.isUserSignedIn();
  }

  /**
   * Retrieves the authenticated user's data from the current session.
   * 
   * @returns The user data object if signed in, null otherwise
   */
  getUserData(): UserData | null {
    if (this.isSignedIn()) {
      return this.userSession.loadUserData();
    }
    return null;
  }

  /**
   * Terminates the current wallet session and signs out the user.
   */
  signOut(): void {
    this.userSession.signUserOut();
  }

  /**
   * Initiates a contract call transaction. This method handles signing (via the wallet)
   * and broadcasting the transaction to the network.
   * 
   * @param payload - The transaction details
   * @returns A promise resolving to the transaction ID (TXID)
   */
  async sendTransaction(payload: TransactionPayload): Promise<string> {
    if (!this.isSignedIn()) {
      throw new Error('User not signed in');
    }

    const userData = this.getUserData();

    // Import TransactionService here to avoid circular dependency
    const { TransactionService } = await import('./transaction-service');
    const txService = new TransactionService(this.network);

    // Validate payload
    const validation = txService.validatePayload(payload);
    if (!validation.isValid) {
      throw new Error(`Invalid transaction: ${validation.errors.join(', ')}`);
    }

    try {
      if (!userData || !userData.appPrivateKey) {
        throw new Error('User private key not available');
      }
      const result = await txService.executeTransaction(payload, userData.appPrivateKey, {
        fee: payload.fee,
        nonce: payload.nonce,
        postConditions: payload.postConditions,
        postConditionMode: payload.postConditionMode,
      });

      return result.txId;
    } catch (error) {
      log.error('Transaction failed:', error);
      throw error;
    }
  }

  /**
   * Switches the active network between mainnet and testnet.
   * 
   * @param network - The network type to switch to
   */
  switchNetwork(network: NetworkType): void {
    this.network = network === 'mainnet' ? STACKS_MAINNET : STACKS_TESTNET;
  }

  /**
   * Returns the type of the currently active network.
   * 
   * @returns 'mainnet' or 'testnet'
   */
  getCurrentNetwork(): NetworkType {
    return this.network === STACKS_MAINNET ? 'mainnet' : 'testnet';
  }

  /**
   * Truncates a Stacks address for user-friendly display (e.g., SP1E...XAMPLE).
   *
   * @param address - The full Stacks address
   * @returns The truncated address string
   */
  static formatAddress(address: string): string {
    return formatDisplayAddress(address);
  }

  /**
   * Formats a micro-STX amount into a human-readable STX string.
   * 
   * @param microSTX - The amount in micro-STX
   * @returns A formatted string including the 'STX' unit
   */
  static formatSTXAmount(microSTX: number): string {
    const stx = microSTX / 1000000;
    return `${stx.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    })} STX`;
  }
}

// Global wallet provider type declarations
interface HiroWalletProvider {
  isRequestPending: boolean;
  request: (payload: unknown) => Promise<unknown>;
}

interface XverseProviders {
  webwallet: {
    request: (payload: unknown) => Promise<unknown>;
  };
}

interface LeatherProvider {
  request: (payload: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    HiroWalletProvider?: HiroWalletProvider;
    XverseProviders?: XverseProviders;
    LeatherProvider?: LeatherProvider;
  }
}// Type-safe wallet interaction layer
// Type-safe wallet interaction layer
