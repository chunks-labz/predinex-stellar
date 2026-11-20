import request from 'supertest';
import app from '../../src/app';
import { BudgetOptimizationResult } from '../../src/types';

describe('POST /api/budget/optimize-fees', () => {
  it('should handle currentFeeBps: 0 without error', async () => {
    const response = await request(app)
      .post('/api/budget/optimize-fees')
      .send({
        currentFeeBps: 0,
        avgPoolSize: '1000000',
        competitorFees: []
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual<BudgetOptimizationResult>({
      recommendedFee: 50,
      feeChangePct: 0,
      volumeImpactPct: 0,
      newVolume: '1000000',
      competitiveness: 0,
      status: 'success'
    });
  });

  it('should return 400 for invalid currentFeeBps', async () => {
    const response = await request(app)
      .post('/api/budget/optimize-fees')
      .send({
        currentFeeBps: -1,
        avgPoolSize: '1000000',
        competitorFees: []
      });

    expect(response.status).toBe(400);
  });

  it('should calculate fee changes correctly with competitor fees', async () => {
    const response = await request(app)
      .post('/api/budget/optimize-fees')
      .send({
        currentFeeBps: 25,
        avgPoolSize: '1000000',
        competitorFees: [50, 75, 100]
      });

    expect(response.status).toBe(200);
    expect(response.body.recommendedFee).toBe(75);
  });
});