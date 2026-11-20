/**
 * User Reputation Protocol Engine.
 */

import {
  ReputationSimulateRequest,
  ReputationSimulateResponse,
  ReputationTier,
  UserReputationDto,
} from '../types/index.js';

/**
 * Most volume a preview will credit for a user with no recorded borrow history.
 * The preview cannot see a real repayment, so without a ceiling any sufficiently
 * large caller-supplied number would reach the maximum bonus. 100,000 units
 * yields at most +10 of the +50 maximum; only a user's actual outstanding debt
 * (below) can raise the ceiling further.
 */
export const UNVERIFIED_PREVIEW_VOLUME_CAP = 100_000n;

/** Base units of repaid volume per bonus point, and the largest bonus. */
const VOLUME_PER_BONUS_POINT = 10_000n;
const MAX_VOLUME_BONUS = 50n;

/** Exact non-negative integer parse; anything else is not a usable amount. */
function parseAmountExact(value: string | undefined): bigint | undefined {
  if (value === undefined) return 0n;
  const trimmed = value.trim();
  if (trimmed === '') return 0n;
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : undefined;
}

function toBigInt(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

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
    let volumeCounted: string | undefined;
    let volumeCapped: boolean | undefined;
    switch (request.action) {
      case 'OnTimeRepay': {
        // The amount is caller-supplied and unverified, so it is (1) parsed
        // exactly (no float precision loss above 2^53) and (2) never credited
        // beyond what the user could really repay: their outstanding debt when
        // they have borrow history, otherwise a small fixed ceiling.
        const supplied = parseAmountExact(request.amount);
        const borrowed = toBigInt(profile.totalBorrowedVolume);
        const outstanding = borrowed > 0n ? this.max0(borrowed - toBigInt(profile.totalRepaidVolume)) : undefined;
        const ceiling = outstanding ?? UNVERIFIED_PREVIEW_VOLUME_CAP;

        const usable = supplied ?? 0n; // a malformed amount earns no bonus
        const counted = usable < ceiling ? usable : ceiling;
        const bonus = counted / VOLUME_PER_BONUS_POINT;
        const volBonus = Number(bonus < MAX_VOLUME_BONUS ? bonus : MAX_VOLUME_BONUS);

        volumeCounted = counted.toString();
        volumeCapped = supplied === undefined || counted < usable;
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
      isEstimate: true,
      ...(volumeCounted !== undefined ? { volumeCounted, volumeCapped } : {}),
      currentScore,
      currentTier,
      projectedScore,
      projectedTier,
      scoreDelta: delta,
      unlockedLtvBoostBps: this.tierToLtvBoost(projectedTier),
      unlockedRateDiscountBps: this.tierToRateDiscount(projectedTier),
    };
  }

  private max0(value: bigint): bigint {
    return value > 0n ? value : 0n;
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
