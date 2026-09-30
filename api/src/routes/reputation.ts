/**
 * User Reputation API Route.
 * Technical Scope: api/src/routes/reputation.ts
 */

import { Router, Request, Response } from 'express';
import {
  ApiResponse,
  ReputationSimulateRequest,
  ReputationSimulateResponse,
  UserReputationDto,
} from '../types/index.js';
import { ReputationEngine } from '../services/reputation-engine.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rate-limit.js';

export class ReputationRouteHandler {
  private engine: ReputationEngine;

  constructor(engine?: ReputationEngine) {
    this.engine = engine || new ReputationEngine();
  }

  public handleGetProfile(address: string): ApiResponse<UserReputationDto> {
    if (!address) {
      return {
        success: false,
        error: { code: 'MISSING_ADDRESS', message: 'User address is required' },
        timestamp: Date.now(),
      };
    }

    const profile = this.engine.getProfile(address);
    return {
      success: true,
      data: profile,
      timestamp: Date.now(),
    };
  }

  /**
   * Token amounts should arrive as decimal strings. A JSON number above 2^53 has
   * already lost precision by the time it is parsed, so it is passed on as an
   * unusable value (earning no volume bonus) rather than guessed at.
   */
  private static readAmount(amount: unknown): string | undefined {
    if (typeof amount === 'number') {
      return Number.isSafeInteger(amount) && amount >= 0 ? String(amount) : 'invalid';
    }
    return amount ? String(amount) : undefined;
  }

  public handleSimulateAction(body: any): ApiResponse<ReputationSimulateResponse> {
    if (!body || !body.userAddress || !body.action) {
      return {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'User address and action are required' },
        timestamp: Date.now(),
      };
    }

    const request: ReputationSimulateRequest = {
      userAddress: String(body.userAddress),
      action: body.action,
      amount: ReputationRouteHandler.readAmount(body.amount),
    };

    const result = this.engine.simulateImpact(request);
    return {
      success: true,
      data: result,
      timestamp: Date.now(),
    };
  }

  public handleLeaderboard(): ApiResponse<UserReputationDto[]> {
    const list = this.engine.getLeaderboard(20);
    return {
      success: true,
      data: list,
      timestamp: Date.now(),
    };
  }
}

/**
 * Express router mounting reputation endpoints.
 * Mount at `/api/reputation` (see `src/app.ts`).
 */
export const reputationRouter = Router();

// One handler (and engine) for the router's lifetime so state — records,
// policies, daily volume counters — persists across requests.
const handler = new ReputationRouteHandler();

reputationRouter.use(authMiddleware);
reputationRouter.use(rateLimitMiddleware);

reputationRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Reputation API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

reputationRouter.get('/profile/:address', (req: Request, res: Response) => {
  const result = handler.handleGetProfile(req.params.address);
  res.status(result.success ? 200 : 400).json(result);
});

reputationRouter.post('/simulate', (req: Request, res: Response) => {
  const result = handler.handleSimulateAction(req.body);
  res.status(result.success ? 200 : 400).json(result);
});

reputationRouter.get('/leaderboard', (_req: Request, res: Response) => {
  res.json(handler.handleLeaderboard());
});

export default reputationRouter;
