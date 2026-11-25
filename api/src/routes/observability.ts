import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { logger, serializeError } from '../lib/logger.js';
import {
  defaultIndexerLagMonitor,
  type IndexerLagMonitor,
} from '../services/indexer-lag.js';
import {
  defaultOracleFreshnessMonitor,
  type OracleFreshnessMonitor,
} from '../services/oracle-freshness.js';

export interface ObservabilityServices {
  indexerLag: IndexerLagMonitor;
  oracleFreshness: OracleFreshnessMonitor;
}

const defaults: ObservabilityServices = {
  indexerLag: defaultIndexerLagMonitor,
  oracleFreshness: defaultOracleFreshnessMonitor,
};

export function createObservabilityRouter(services: ObservabilityServices = defaults): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/indexer-lag', async (_req: Request, res: Response) => {
    try {
      const data = await services.indexerLag.collect();
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'OBSERVABILITY_ERROR',
          message: error instanceof Error ? error.message : 'Failed to collect indexer lag',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.get('/oracle-feeds', (_req: Request, res: Response) => {
    const data = services.oracleFreshness.check();
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  });

  router.post('/oracle-feeds', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (typeof body?.feed !== 'string') {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'feed must be a string' },
        timestamp: new Date().toISOString(),
      });
      return;
    }
    try {
      const updatedAt = body.updatedAt === undefined ? undefined : Number(body.updatedAt);
      const data = services.oracleFreshness.recordUpdate(body.feed, updatedAt);
      res.json({ success: true, data, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Invalid feed update',
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  router.get('/metrics', async (_req: Request, res: Response) => {
    try {
      await services.indexerLag.collect();
    } catch (error) {
      logger.warn('indexer_lag_collection_failed', serializeError(error));
    }
    services.oracleFreshness.check();
    res
      .status(200)
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(services.indexerLag.prometheus() + services.oracleFreshness.prometheus());
  });

  return router;
}

export const observabilityRouter = createObservabilityRouter();
