import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  createReferralRouter,
  ReferralContractService,
  RecordReferralRequest,
} from '../src/routes/referral.js';
import { AuthValidator } from '../src/middleware/auth.js';

describe('Referral Route (Issue #1199)', () => {
  let app: express.Express;
  let service: ReferralContractService;
  let authValidator: AuthValidator;

  const validCaller = 'GB5K4G3OD5P6C6365X44X3SOG5XZ52LNX26CYYFXZ55K3IWWJ3QGAYGA';
  const validReferrer = 'GAX765YUVH7654321012345678901234567890123456789012345678';
  const testApiKey = 'test-api-key-123';

  beforeEach(() => {
    service = new ReferralContractService();
    authValidator = new AuthValidator('secret-key');
    authValidator.registerKey(testApiKey, 'User');

    app = express();
    app.use(express.json());
    app.use('/api/referral', createReferralRouter(service, authValidator));
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app)
      .post('/api/referral')
      .send({
        callerAddress: validCaller,
        referrerAddress: validReferrer,
        poolId: 1,
        amount: '1000000',
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Authentication required');
  });

  it('rejects invalid request body with 400 schema validation errors', async () => {
    const res = await request(app)
      .post('/api/referral')
      .set('x-api-key', testApiKey)
      .send({
        callerAddress: validCaller,
        referrerAddress: 'invalid-stellar-address',
        poolId: -1, // invalid pool id
        amount: 'not-a-number',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects self-referrals with 400', async () => {
    const res = await request(app)
      .post('/api/referral')
      .set('x-api-key', testApiKey)
      .send({
        callerAddress: validCaller,
        referrerAddress: validCaller, // Self-referral!
        poolId: 1,
        amount: '1000000',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Self-referral is not allowed');
  });

  it('authenticates caller, invokes contract, and returns transaction result', async () => {
    const mockInvoker = vi.fn(async (req: RecordReferralRequest) => ({
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      callerAddress: req.callerAddress,
      referrerAddress: req.referrerAddress,
      poolId: req.poolId,
      amount: req.amount,
      recordedAt: '2026-09-26T22:00:00.000Z',
    }));

    service.setContractInvoker(mockInvoker);

    const res = await request(app)
      .post('/api/referral')
      .set('x-api-key', testApiKey)
      .send({
        callerAddress: validCaller,
        referrerAddress: validReferrer,
        poolId: 1,
        amount: '2500000',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.txHash).toBe('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    expect(res.body.data.callerAddress).toBe(validCaller);
    expect(res.body.data.referrerAddress).toBe(validReferrer);

    // Verify contract invoker was called with authenticated caller
    expect(mockInvoker).toHaveBeenCalledTimes(1);
    expect(mockInvoker).toHaveBeenCalledWith({
      callerAddress: validCaller,
      referrerAddress: validReferrer,
      poolId: 1,
      amount: '2500000',
    });
  });
});
