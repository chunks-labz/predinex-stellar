/**
 * Tests for Budget Planner API Routes
 * 
 * Issue #1299: Test divide-by-zero fixes in optimize-fees endpoint
 */

import request from 'supertest';
import express, { Express } from 'express';
import budgetRouter from '../budget';

describe('Budget API - Optimize Fees Endpoint', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/budget', budgetRouter);
  });

  describe('POST /api/budget/optimize-fees', () => {
    describe('Issue #1299: Divide-by-zero handling', () => {
      it('should handle currentFeeBps = 0 without throwing', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 0,
            avgPoolSize: '1000000',
            competitorFees: [],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.currentFeeBps).toBe(0);
        expect(response.body.data.recommendedFeeBps).toBeGreaterThan(0);
        expect(response.body.data.expectedVolumeImpactPct).toBeDefined();
        expect(response.body.data.competitivenessScore).toBeGreaterThanOrEqual(0);
        expect(response.body.data.competitivenessScore).toBeLessThanOrEqual(100);
      });

      it('should handle currentFeeBps = 0 with competitor data', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 0,
            avgPoolSize: '5000000000',
            competitorFees: [250, 280, 300, 320],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.currentFeeBps).toBe(0);
        expect(response.body.data.recommendedFeeBps).toBeGreaterThan(0);
        // Should recommend slightly below market average
        expect(response.body.data.recommendedFeeBps).toBeLessThan(300);
      });

      it('should handle empty competitorFees array without divide-by-zero', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 0,
            avgPoolSize: '1000000',
            competitorFees: [],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.competitivenessScore).toBeGreaterThanOrEqual(0);
      });

      it('should not produce Infinity or NaN in calculations', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 0,
            avgPoolSize: '10000000',
            competitorFees: [],
          })
          .expect(200);

        const data = response.body.data;
        expect(Number.isFinite(data.expectedVolumeImpactPct)).toBe(true);
        expect(Number.isFinite(data.competitivenessScore)).toBe(true);
        expect(data.expectedVolumeImpactPct).not.toBe(Infinity);
        expect(data.expectedVolumeImpactPct).not.toBe(-Infinity);
        expect(Number.isNaN(data.expectedVolumeImpactPct)).toBe(false);
      });

      it('should handle very large volume impact gracefully', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 0,
            avgPoolSize: '999999999999',
            competitorFees: [100],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Volume impact should be clamped
        expect(response.body.data.expectedVolumeImpactPct).toBeGreaterThanOrEqual(-99);
      });
    });

    describe('Normal operation', () => {
      it('should optimize fees with valid non-zero currentFeeBps', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 300,
            avgPoolSize: '50000000000',
            competitorFees: [250, 280, 320, 300, 275],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.currentFeeBps).toBe(300);
        expect(response.body.data.recommendedFeeBps).toBeGreaterThan(0);
        expect(response.body.data.competitivenessScore).toBeGreaterThanOrEqual(0);
      });

      it('should reject negative currentFeeBps', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: -100,
            avgPoolSize: '1000000',
            competitorFees: [],
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      it('should reject currentFeeBps > 10000', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 15000,
            avgPoolSize: '1000000',
            competitorFees: [],
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should reject invalid avgPoolSize', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 300,
            avgPoolSize: 'invalid',
            competitorFees: [],
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      });

      it('should reject invalid competitorFees values', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 300,
            avgPoolSize: '1000000',
            competitorFees: [100, -50, 200],
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      });
    });

    describe('Edge cases', () => {
      it('should handle maximum valid fee', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 10000,
            avgPoolSize: '1000000',
            competitorFees: [9000, 9500],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should handle very small pool size', async () => {
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 100,
            avgPoolSize: '1',
            competitorFees: [],
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });

      it('should handle large number of competitors', async () => {
        const competitorFees = Array(100).fill(0).map((_, i) => 200 + i);
        
        const response = await request(app)
          .post('/api/budget/optimize-fees')
          .send({
            currentFeeBps: 250,
            avgPoolSize: '10000000',
            competitorFees,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('GET /api/budget/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/budget/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.service).toBe('Budget Planner API');
      expect(response.body.version).toBeDefined();
    });
  });
});
