import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceEngine } from '../src/services/compliance-engine.js';
import { ComplianceRouteHandler } from '../src/routes/compliance.js';

describe('Institutional Compliance Engine Tests', () => {
  let engine: ComplianceEngine;
  let handler: ComplianceRouteHandler;

  const testUser = 'GAX765YUVH7654...INST';

  beforeEach(() => {
    engine = new ComplianceEngine();
    handler = new ComplianceRouteHandler(engine);
  });

  it('rejects unverified (Tier 0) participants', () => {
    const res = handler.handleVerifyTransaction({
      participantAddress: 'G_UNKNOWN_ADDRESS',
      action: 'Deposit',
      amountUsd: 1000,
    });

    expect(res.success).toBe(true);
    expect(res.data?.isAllowed).toBe(false);
    expect(res.data?.reason).toContain('not KYC verified');
  });

  it('registers participant and enforces daily tier limits', () => {
    handler.handleRegister({
      officerAddress: 'G_OFFICER',
      participantAddress: testUser,
      tier: 'Tier1_Retail',
      kycExpiryTimestamp: Math.floor(Date.now() / 1000) + 86400 * 365,
      jurisdictionCode: 840,
    });

    // Valid $5,000 transaction (Limit = $10,000)
    const res1 = handler.handleVerifyTransaction({
      participantAddress: testUser,
      action: 'Deposit',
      amountUsd: 5000,
    });
    expect(res1.data?.isAllowed).toBe(true);
    expect(res1.data?.dailyRemainingUsd).toBe(5000);

    // Exceeds remaining $5,000 limit
    const res2 = handler.handleVerifyTransaction({
      participantAddress: testUser,
      action: 'Deposit',
      amountUsd: 6000,
    });
    expect(res2.data?.isAllowed).toBe(false);
    expect(res2.data?.reason).toContain('exceeds remaining daily limit');
  });

  it('blocks sanctioned participants immediately', () => {
    handler.handleRegister({
      participantAddress: testUser,
      tier: 'Tier3_Institutional',
      kycExpiryTimestamp: Math.floor(Date.now() / 1000) + 86400 * 365,
      jurisdictionCode: 840,
    });

    engine.setSanctionStatus(testUser, true);

    const res = handler.handleVerifyTransaction({
      participantAddress: testUser,
      action: 'Borrow',
      amountUsd: 100,
    });

    expect(res.data?.isAllowed).toBe(false);
    expect(res.data?.reason).toContain('sanctions list');
  });

  it('blocks restricted jurisdictions', () => {
    handler.handleRegister({
      participantAddress: testUser,
      tier: 'Tier2_Accredited',
      kycExpiryTimestamp: Math.floor(Date.now() / 1000) + 86400 * 365,
      jurisdictionCode: 408, // Sanctioned jurisdiction code
    });

    const res = handler.handleVerifyTransaction({
      participantAddress: testUser,
      action: 'Deposit',
      amountUsd: 100,
    });

    expect(res.data?.isAllowed).toBe(false);
    expect(res.data?.reason).toContain('Jurisdiction is restricted');
  });

  it('handles getStatus route and not found errors', () => {
    const res = handler.handleGetStatus('G_NON_EXISTENT');
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOT_FOUND');

    const knownUser = 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K';
    const found = handler.handleGetStatus(knownUser);
    expect(found.success).toBe(true);
    expect(found.data?.tier).toBe('Tier2_Accredited');
  });

  it('handles freeze and unfreeze toggles', () => {
    const knownUser = 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K';
    expect(engine.setFrozenStatus(knownUser, true)).toBe(true);
    expect(engine.getRecord(knownUser)?.isFrozen).toBe(true);

    const res = handler.handleVerifyTransaction({
      participantAddress: knownUser,
      action: 'Borrow',
      amountUsd: 1000,
    });
    expect(res.data?.isAllowed).toBe(false);
    expect(res.data?.reason).toContain('temporarily frozen');

    expect(engine.setFrozenStatus(knownUser, false)).toBe(true);
    expect(engine.setFrozenStatus('UNKNOWN', false)).toBe(false);
    expect(engine.setSanctionStatus('UNKNOWN', false)).toBe(false);
  });

  it('handles missing required fields in routes', () => {
    const res1 = handler.handleVerifyTransaction({});
    expect(res1.success).toBe(false);
    expect(res1.error?.code).toBe('INVALID_REQUEST');

    const res2 = handler.handleRegister({});
    expect(res2.success).toBe(false);
    expect(res2.error?.code).toBe('INVALID_REQUEST');
  });
});
