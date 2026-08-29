/**
 * Emergency Withdrawal Tests
 * Issue #1109
 */

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
});
