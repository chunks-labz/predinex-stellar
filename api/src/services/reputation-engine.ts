/**
 * User Reputation Protocol Engine.
 */

import {
  ReputationSimulateRequest,
  ReputationSimulateResponse,
  ReputationTier,
  UserReputationDto,
} from '../types/index.js';

export class ReputationEngine {
  private profiles = new Map<string, UserReputationDto>();

  constructor() {
    // Seed initial user profile
    this.profiles.set('GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K'.toLowerCase(), {
      user: 'GCLV6627K7625WXZQJ64KYW6YQ6L5465C5L2Z7E2B4B27QWYWQCX7L4K',
      score: 750,
      tier: 'Gold',
      totalBorrowedVolume: '100000000000',
      totalRepaidVolume: '95000000000',
      onTimeRepaymentsCount: 12,
      lateRepaymentsCount: 0,
      liquidationCount: 0,
      defaultCount: 0,
      lastActivityTime: Math.floor(Date.now() / 1000),
      ltvBoostBps: 400,
      rateDiscountBps: 50,
    });
  }

  public getProfile(userAddress: string): UserReputationDto {
    const existing = this.profiles.get(userAddress.toLowerCase());
    if (existing) return existing;

    const defaultProfile: UserReputationDto = {
      user: userAddress,
      score: 300,
      tier: 'Bronze',
      totalBorrowedVolume: '0',
      totalRepaidVolume: '0',
      onTimeRepaymentsCount: 0,
      lateRepaymentsCount: 0,
      liquidationCount: 0,
      defaultCount: 0,
      lastActivityTime: Math.floor(Date.now() / 1000),
      ltvBoostBps: 0,
      rateDiscountBps: 0,
    };
    this.profiles.set(userAddress.toLowerCase(), defaultProfile);
    return defaultProfile;
  }

  public simulateImpact(request: ReputationSimulateRequest): ReputationSimulateResponse {
    const profile = this.getProfile(request.userAddress);
    const currentScore = profile.score;
    const currentTier = profile.tier;

    let delta = 0;
    switch (request.action) {
      case 'OnTimeRepay': {
        const volume = parseFloat(request.amount || '0');
        const volBonus = Math.min(50, Math.floor(volume / 10_000));
        delta = 15 + volBonus;
        break;
      }
      case 'LateRepay':
        delta = -30;
        break;
      case 'Liquidation':
        delta = -100;
        break;
      case 'Default':
        delta = -250;
        break;
    }

    const projectedScore = Math.max(0, Math.min(1000, currentScore + delta));
    const projectedTier = this.scoreToTier(projectedScore);

    return {
      currentScore,
      currentTier,
      projectedScore,
      projectedTier,
      scoreDelta: delta,
      unlockedLtvBoostBps: this.tierToLtvBoost(projectedTier),
      unlockedRateDiscountBps: this.tierToRateDiscount(projectedTier),
    };
  }

  public getLeaderboard(limit: number = 20): UserReputationDto[] {
    return Array.from(this.profiles.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private scoreToTier(score: number): ReputationTier {
    if (score >= 900) return 'Platinum';
    if (score >= 700) return 'Gold';
    if (score >= 400) return 'Silver';
    return 'Bronze';
  }

  private tierToLtvBoost(tier: ReputationTier): number {
    switch (tier) {
      case 'Platinum': return 600;
      case 'Gold': return 400;
      case 'Silver': return 200;
      case 'Bronze': return 0;
    }
  }

  private tierToRateDiscount(tier: ReputationTier): number {
    switch (tier) {
      case 'Platinum': return 100;
      case 'Gold': return 50;
      case 'Silver': return 25;
      case 'Bronze': return 0;
    }
  }
}
