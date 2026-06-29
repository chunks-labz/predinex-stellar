/**
 * Soroban Transaction Service
 *
 * Core service for executing write operations against the Predinex Soroban contract.
 * Handles transaction building, simulation, signing (via Freighter), submission,
 * and polling for final status.
 *
 * This is the primary SDK client for **mutating** contract state (create, bet, claim, settle).
 */

import {
  Address,
  Contract,
  nativeToScVal,
  Networks,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { FreighterWalletClient } from "./freighter-adapter";

/**
 * Result of a Soroban transaction execution.
 */
export interface SorobanTxResult {
  /** Final status of the transaction */
  status: "SUCCESS" | "FAILED";
  /** Transaction hash on the Stellar network */
  txHash: string;
  /** Return value from the contract (if any) */
  returnValue?: xdr.ScVal;
  /** Error message if the transaction failed */
  error?: string;
}

/**
 * Progress stages of a Soroban transaction flow (useful for UI feedback).
 */
export type TxStage =
  | "idle"
  | "simulating"
  | "signing"
  | "submitting"
  | "polling"
  | "success"
  | "error";

/**
 * Main SDK client for executing transactions on the Predinex Soroban contract.
 * Provides high-level methods with built-in simulation, fee prompting, signing,
 * and status polling.
 */

export class SorobanTransactionService {
  private server: rpc.Server;
  private networkPassphrase: string;

/**
   * Creates a new Soroban transaction service.
   *
   * @param rpcUrl - Soroban RPC server URL (e.g. https://soroban-testnet.stellar.org)
   * @param network - Target Stellar network
   */
  constructor(rpcUrl: string, network: "mainnet" | "testnet") {
    this.server = new rpc.Server(rpcUrl);
    this.networkPassphrase = network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
  }

  /**
   * Internal helper that runs the full transaction lifecycle:
   * simulate → assemble → optional fee confirmation → sign → submit → poll.
   */
  private async executeWithFeePrompt(
    tx: Transaction,
    wallet: FreighterWalletClient,
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    onStageChange?.("simulating");
    const simulation = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    const assembledTx = rpc.assembleTransaction(tx, simulation).build();

    if (onFeeEstimated) {
      const proceed = await onFeeEstimated(assembledTx.fee);
      if (!proceed) {
        throw new Error("Transaction cancelled by user");
      }
    }

    onStageChange?.("signing");
    const xdrString = assembledTx.toXDR();
    const signedXdr = await wallet.signTransaction(xdrString, {
      networkPassphrase: this.networkPassphrase,
    });
    const signedTx = new Transaction(signedXdr, this.networkPassphrase);

    onStageChange?.("submitting");
    const submission = await this.server.sendTransaction(signedTx);
    if (submission.status === "ERROR") {
      throw new Error(
        `Submission failed: ${JSON.stringify(submission.errorResult)}`,
      );
    }

    onStageChange?.("polling");
    const result = await this.pollForSuccess(submission.hash);
    onStageChange?.("success");
    return result;
  }

/**
   * Creates a new prediction pool on the Soroban contract.
   *
   * @param wallet - Connected Freighter wallet
   * @param contractId - Deployed Predinex contract ID
   * @param params - Pool configuration
   * @param onStageChange - Optional callback for UI progress updates
   * @param onFeeEstimated - Optional callback to show and confirm fee
   * @returns Transaction execution result
   *
   * @example
   * ```ts
   * const result = await txService.createPool(wallet, contractId, {
   *   title: "Will BTC reach $150k in 2025?",
   *   description: "Monthly prediction market",
   *   outcomeA: "Yes",
   *   outcomeB: "No",
   *   duration: 30 * 86400 // 30 days in seconds
   * });
   * ```
   */
  async createPool(
    wallet: FreighterWalletClient,
    contractId: string,
    params: {
      title: string;
      description: string;
      outcomeA: string;
      outcomeB: string;
      duration: number;
    },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "create_pool",
          new Address(wallet.address).toScVal(),
          nativeToScVal(params.title),
          nativeToScVal(params.description),
          nativeToScVal(params.outcomeA),
          nativeToScVal(params.outcomeB),
          nativeToScVal(params.duration, { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

 /**
   * Places a bet on a specific outcome in a pool.
   *
   * @param wallet - Connected Freighter wallet client
   * @param contractId - Soroban contract ID to invoke
   * @param params.poolId - ID of the pool to bet on
   * @param params.outcome - Index of the outcome being backed
   * @param params.amountStroops - Bet amount in stroops
   * @param onStageChange - Optional callback for transaction stage updates
   * @param onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The submitted transaction result
   *
   * @example
   * ```ts
   * await sorobanTxService.placeBet(wallet, contractId, { poolId: 12, outcome: 1, amountStroops: 5_000_000 });
   * ```
   */
  async placeBet(
    wallet: FreighterWalletClient,
    contractId: string,
    params: { poolId: number; outcome: number; amountStroops: number },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "place_bet",
          new Address(wallet.address).toScVal(),
          nativeToScVal(params.poolId, { type: "u32" }),
          nativeToScVal(params.outcome, { type: "u32" }),
          nativeToScVal(params.amountStroops, { type: "i128" }),
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

  /**
   * Sets minimum and maximum bet limits for a pool (admin/creator operation).
   *
   * @param wallet - Connected Freighter wallet client
   * @param contractId - Soroban contract ID to invoke
   * @param params.poolId - ID of the pool to update
   * @param params.minBetStroops - New minimum bet size, in stroops
   * @param params.maxBetStroops - New maximum bet size, in stroops
   * @param onStageChange - Optional callback for transaction stage updates
   * @param onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The submitted transaction result
   */
  async setPoolBetLimits(
    wallet: FreighterWalletClient,
    contractId: string,
    params: { poolId: number; minBetStroops: number; maxBetStroops: number },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "set_pool_bet_limits",
          new Address(wallet.address).toScVal(),
          nativeToScVal(params.poolId, { type: "u32" }),
          nativeToScVal(params.minBetStroops, { type: "i128" }),
          nativeToScVal(params.maxBetStroops, { type: "i128" }),
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

  /**
   * Claims winnings for a single settled pool the user participated in.
   *
   * @param wallet - Connected Freighter wallet client
   * @param contractId - Soroban contract ID to invoke
   * @param params.poolId - ID of the settled pool to claim winnings from
   * @param onStageChange - Optional callback for transaction stage updates
   * @param onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The submitted transaction result
   *
   * @example
   * ```ts
   * await sorobanTxService.claimWinnings(wallet, contractId, { poolId: 12 });
   * ```
   */
  async claimWinnings(
    wallet: FreighterWalletClient,
    contractId: string,
    params: { poolId: number },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "claim_winnings",
          new Address(wallet.address).toScVal(),
          nativeToScVal(params.poolId, { type: "u32" }),
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

  /**
   * Claims winnings across multiple settled pools in one atomic transaction.
   *
   * @param wallet - Connected Freighter wallet client
   * @param contractId - Soroban contract ID to invoke
   * @param params.poolIds - List of pool IDs to claim (contract caps at 20)
   * @param onStageChange - Optional callback for transaction stage updates
   * @param onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The submitted transaction result
   *
   * @example
   * ```ts
   * await sorobanTxService.claimAllWinnings(wallet, contractId, { poolIds: [12, 14, 19] });
   * ```
   */
  async claimAllWinnings(
    wallet: FreighterWalletClient,
    contractId: string,
    params: { poolIds: number[] },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    // The contract caps a batch at 20 pools; never submit more than that.
    const poolIds = params.poolIds.slice(0, 20);
    if (poolIds.length === 0) throw new Error("No pools to claim");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const poolIdsVec = xdr.ScVal.scvVec(
      poolIds.map((id) => nativeToScVal(id, { type: "u32" })),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "claim_all_winnings",
          new Address(wallet.address).toScVal(),
          poolIdsVec,
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

 /**
   * Decodes the return value of `claim_all_winnings` into the list of pools that actually paid out.
   *
   * @param returnValue - Raw ScVal returned by the contract
   * @returns Array of pool IDs that were successfully claimed
   */
  static decodeClaimedPoolIds(returnValue: xdr.ScVal | undefined): number[] {
    if (!returnValue) return [];
    try {
      const entries = scValToNative(returnValue) as Array<{
        pool_id: number | bigint;
      }>;
      if (!Array.isArray(entries)) return [];
      return entries.map((e) => Number(e.pool_id));
    } catch {
      return [];
    }
  }

  /**
   * Settles a pool by declaring the winning outcome (admin/Oracle operation).
   *
   * @param wallet - Connected Freighter wallet client
   * @param contractId - Soroban contract ID to invoke
   * @param params.poolId - ID of the pool being settled
   * @param params.winningOutcome - Index of the outcome declared as the winner
   * @param onStageChange - Optional callback for transaction stage updates
   * @param onFeeEstimated - Optional callback to approve/reject the estimated fee
   * @returns The submitted transaction result
   */
  async settlePool(
    wallet: FreighterWalletClient,
    contractId: string,
    params: { poolId: number; winningOutcome: number },
    onStageChange?: (stage: TxStage) => void,
    onFeeEstimated?: (feeStroops: string) => Promise<boolean>,
  ): Promise<SorobanTxResult> {
    if (!wallet.address) throw new Error("Wallet not connected");

    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(wallet.address);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "settle_pool",
          new Address(wallet.address).toScVal(),
          nativeToScVal(params.poolId, { type: "u32" }),
          nativeToScVal(params.winningOutcome, { type: "u32" }),
        ),
      )
      .setTimeout(30)
      .build();

    return this.executeWithFeePrompt(tx, wallet, onStageChange, onFeeEstimated);
  }

  private async pollForSuccess(txHash: string): Promise<SorobanTxResult> {
    let attempts = 0;
    while (attempts < 20) {
      const response = await this.server.getTransaction(txHash);
      if (response.status === "SUCCESS") {
        return {
          status: "SUCCESS",
          txHash,
          returnValue: response.returnValue,
        };
      }
      if (response.status === "FAILED") {
        return {
          status: "FAILED",
          txHash,
          error: "Transaction failed on-chain",
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    throw new Error("Transaction polling timed out");
  }
}
