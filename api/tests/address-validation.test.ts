import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecuritySanitizer } from '../src/middleware/security.js';
import { InsuranceRouteHandler, insuranceRouter } from '../src/routes/insurance.js';
import { ComplianceRouteHandler, complianceRouter } from '../src/routes/compliance.js';
import { ReputationRouteHandler, reputationRouter } from '../src/routes/reputation.js';
import { InsuranceEngine } from '../src/services/insurance-engine.js';
import { ComplianceEngine } from '../src/services/compliance-engine.js';
import { ReputationEngine } from '../src/services/reputation-engine.js';

// Issue #1302: '|' slipped through the address character class, and the
// insurance, compliance and reputation routes never validated addresses.

const ACCOUNT = 'GBBWT7WPYVAB2S5CL3YIC7K4HWTARGK2CCJ7T3C3HRKBAFT5P6KP5KK7';
const OTHER_ACCOUNT = 'GDP3O7CA4G5VTVNKVMCD45ZPSQOGAQVWGYATXPK7QNNBPIGTBAFEQKGA';
const CONTRACT = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const PIPE_PREFIXED = '|' + 'A'.repeat(55);

const INVALID_VALUES: unknown[] = [
  PIPE_PREFIXED,
  'not-an-address',
  'G_UNKNOWN_ADDRESS',
  'X' + 'A'.repeat(55),
  'G' + 'A'.repeat(54),
  'G' + 'A'.repeat(56),
  'g' + 'a'.repeat(55),
  12345,
  { address: ACCOUNT },
  [ACCOUNT],
];

describe('SecuritySanitizer.isValidStellarAddress (issue #1302)', () => {
  it("rejects '|' as the first character", () => {
    expect(SecuritySanitizer.isValidStellarAddress(PIPE_PREFIXED)).toBe(false);
  });

  it('accepts G account and C contract addresses', () => {
    expect(SecuritySanitizer.isValidStellarAddress(ACCOUNT)).toBe(true);
    expect(SecuritySanitizer.isValidStellarAddress(CONTRACT)).toBe(true);
  });

  it('rejects malformed values and non-strings', () => {
    for (const value of INVALID_VALUES) {
      expect(SecuritySanitizer.isValidStellarAddress(value), String(value)).toBe(false);
    }
  });

  it('readStellarAddress returns the address unchanged or undefined, never a coerced string', () => {
    expect(SecuritySanitizer.readStellarAddress(ACCOUNT)).toBe(ACCOUNT);
    for (const value of INVALID_VALUES) {
      expect(SecuritySanitizer.readStellarAddress(value), String(value)).toBeUndefined();
    }
  });
});

describe('insurance routes validate addresses (issue #1302)', () => {
  const handler = () => new InsuranceRouteHandler(new InsuranceEngine());

  it('rejects an invalid or non-string holderAddress', () => {
    for (const holderAddress of INVALID_VALUES) {
      const res = handler().handlePurchase({ poolId: 1, holderAddress, coverAmount: '100' });
      expect(res.success, String(holderAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }
  });

  it('rejects an invalid or non-string claimantAddress', () => {
    const h = handler();
    const policy = h.handlePurchase({ poolId: 1, holderAddress: ACCOUNT, coverAmount: '100' });
    expect(policy.success).toBe(true);

    for (const claimantAddress of INVALID_VALUES) {
      const res = h.handleSubmitClaim({
        policyId: policy.data!.policyId,
        claimantAddress,
        lossAmount: '50',
      });
      expect(res.success, String(claimantAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }

    const ok = h.handleSubmitClaim({
      policyId: policy.data!.policyId,
      claimantAddress: ACCOUNT,
      lossAmount: '50',
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.claimant).toBe(ACCOUNT);
  });

  it('returns 400 over HTTP for a malformed holderAddress', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/insurance', insuranceRouter);

    const bad = await request(app)
      .post('/api/insurance/purchase')
      .send({ poolId: 1, holderAddress: 'not-an-address', coverAmount: '100' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ADDRESS');

    const good = await request(app)
      .post('/api/insurance/purchase')
      .send({ poolId: 1, holderAddress: ACCOUNT, coverAmount: '100' });
    expect(good.status).toBe(200);
    expect(good.body.data.holder).toBe(ACCOUNT);
  });
});

describe('compliance routes validate addresses (issue #1302)', () => {
  const handler = () => new ComplianceRouteHandler(new ComplianceEngine());

  it('rejects an invalid or non-string participantAddress on verify', () => {
    for (const participantAddress of INVALID_VALUES) {
      const res = handler().handleVerifyTransaction({ participantAddress, action: 'Deposit' });
      expect(res.success, String(participantAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }
  });

  it('rejects an invalid participantAddress or officerAddress on register', () => {
    for (const participantAddress of INVALID_VALUES) {
      const res = handler().handleRegister({ participantAddress, tier: 'Tier1_Retail' });
      expect(res.success, String(participantAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }
    for (const officerAddress of INVALID_VALUES) {
      const res = handler().handleRegister({
        officerAddress,
        participantAddress: ACCOUNT,
        tier: 'Tier1_Retail',
      });
      expect(res.success, String(officerAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }
  });

  it('registers a participant with valid addresses', () => {
    const res = handler().handleRegister({
      officerAddress: OTHER_ACCOUNT,
      participantAddress: ACCOUNT,
      tier: 'Tier1_Retail',
    });
    expect(res.success).toBe(true);
    expect(res.data?.participant).toBe(ACCOUNT);
  });

  it('returns 400 for a malformed status address and 404 for an unknown valid one', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/compliance', complianceRouter);

    const bad = await request(app).get(`/api/compliance/status/${encodeURIComponent(PIPE_PREFIXED)}`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ADDRESS');

    const unknown = await request(app).get(`/api/compliance/status/${OTHER_ACCOUNT}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });
});

describe('reputation routes validate addresses (issue #1302)', () => {
  const handler = () => new ReputationRouteHandler(new ReputationEngine());

  it('rejects an invalid or non-string userAddress on simulate', () => {
    for (const userAddress of INVALID_VALUES) {
      const res = handler().handleSimulateAction({ userAddress, action: 'OnTimeRepay' });
      expect(res.success, String(userAddress)).toBe(false);
      expect(res.error?.code).toBe('INVALID_ADDRESS');
    }
  });

  it('rejects a malformed profile address', () => {
    const res = handler().handleGetProfile(PIPE_PREFIXED);
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_ADDRESS');
  });

  it('returns 400 over HTTP for a malformed userAddress and 200 for a valid one', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/reputation', reputationRouter);

    const bad = await request(app)
      .post('/api/reputation/simulate')
      .send({ userAddress: 42, action: 'OnTimeRepay' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ADDRESS');

    const good = await request(app)
      .post('/api/reputation/simulate')
      .send({ userAddress: ACCOUNT, action: 'OnTimeRepay' });
    expect(good.status).toBe(200);
    expect(good.body.success).toBe(true);
  });
});
