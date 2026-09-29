import { describe, it, expect, beforeEach } from 'vitest';
import { ReputationEngine } from '../src/services/reputation-engine.js';
import { ReputationRouteHandler } from '../src/routes/reputation.js';

describe('User Reputation Protocol Tests', () => {
  let engine: ReputationEngine;
  let handler: ReputationRouteHandler;

  const testUser = 'GB_REPUTED_BORROWER';

  beforeEach(() => {
    engine = new ReputationEngine();
    handler = new ReputationRouteHandler(engine);
  });

  it('fetches default profile for new users (Score 300 / Bronze)', () => {
    const res = handler.handleGetProfile(testUser);
    expect(res.success).toBe(true);
    expect(res.data?.score).toBe(300);
    expect(res.data?.tier).toBe('Bronze');
    expect(res.data?.ltvBoostBps).toBe(0);
  });

  it('simulates score increase for on-time repayment and volume bonus', () => {
    const res = handler.handleSimulateAction({
      userAddress: testUser,
      action: 'OnTimeRepay',
      amount: '50000', // $50k volume -> +5 vol bonus + 15 base = +20
    });

    expect(res.success).toBe(true);
    expect(res.data?.currentScore).toBe(300);
    expect(res.data?.projectedScore).toBe(320);
    expect(res.data?.scoreDelta).toBe(20);
  });

  it('simulates severe penalty for default (-250 points)', () => {
    const res = handler.handleSimulateAction({
      userAddress: 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K', // Seeded Gold score 750
      action: 'Default',
    });

    expect(res.data?.currentScore).toBe(750);
    expect(res.data?.projectedScore).toBe(500);
    expect(res.data?.projectedTier).toBe('Silver');
  });

  it('retrieves sorted leaderboard of top borrowers', () => {
    const res = handler.handleLeaderboard();
    expect(res.success).toBe(true);
    expect(res.data?.length).toBeGreaterThan(0);
    expect(res.data![0].score).toBeGreaterThanOrEqual(res.data![res.data!.length - 1].score);
  });
});

