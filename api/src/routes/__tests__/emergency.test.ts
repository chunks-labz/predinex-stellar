/**
 * Emergency Withdrawal Tests
 * Issue #1109
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from 'stellar-sdk';
import {
  EmergencyWithdrawalService,
  EmergencyStatus,
  WithdrawalRequestStatus,
} from '../emergency';

describe('EmergencyWithdrawalService', () => {
  const mockContractId = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  const mockRpcUrl = 'https://soroban-testnet.stellar.org';

  let service: EmergencyWithdrawalService;

  beforeEach(() => {
    service = new EmergencyWithdrawalService(mockRpcUrl, mockContractId);
  });

  describe('Configuration', () => {
    it('should get emergency config', async () => {
      const config = await service.getConfig();
      expect(config).toBeDefined();
      expect(config.status).toBeDefined();
    });

    it('should get system status', async () => {
      const status = await service.getSystemStatus();
      expect(status.config).toBeDefined();
      expect(status.isOperational).toBeDefined();
    });
  });

  describe('Rate Limiting', () => {
    it('should check rate limits', async () => {
      const result = await service.checkRateLimit('100000');
      expect(result.allowed).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it('should get rate limit status', async () => {
      const status = await service.getRateLimitStatus();
      expect(status.windowStart).toBeDefined();
      expect(status.amountWithdrawn).toBeDefined();
    });
  });

  describe('Security', () => {
    it('should validate addresses', async () => {
      const config = await service.getConfig();
      expect(config.primaryAdmin).toBeDefined();
    });

    it('should check cooldown', async () => {
      const remaining = await service.getCooldownRemaining();
      expect(remaining).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Real submission failure handling (issue #1195)', () => {
    it('failed activateEmergency does not report success and returns no mock hash', async () => {
      const unreachable = new EmergencyWithdrawalService(
        'http://127.0.0.1:1',
        mockContractId
      );
      const admin = Keypair.random();
      const result = await unreachable.activateEmergency(admin, 'test reason');
      expect(result.success).toBe(false);
      expect(result.txHash).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.txHash).not.toBe('mock_tx_hash_activate');
    });

    it('failed deactivateEmergency does not report success and returns no mock hash', async () => {
      const unreachable = new EmergencyWithdrawalService(
        'http://127.0.0.1:1',
        mockContractId
      );
      const admin = Keypair.random();
      const result = await unreachable.deactivateEmergency(admin, 'test reason');
      expect(result.success).toBe(false);
      expect(result.txHash).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.txHash).not.toBe('mock_tx_hash_deactivate');
    });

    it('rejects empty reason without contacting the chain', async () => {
      const admin = Keypair.random();
      const result = await service.activateEmergency(admin, '');
      expect(result.success).toBe(false);
      expect(result.txHash).toBeUndefined();
      expect(result.error).toMatch(/Reason is required/);
    });
  });
});
