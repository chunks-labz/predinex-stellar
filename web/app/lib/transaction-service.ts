/**
 * Transaction Service
 * Handles transaction formatting, signing, and broadcasting for Stacks wallets
 */

import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  ClarityValue,
  type PostCondition,
  StacksTransactionWire,
  getAddressFromPrivateKey,
} from '@stacks/transactions';
import { StacksNetwork } from '@stacks/network';
import { TransactionPayload } from './wallet-service';

/**
 * Options for customizing transaction behavior
 */
export interface TransactionOptions {
  fee?: number;
  nonce?: number;
  anchorMode?: AnchorMode;
  postConditionMode?: PostConditionMode;
  postConditions?: PostCondition[];
}

/**
 * Result of a transaction broadcast
 */
export interface TransactionResult {
  txId: string;
  transaction: StacksTransactionWire;
  broadcastResult: Awaited<ReturnType<typeof broadcastTransaction>>;
}

/**
 * Estimated costs and sequence for a transaction
 */
export interface TransactionStatusDetails {
  tx_status: string;
  tx_type: string;
  block_hash: string;
  block_height: number;
  burn_chain_txid: string;
  fee_rate: string;
  sender_address: string;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: unknown[];
  };
}

export interface TransactionEstimate {
  estimatedFee: number;
  estimatedNonce: number;
  totalCost: number;
}

/**
 * TransactionService provides high-level utilities for interacting with the Stacks blockchain.
 * It manages the lifecycle of a transaction from estimation and creation to broadcasting and status tracking.
 */
export class TransactionService {
  private network: StacksNetwork;

  constructor(network: StacksNetwork) {
    this.network = network;
  }

  /**
   * Estimates the fee and nonce for a given transaction payload.
   * Currently uses a fallback estimation for unblocking the build.
   * 
   * @param payload - The transaction details (contract, function, args)
   * @param senderAddress - The Stacks address of the sender
   * @returns A promise resolving to the transaction estimation
   */
  async estimateTransaction(
    payload: TransactionPayload,
    senderAddress: string
  ): Promise<TransactionEstimate> {
    try {
      // Use @stacks/blockchain-api-client to get real fee and nonce estimates
      const net = this.network as { coreApiUrl?: string; baseUrl?: string };
      const apiUrl = net.coreApiUrl ?? net.baseUrl;

      // Fetch current nonce for the sender address
      const nonceResponse = await fetch(`${apiUrl}/extended/v1/address/${senderAddress}/nonces`);
      if (!nonceResponse.ok) {
        throw new Error(`Failed to fetch nonce: ${nonceResponse.status}`);
      }
      const nonceData = await nonceResponse.json();
      const nonce = nonceData.possible_nonce || 0;

      // Fetch fee estimate from network
      const feeEstimate = await this.estimateFeeFromNetwork(apiUrl);

      return {
        estimatedFee: Number(feeEstimate),
        estimatedNonce: Number(nonce),
        totalCost: Number(feeEstimate),
      };
    } catch (error) {
      console.error('Transaction estimation failed:', error);
      // Fallback to conservative estimates if API fails
      return {
        estimatedFee: 10000,
        estimatedNonce: 0,
        totalCost: 10000,
      };
    }
  }

  private async estimateFeeFromNetwork(apiUrl: string): Promise<number> {
    try {
      const feeResponse = await fetch(`${apiUrl}/v2/fees`);
      if (!feeResponse.ok) {
        return 10000;
      }
      const feeData = await feeResponse.json();
      return feeData.middle?.fee_rate || 10000;
    } catch {
      return 10000;
    }
  }

  /**
   * Formats a transaction payload into a human-readable structure for UI display.
   * 
   * @param payload - The transaction details to format
   * @returns An object containing title, description, and key-value details
   */
  formatTransactionForDisplay(payload: TransactionPayload): {
    title: string;
    description: string;
    details: Array<{ label: string; value: string }>;
  } {
    const details = [
      { label: 'Contract', value: `${payload.contractAddress}.${payload.contractName}` },
      { label: 'Function', value: payload.functionName },
      { label: 'Arguments', value: `${payload.functionArgs.length} parameters` },
    ];

    if (payload.fee) {
      details.push({ label: 'Fee', value: `${payload.fee / 1000000} STX` });
    }

    return {
      title: `Call ${payload.functionName}`,
      description: `Execute function on ${payload.contractName} contract`,
      details,
    };
  }

