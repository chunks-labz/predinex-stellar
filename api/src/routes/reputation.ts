/**
 * User Reputation API Route.
 * Technical Scope: api/src/routes/reputation.ts
 */

import {
  ApiResponse,
  ReputationSimulateRequest,
  ReputationSimulateResponse,
  UserReputationDto,
} from '../types/index.js';
import { ReputationEngine } from '../services/reputation-engine.js';

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
      amount: body.amount ? String(body.amount) : undefined,
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
