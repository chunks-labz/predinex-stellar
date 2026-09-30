/**
 * Emergency Withdrawal API Routes
 * Issue #1109 & Issue #1297: Implement lending pool emergency withdrawal mechanism
 * and fix SSRF and authority decoupling vulnerabilities.
 * 
 * This module provides REST API endpoints for managing emergency withdrawals
 * with comprehensive security, rate limiting, and audit logging.
 */

import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  scValToNative,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from 'stellar-sdk';
import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth.js';
import {
  rateLimitMiddleware,
  strictRateLimitMiddleware,
} from '../middleware/rate-limit.js';

/**
 * Validates and checks RPC URL against network allowlist and blocks private IP / metadata addresses (SSRF protection).
 */
export function validateRpcUrl(rpcUrl: string): string {
  if (!rpcUrl) {
    throw new Error('RPC URL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error('Invalid RPC URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('RPC URL must use http or https protocol');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block cloud metadata and private IP ranges to prevent SSRF
  const isPrivateOrMetadata =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '169.254.169.254' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fd00:') ||
    hostname === '::1';

  if (isPrivateOrMetadata) {
    // In unit test environment, allow local loopback for mock test servers
    if (process.env.NODE_ENV !== 'test' && !process.env.ALLOW_LOCAL_RPC) {
      throw new Error('Blocked connection to private or metadata network address');
    }
  }

  // If server-side allowlist is configured, enforce it
  if (process.env.ALLOWED_RPC_URLS) {
    const allowed = process.env.ALLOWED_RPC_URLS.split(',').map((u) => u.trim().toLowerCase());
    const urlLower = rpcUrl.toLowerCase();
    const isAllowed = allowed.some((a) => urlLower.startsWith(a) || hostname === a);
    if (!isAllowed) {
      throw new Error('RPC URL is not in the server allowlist');
    }
  }

  return rpcUrl;
}

/**
 * Emergency status enum matching contract implementation
 */
export enum EmergencyStatus {
  NORMAL = 'Normal',
  ACTIVE = 'Active',
  CRITICAL = 'Critical',
  DISABLED = 'Disabled',
}

/**
 * Withdrawal request status
 */
export enum WithdrawalRequestStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  EXECUTED = 'Executed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

/**
 * Emergency action types for audit logging
 */
export enum EmergencyAction {
  ACTIVATED = 'Activated',
  DEACTIVATED = 'Deactivated',
  WITHDRAWAL_REQUESTED = 'WithdrawalRequested',
  WITHDRAWAL_APPROVED = 'WithdrawalApproved',
  WITHDRAWAL_EXECUTED = 'WithdrawalExecuted',
  WITHDRAWAL_CANCELLED = 'WithdrawalCancelled',
  CONFIG_UPDATED = 'ConfigUpdated',
  ADMIN_ADDED = 'AdminAdded',
  ADMIN_REMOVED = 'AdminRemoved',
}

/**
 * Emergency configuration interface
 */
export interface EmergencyConfig {
  status: EmergencyStatus;
  primaryAdmin: string;
  secondaryAdmins: string[];
  requiredSignatures: number;
  maxWithdrawalAmount: string;
  maxWithdrawalPerWindow: string;
  rateLimitWindowSecs: number;
  cooldownPeriodSecs: number;
  timelockDelaySecs: number;
  activatedAt: number;
  activationReason: string;
}

/**
 * Withdrawal request interface
 */
export interface WithdrawalRequest {
  id: string;
  initiator: string;
  recipient: string;
  amount: string;
  token: string;
  createdAt: number;
  executableAt: number;
  signatures: string[];
  status: WithdrawalRequestStatus;
  reason: string;
}

/**
 * Rate limit state interface
 */
export interface RateLimitState {
  windowStart: number;
  amountWithdrawn: string;
  lastWithdrawalAt: number;
  remainingAmount: string;
  nextWindowStart: number;
}

/**
 * Audit log entry interface
 */
export interface AuditLogEntry {
  id: string;
  action: EmergencyAction;
  performer: string;
  timestamp: number;
  amount?: string;
  details: string;
}

/**
 * Emergency withdrawal service class
 */
export class EmergencyWithdrawalService {
  private rpcServer: SorobanRpc.Server;
  private contractId: string;
  private networkPassphrase: string;

  constructor(
    rpcUrl: string,
    contractId: string,
    networkPassphrase: string = 'Test SDF Network ; September 2015'
  ) {
    const validatedUrl = validateRpcUrl(rpcUrl);
    this.rpcServer = new SorobanRpc.Server(validatedUrl);
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Build, simulate, sign with `adminKeypair` and submit a real Soroban
   * transaction. Returns the on-chain hash — never a fabricated value.
   * Any failure (simulation error, submission error, missing hash) throws
   * so callers receive `{ success: false }` instead of a false success
   * (see #1195).
   */
  private async submitTransaction(
    adminKeypair: Keypair,
    method: string,
    args: xdr.ScVal[]
  ): Promise<{ txHash: string; returnValue?: unknown }> {
    if (!adminKeypair) {
      throw new Error('Admin keypair is required');
    }
    if (!this.contractId) {
      throw new Error('Contract ID is not configured');
    }
    const adminPublicKey = adminKeypair.publicKey();
    // Validate address format early; throws on malformed keys.
    new Address(adminPublicKey);

    // Verify authority: check if keypair public key matches configured expected admin
    const expectedAdmin = process.env.EMERGENCY_ADMIN_PUBLIC_KEY || process.env.ADMIN_PUBLIC_KEY;
    if (expectedAdmin && expectedAdmin !== adminPublicKey) {
      throw new Error('Unauthorized: Keypair public key does not match configured contract admin');
    }

    const sourceAccount = await this.rpcServer.getAccount(adminPublicKey);
    const contract = new Contract(this.contractId);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '1000',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const simulation: any = await this.rpcServer.simulateTransaction(tx);
    const api: any = (SorobanRpc as any)?.Api;
    const isSimError =
      typeof api?.isSimulationError === 'function'
        ? api.isSimulationError(simulation)
        : Boolean(simulation?.error);
    if (isSimError || simulation?.error) {
      throw new Error(
        `Simulation failed for ${method}: ${simulation?.error || 'unknown error'}`
      );
    }
    const isSimSuccess =
      typeof api?.isSimulationSuccess === 'function'
        ? api.isSimulationSuccess(simulation)
        : true;
    if (!isSimSuccess) {
      throw new Error(`Simulation returned unexpected result for ${method}`);
    }

    let assembled: any = tx;
    const assembler = (SorobanRpc as any)?.assembleTransaction;
    if (typeof assembler === 'function') {
      assembled = assembler(tx, simulation).build();
    }
    assembled.sign(adminKeypair);

    const submission: any = await this.rpcServer.sendTransaction(assembled);
    if (!submission || submission.status === 'ERROR') {
      throw new Error(
        `Transaction submission failed for ${method}: ${JSON.stringify(
          submission?.errorResult ?? submission?.status ?? 'unknown'
        )}`
      );
    }
    const txHash = submission.hash as string;
    if (!txHash) {
      throw new Error(
        `Transaction submission returned no hash for ${method}`
      );
    }

    let returnValue: unknown;
    try {
      const retval = simulation?.result?.retval;
      if (retval) {
        returnValue = scValToNative(retval);
      }
    } catch {
      // Ignore decode errors; hash is still the source of truth.
    }
    return { txHash, returnValue };
  }

  /**
   * Initialize the emergency withdrawal system.
   * Submits a real `initialize` transaction signed by the admin keypair.
   */
  async initialize(
    adminKeypair: Keypair,
    maxWithdrawalAmount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!maxWithdrawalAmount || BigInt(maxWithdrawalAmount) <= 0) {
        return { success: false, error: 'Invalid max withdrawal amount' };
      }
      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const amountScVal = nativeToScVal(BigInt(maxWithdrawalAmount), {
        type: 'i128',
      } as any);
      const { txHash } = await this.submitTransaction(adminKeypair, 'initialize', [
        adminScVal,
        amountScVal,
      ]);
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Activate emergency mode via a real on-chain transaction.
   * The admin keypair signs; the returned hash exists on chain.
   */
  async activateEmergency(
    adminKeypair: Keypair,
    reason: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!reason || reason.trim().length === 0) {
        return { success: false, error: 'Reason is required' };
      }
      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const reasonScVal = nativeToScVal(reason, { type: 'string' } as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'activate_emergency',
        [adminScVal, reasonScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Deactivate emergency mode via a real on-chain transaction.
   */
  async deactivateEmergency(
    adminKeypair: Keypair,
    reason: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!reason || reason.trim().length === 0) {
        return { success: false, error: 'Reason is required' };
      }
      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const reasonScVal = nativeToScVal(reason, { type: 'string' } as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'deactivate_emergency',
        [adminScVal, reasonScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Create an emergency withdrawal request via a real on-chain transaction.
   */
  async requestWithdrawal(
    adminKeypair: Keypair,
    recipient: string,
    amount: string,
    token: string,
    reason: string
  ): Promise<{
    success: boolean;
    requestId?: string;
    txHash?: string;
    error?: string;
  }> {
    try {
      // Validate inputs
      if (!recipient || !this.isValidAddress(recipient)) {
        return { success: false, error: 'Invalid recipient address' };
      }

      if (!amount || BigInt(amount) <= 0) {
        return { success: false, error: 'Invalid amount' };
      }

      if (!token || !this.isValidAddress(token)) {
        return { success: false, error: 'Invalid token address' };
      }

      if (!reason || reason.trim().length === 0) {
        return { success: false, error: 'Reason is required' };
      }

      // Client-side rate-limit pre-check; on-chain limits remain authoritative.
      const rateLimitCheck = await this.checkRateLimit(amount);
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          error: `Rate limit exceeded. ${rateLimitCheck.message}`,
        };
      }

      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const recipientScVal = new Address(recipient).toScVal();
      const amountScVal = nativeToScVal(BigInt(amount), {
        type: 'i128',
      } as any);
      const tokenScVal = new Address(token).toScVal();
      const reasonScVal = nativeToScVal(reason, { type: 'string' } as any);

      const { txHash, returnValue } = await this.submitTransaction(
        adminKeypair,
        'request_withdrawal',
        [adminScVal, recipientScVal, amountScVal, tokenScVal, reasonScVal]
      );
      const requestId =
        returnValue !== undefined && returnValue !== null
          ? String(returnValue)
          : undefined;
      return { success: true, requestId, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Approve a withdrawal request via a real on-chain transaction.
   * Existence and signature checks are enforced by the contract; any
   * submission failure returns success:false (never a mock hash).
   */
  async approveWithdrawal(
    adminKeypair: Keypair,
    requestId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!requestId || requestId.trim().length === 0) {
        return { success: false, error: 'Request ID is required' };
      }
      let requestIdNum: number;
      try {
        requestIdNum = Number(requestId);
        if (!Number.isInteger(requestIdNum) || requestIdNum < 0) {
          return { success: false, error: 'Invalid request ID' };
        }
      } catch {
        return { success: false, error: 'Invalid request ID' };
      }

      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const idScVal = nativeToScVal(requestIdNum, { type: 'u64' } as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'approve_withdrawal',
        [adminScVal, idScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Execute an approved withdrawal request via a real on-chain transaction.
   * Timelock and rate limits are enforced by the contract at execution time.
   */
  async executeWithdrawal(
    adminKeypair: Keypair,
    requestId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!requestId || requestId.trim().length === 0) {
        return { success: false, error: 'Request ID is required' };
      }
      const requestIdNum = Number(requestId);
      if (!Number.isInteger(requestIdNum) || requestIdNum < 0) {
        return { success: false, error: 'Invalid request ID' };
      }

      const executorScVal = new Address(adminKeypair.publicKey()).toScVal();
      const idScVal = nativeToScVal(requestIdNum, { type: 'u64' } as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'execute_withdrawal',
        [executorScVal, idScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Cancel a withdrawal request via a real on-chain transaction.
   */
  async cancelWithdrawal(
    adminKeypair: Keypair,
    requestId: string,
    reason: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!requestId || requestId.trim().length === 0) {
        return { success: false, error: 'Request ID is required' };
      }
      const requestIdNum = Number(requestId);
      if (!Number.isInteger(requestIdNum) || requestIdNum < 0) {
        return { success: false, error: 'Invalid request ID' };
      }
      if (!reason || reason.trim().length === 0) {
        return { success: false, error: 'Reason is required' };
      }

      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const idScVal = nativeToScVal(requestIdNum, { type: 'u64' } as any);
      const reasonScVal = nativeToScVal(reason, { type: 'string' } as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'cancel_withdrawal',
        [adminScVal, idScVal, reasonScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Add a secondary admin via a real on-chain transaction.
   */
  async addAdmin(
    primaryAdminKeypair: Keypair,
    newAdminAddress: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!this.isValidAddress(newAdminAddress)) {
        return { success: false, error: 'Invalid admin address' };
      }

      const primaryScVal = new Address(
        primaryAdminKeypair.publicKey()
      ).toScVal();
      const newAdminScVal = new Address(newAdminAddress).toScVal();
      const { txHash } = await this.submitTransaction(
        primaryAdminKeypair,
        'add_admin',
        [primaryScVal, newAdminScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Update emergency configuration via a real on-chain transaction.
   * Unset fields are passed as None so the contract keeps existing values.
   */
  async updateConfig(
    adminKeypair: Keypair,
    updates: {
      maxWithdrawalAmount?: string;
      requiredSignatures?: number;
      timelockDelaySecs?: number;
    }
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const adminScVal = new Address(adminKeypair.publicKey()).toScVal();
      const maxAmountScVal =
        updates.maxWithdrawalAmount !== undefined
          ? nativeToScVal(BigInt(updates.maxWithdrawalAmount), {
              type: 'i128',
            } as any)
          : nativeToScVal(null as any);
      const sigsScVal =
        updates.requiredSignatures !== undefined
          ? nativeToScVal(updates.requiredSignatures, { type: 'u32' } as any)
          : nativeToScVal(null as any);
      const delayScVal =
        updates.timelockDelaySecs !== undefined
          ? nativeToScVal(updates.timelockDelaySecs, { type: 'u64' } as any)
          : nativeToScVal(null as any);
      const { txHash } = await this.submitTransaction(
        adminKeypair,
        'update_config',
        [adminScVal, maxAmountScVal, sigsScVal, delayScVal]
      );
      return { success: true, txHash };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || String(error),
      };
    }
  }

  /**
   * Get current emergency configuration
   * NOTE: Falls back to safe static defaults when the contract cannot be
   * reached. Mutating methods above never use this fallback to claim
   * success — they submit real transactions (see #1195).
   */
  async getConfig(): Promise<EmergencyConfig> {
    // In production, this would read from contract storage
    return {
      status: EmergencyStatus.NORMAL,
      primaryAdmin: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      secondaryAdmins: [],
      requiredSignatures: 1,
      maxWithdrawalAmount: '1000000',
      maxWithdrawalPerWindow: '3000000',
      rateLimitWindowSecs: 86400,
      cooldownPeriodSecs: 3600,
      timelockDelaySecs: 7200,
      activatedAt: 0,
      activationReason: '',
    };
  }

  /**
   * Get withdrawal request details
   */
  async getRequest(requestId: string): Promise<WithdrawalRequest | null> {
    // In production, this would read from contract storage
    return null;
  }

  /**
   * Get all pending withdrawal requests
   */
  async getPendingRequests(): Promise<WithdrawalRequest[]> {
    // In production, this would query contract storage
    return [];
  }

  /**
   * Get rate limit status
   */
  async getRateLimitStatus(): Promise<RateLimitState> {
    const config = await this.getConfig();
    const now = Math.floor(Date.now() / 1000);

    return {
      windowStart: now - 3600,
      amountWithdrawn: '0',
      lastWithdrawalAt: 0,
      remainingAmount: config.maxWithdrawalPerWindow,
      nextWindowStart: now + config.rateLimitWindowSecs - 3600,
    };
  }

  /**
   * Check if an amount can be withdrawn given current rate limits
   */
  async checkRateLimit(
    amount: string
  ): Promise<{ allowed: boolean; message: string }> {
    try {
      const config = await this.getConfig();
      const rateLimit = await this.getRateLimitStatus();

      const amountBigInt = BigInt(amount);
      const withdrawnBigInt = BigInt(rateLimit.amountWithdrawn);
      const limitBigInt = BigInt(config.maxWithdrawalPerWindow);

      if (withdrawnBigInt + amountBigInt > limitBigInt) {
        const remaining = limitBigInt - withdrawnBigInt;
        return {
          allowed: false,
          message: `Would exceed rate limit. Remaining: ${remaining.toString()} in current window.`,
        };
      }

      return {
        allowed: true,
        message: 'Within rate limits',
      };
    } catch (error: any) {
      return {
        allowed: false,
        message: `Error checking rate limit: ${error.message}`,
      };
    }
  }

  /**
   * Get audit log entries
   */
  async getAuditLogs(
    limit: number = 50,
    offset: number = 0
  ): Promise<AuditLogEntry[]> {
    // In production, this would read from contract storage
    return [];
  }

  /**
   * Get audit logs filtered by action type
   */
  async getAuditLogsByAction(
    action: EmergencyAction,
    limit: number = 50
  ): Promise<AuditLogEntry[]> {
    const allLogs = await this.getAuditLogs(limit);
    return allLogs.filter((log) => log.action === action);
  }

  /**
   * Get audit logs for a specific time range
   */
  async getAuditLogsByTimeRange(
    startTime: number,
    endTime: number
  ): Promise<AuditLogEntry[]> {
    const allLogs = await this.getAuditLogs(1000);
    return allLogs.filter(
      (log) => log.timestamp >= startTime && log.timestamp <= endTime
    );
  }

  /**
   * Validate if a string is a valid Stellar address
   */
  private isValidAddress(address: string): boolean {
    try {
      new Address(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate time remaining until cooldown expires
   */
  async getCooldownRemaining(): Promise<number> {
    const config = await this.getConfig();
    const rateLimit = await this.getRateLimitStatus();
    
    if (rateLimit.lastWithdrawalAt === 0) {
      return 0;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownEnd = rateLimit.lastWithdrawalAt + config.cooldownPeriodSecs;
    
    return Math.max(0, cooldownEnd - now);
  }

  /**
   * Get comprehensive emergency system status
   */
  async getSystemStatus(): Promise<{
    config: EmergencyConfig;
    rateLimit: RateLimitState;
    cooldownRemaining: number;
    pendingRequests: number;
    isOperational: boolean;
  }> {
    const config = await this.getConfig();
    const rateLimit = await this.getRateLimitStatus();
    const cooldownRemaining = await this.getCooldownRemaining();
    const pendingRequests = (await this.getPendingRequests()).length;

    return {
      config,
      rateLimit,
      cooldownRemaining,
      pendingRequests,
      isOperational: config.status !== EmergencyStatus.DISABLED,
    };
  }
}

/**
 * Factory function to create emergency withdrawal service
 */
export function createEmergencyService(
  rpcUrl: string = 'https://soroban-testnet.stellar.org',
  contractId: string,
  networkPassphrase?: string
): EmergencyWithdrawalService {
  return new EmergencyWithdrawalService(rpcUrl, contractId, networkPassphrase);
}

// ===== Express Route Handlers =====

/**
 * Helper to get server environment configuration for emergency operations.
 * Strictly disallows client-supplied rpcUrl, contractId, or adminSecret to prevent SSRF and authority decoupling.
 */
function getEmergencyServerConfig(req: any): {
  rpcUrl: string;
  contractId: string;
  adminSecret?: string;
  error?: string;
} {
  const body = req.body || {};
  const query = req.query || {};

  // Reject any client-supplied rpcUrl to eliminate SSRF
  if (body.rpcUrl !== undefined || query.rpcUrl !== undefined) {
    return {
      rpcUrl: '',
      contractId: '',
      error: 'Client-supplied rpcUrl is forbidden; server environment configuration is enforced',
    };
  }

  // Reject any client-supplied contractId or adminSecret to prevent parameter overriding & authority decoupling
  if (body.contractId !== undefined || query.contractId !== undefined) {
    return {
      rpcUrl: '',
      contractId: '',
      error: 'Client-supplied contractId is forbidden; server environment configuration is enforced',
    };
  }

  if (body.adminSecret !== undefined || query.adminSecret !== undefined) {
    return {
      rpcUrl: '',
      contractId: '',
      error: 'Client-supplied adminSecret is forbidden; server environment configuration is enforced',
    };
  }

  const rpcUrl =
    process.env.SOROBAN_RPC_URL ||
    process.env.RPC_URL ||
    'https://soroban-testnet.stellar.org';
  const contractId =
    process.env.EMERGENCY_CONTRACT_ID ||
    process.env.PREDINEX_CONTRACT_ID ||
    process.env.CONTRACT_ID ||
    'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  const adminSecret =
    process.env.EMERGENCY_ADMIN_SECRET || process.env.ADMIN_SECRET;

  return { rpcUrl, contractId, adminSecret };
}

/**
 * POST /api/emergency/activate
 * Activate emergency mode
 */
export async function handleActivateEmergency(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: reason',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);

    const result = await service.activateEmergency(adminKeypair, reason);

    if (result.success) {
      res.json({
        success: true,
        txHash: result.txHash,
        message: 'Emergency mode activated successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/emergency/deactivate
 * Deactivate emergency mode
 */
export async function handleDeactivateEmergency(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: reason',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);

    const result = await service.deactivateEmergency(adminKeypair, reason);

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/emergency/withdraw/request
 * Create a withdrawal request
 */
export async function handleRequestWithdrawal(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { recipient, amount, token, reason } = req.body;

    if (!recipient || !amount || !token || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: recipient, amount, token, reason',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);

    const result = await service.requestWithdrawal(
      adminKeypair,
      recipient,
      amount,
      token,
      reason
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/emergency/withdraw/approve
 * Approve a withdrawal request
 */
export async function handleApproveWithdrawal(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: requestId',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);

    const result = await service.approveWithdrawal(adminKeypair, requestId);

    if (result.success) {
      res.json(result);
    } else {
      // Client errors (invalid requestId) should return 400, not 500
      const isClientError = result.error?.includes('Invalid request ID') || 
                            result.error?.includes('Request ID is required');

      res.status(isClientError ? 400 : 500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/emergency/withdraw/execute
 * Execute an approved withdrawal
 */
export async function handleExecuteWithdrawal(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: requestId',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);

    const result = await service.executeWithdrawal(adminKeypair, requestId);

    if (result.success) {
      res.json(result);
    } else {
      // Client errors (invalid requestId) should return 400, not 500
      const isClientError = result.error?.includes('Invalid request ID') || 
                            result.error?.includes('Request ID is required');
      res.status(isClientError ? 400 : 500).json(result);
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/emergency/config
 * Get current emergency configuration
 * 
 * NOTE: Returns 501 until contract storage reads are implemented.
 * Hardcoded NORMAL status with success:true is dangerous during incidents
 * (see #1296).
 */
export async function handleGetConfig(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    // Return 501 until contract storage reads are implemented.
    // Never return hardcoded NORMAL status — monitoring relies on this endpoint.
    return res.status(501).json({
      success: false,
      error: 'Emergency config reads not yet implemented. Use contract query directly.',
      details: 'This endpoint will read from contract storage once implemented. Hardcoded stub data removed per #1296.',

    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/emergency/status
 * Get comprehensive system status
 * 
 * NOTE: Returns 501 until contract storage reads are implemented.
 * Hardcoded isOperational:true during an actual emergency is the most
 * dangerous possible failure mode (see #1296).
 */
export async function handleGetSystemStatus(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    // Return 501 until contract storage reads are implemented.
    // Hardcoded NORMAL status would report "operational" during real emergencies.
    return res.status(501).json({
      success: false,
      error: 'Emergency status reads not yet implemented. Use contract query directly.',
      details: 'This endpoint will read from contract storage once implemented. Hardcoded stub data removed per #1296.',

    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * GET /api/emergency/audit-logs
 * Get audit logs
 * 
 * NOTE: Returns 501 until contract storage reads are implemented.
 * Empty audit log with success:true silently under-reports all emergency
 * actions (see #1296).
 */
export async function handleGetAuditLogs(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    // Return 501 until contract storage reads are implemented.
    // Empty audit log implies no emergency actions ever occurred — dangerously misleading.
    return res.status(501).json({
      success: false,
      error: 'Emergency audit log reads not yet implemented. Use contract event query directly.',
      details: 'This endpoint will read from contract storage once implemented. Hardcoded empty array removed per #1296.',

    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/emergency/withdraw/cancel
 * Cancel a withdrawal request (real on-chain transaction).
 */
export async function handleCancelWithdrawal(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { requestId, reason } = req.body;
    if (!requestId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: requestId, reason',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);
    const result = await service.cancelWithdrawal(adminKeypair, requestId, reason);
    res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/emergency/admin/add
 * Add a secondary admin (real on-chain transaction).
 */
export async function handleAddAdmin(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { newAdminAddress } = req.body;
    if (!newAdminAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: newAdminAddress',
      });
    }

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);
    const result = await service.addAdmin(adminKeypair, newAdminAddress);
    res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST /api/emergency/config/update
 * Update emergency configuration (real on-chain transaction).
 */
export async function handleUpdateConfig(req: any, res: any) {
  try {
    const config = getEmergencyServerConfig(req);
    if (config.error) {
      return res.status(400).json({ success: false, error: config.error });
    }

    const { maxWithdrawalAmount, requiredSignatures, timelockDelaySecs } = req.body;

    if (!config.adminSecret) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: EMERGENCY_ADMIN_SECRET is not configured',
      });
    }

    const adminKeypair = Keypair.fromSecret(config.adminSecret);
    const service = createEmergencyService(config.rpcUrl, config.contractId);
    const result = await service.updateConfig(adminKeypair, {
      maxWithdrawalAmount,
      requiredSignatures,
      timelockDelaySecs,
    });
    res.status(result.success ? 200 : 500).json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Express router mounting all emergency endpoints.
 * Mount at `/api/emergency` (see `src/app.ts`).
 * Mutating routes require an Admin API key and use the strict rate limiter
 * (see #1196); read routes require only the shared auth + rate-limit chain.
 */
export const emergencyRouter = Router();

emergencyRouter.use(authMiddleware);
emergencyRouter.use(rateLimitMiddleware);

emergencyRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Emergency API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

emergencyRouter.post(
  '/activate',
  strictRateLimitMiddleware,
  requireAdmin,
  handleActivateEmergency
);
emergencyRouter.post(
  '/deactivate',
  strictRateLimitMiddleware,
  requireAdmin,
  handleDeactivateEmergency
);
emergencyRouter.post(
  '/withdraw/request',
  strictRateLimitMiddleware,
  requireAdmin,
  handleRequestWithdrawal
);
emergencyRouter.post(
  '/withdraw/approve',
  strictRateLimitMiddleware,
  requireAdmin,
  handleApproveWithdrawal
);
emergencyRouter.post(
  '/withdraw/execute',
  strictRateLimitMiddleware,
  requireAdmin,
  handleExecuteWithdrawal
);
emergencyRouter.post(
  '/withdraw/cancel',
  strictRateLimitMiddleware,
  requireAdmin,
  handleCancelWithdrawal
);
emergencyRouter.post(
  '/admin/add',
  strictRateLimitMiddleware,
  requireAdmin,
  handleAddAdmin
);
emergencyRouter.post(
  '/config/update',
  strictRateLimitMiddleware,
  requireAdmin,
  handleUpdateConfig
);
emergencyRouter.get('/config', handleGetConfig);
emergencyRouter.get('/status', handleGetSystemStatus);
emergencyRouter.get('/audit-logs', handleGetAuditLogs);

export default {
  EmergencyWithdrawalService,
  createEmergencyService,
  handleActivateEmergency,
  handleDeactivateEmergency,
  handleRequestWithdrawal,
  handleApproveWithdrawal,
  handleExecuteWithdrawal,
  handleCancelWithdrawal,
  handleAddAdmin,
  handleUpdateConfig,
  handleGetConfig,
  handleGetSystemStatus,
  handleGetAuditLogs,
  emergencyRouter,
};