  /**
   * Creates a signed Stacks transaction ready for broadcasting.
   * 
   * @param payload - The transaction details
   * @param senderKey - The private key of the sender
   * @param options - Optional overrides for fee, nonce, etc.
   * @returns A promise resolving to the signed transaction object
   */
  async createTransaction(
    payload: TransactionPayload,
    senderKey: string,
    options: TransactionOptions = {}
  ): Promise<StacksTransactionWire> {
    try {
      let fee = options.fee;
      let nonce = options.nonce;

      if (!fee || !nonce) {
        const senderAddress = this.getAddressFromPrivateKey(senderKey);
        const estimate = await this.estimateTransaction(payload, senderAddress);

        if (!fee) fee = estimate.estimatedFee;
        if (!nonce) nonce = estimate.estimatedNonce;
      }

      const txOptions = {
        contractAddress: payload.contractAddress,
        contractName: payload.contractName,
        functionName: payload.functionName,
        functionArgs: payload.functionArgs,
        senderKey,
        network: this.network,
        anchorMode: options.anchorMode || AnchorMode.Any,
        postConditionMode: options.postConditionMode ?? PostConditionMode.Deny,
        ...(options.postConditions?.length ? { postConditions: options.postConditions } : {}),
        fee,
        nonce,
      };

      return await makeContractCall(txOptions);
    } catch (error) {
      console.error('Transaction creation failed:', error);
      throw new Error(`Failed to create transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Broadcasts a signed transaction to the Stacks network.
   * 
   * @param transaction - The signed transaction object
   * @returns A promise resolving to the broadcast result and ID
   */
  async broadcastTransaction(transaction: StacksTransactionWire): Promise<TransactionResult> {
    try {
      const broadcastResult = await broadcastTransaction({ transaction });

      if ('error' in broadcastResult) {
        throw new Error(`Broadcast failed: ${broadcastResult.error}`);
      }

      return {
        txId: broadcastResult.txid,
        transaction,
        broadcastResult,
      };
    } catch (error) {
      console.error('Transaction broadcast failed:', error);
      throw new Error(`Failed to broadcast transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Orchestrates the full transaction lifecycle: creation, signing, and broadcasting.
   * 
   * @param payload - The transaction details
   * @param senderKey - The private key of the sender
   * @param options - Optional overrides
   * @returns A promise resolving to the execution result
   */
  async executeTransaction(
    payload: TransactionPayload,
    senderKey: string,
    options: TransactionOptions = {}
  ): Promise<TransactionResult> {
    try {
      const transaction = await this.createTransaction(payload, senderKey, options);
      return await this.broadcastTransaction(transaction);
    } catch (error) {
      console.error('Transaction execution failed:', error);
      throw error;
    }
  }

  /**
   * Validates that a transaction payload contains all required fields in the correct format.
   * 
   * @param payload - The payload to validate
   * @returns An object indicating validity and a list of specific errors if any
   */
  validatePayload(payload: TransactionPayload): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!payload.contractAddress) {
      errors.push('Contract address is required');
    }

    if (!payload.contractName) {
      errors.push('Contract name is required');
    }

    if (!payload.functionName) {
      errors.push('Function name is required');
    }

    if (!Array.isArray(payload.functionArgs)) {
      errors.push('Function arguments must be an array');
    }

    if (payload.contractAddress && !this.isValidStellarAddress(payload.contractAddress)) {
      errors.push('Invalid contract address format');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Fetches the current status of a transaction from the Stacks node API.
   * 
   * @param txId - The unique transaction ID (hash)
   * @returns A promise resolving to the status and optional data details
   */
  async getTransactionStatus(txId: string): Promise<{
    status: 'pending' | 'success' | 'failed' | 'not_found';
    details?: TransactionStatusDetails;
  }> {
    try {
      // StacksNetwork exposes coreApiUrl/baseUrl at runtime but they are not part of
      // the public TypeScript surface; cast to a minimal shape to avoid as-any sprawl.
      const net = this.network as { coreApiUrl?: string; baseUrl?: string };
      const response = await fetch(`${net.coreApiUrl ?? net.baseUrl}/extended/v1/tx/${txId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return { status: 'not_found' };
        }
        throw new Error(`API request failed: ${response.status}`);
      }

      const txData = await response.json();

      let status: 'pending' | 'success' | 'failed' = 'pending';

      if (txData.tx_status === 'success') {
        status = 'success';
      } else if (txData.tx_status === 'abort_by_response' || txData.tx_status === 'abort_by_post_condition') {
        status = 'failed';
      }

      return {
        status,
        details: txData,
      };
    } catch (error) {
      console.error('Failed to get transaction status:', error);
      return { status: 'not_found' };
    }
  }

  private getAddressFromPrivateKey(privateKey: string): string {
    try {
      return getAddressFromPrivateKey(privateKey);
    } catch (error) {
      console.error('Failed to derive address from private key:', error);
      throw new Error('Invalid private key or derivation failed');
    }
  }

  private isValidStellarAddress(address: string): boolean {
    // Stellar addresses start with G (public keys) or C (contracts), 56 characters total
    const stellarAddressRegex = /^[GC][A-Z0-9]{55}$/;
    return stellarAddressRegex.test(address);
  }
}// Plan: Integrate with Hiro Explorer API
// Note: Consider implementing caching for frequently accessed transaction statuses
/** @param {string} txId @returns {Promise<any>} */
