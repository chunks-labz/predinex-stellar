/**
 * Shared Type Definitions for Stellar-Lend API Services and Routes.
 */

export type RiskTier = 'Safe' | 'Caution' | 'AtRisk' | 'Liquidatable';
export type ReputationTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
export type ComplianceTier = 'Tier0_Unverified' | 'Tier1_Retail' | 'Tier2_Accredited' | 'Tier3_Institutional';
export type ComplianceAction = 'Deposit' | 'Borrow' | 'Repay' | 'Withdraw' | 'Liquidate' | 'Transfer';

export interface CollateralInput {
  asset: string;
  amount: string; // BigInt serialized as string (stroops or base units)
  priceUsd: number; // e.g. 1.05 or scaled
  liquidationThresholdBps: number; // e.g. 8000 = 80%
  collateralFactorBps: number; // e.g. 7500 = 75%
}

export interface BorrowInput {
  asset: string;
  borrowedAmount: string;
  priceUsd: number;
  borrowRateBps: number; // e.g. 500 = 5%
  accruedInterest?: string;
  lastAccrualTime?: number;
}

export interface PriceShockInput {
  asset: string;
  shockBps: number; // e.g. -2000 = -20%
}

export interface AssetDeltaInput {
  asset: string;
  deltaAmount: string; // can be negative for withdrawal / repayment
}

export interface PositionSimulationRequest {
  positionId?: string;
  userAddress?: string;
  collaterals: CollateralInput[];
  borrows: BorrowInput[];
  priceShocks?: PriceShockInput[];
  collateralDeltas?: AssetDeltaInput[];
  debtDeltas?: AssetDeltaInput[];
  timeDeltaSeconds?: number;
}

export interface StressScenarioSummary {
  name: string;
  collateralShockPct: number;
  debtShockPct: number;
  simulatedHealthFactorBps: number;
  simulatedHealthFactor: number;
  riskTier: RiskTier;
  isLiquidatable: boolean;
}

export interface PositionSimulationResponse {
  initialHealthFactorBps: number;
  initialHealthFactor: number;
  simulatedHealthFactorBps: number;
  simulatedHealthFactor: number;
  simulatedCollateralUsd: number;
  simulatedDebtUsd: number;
  simulatedLiquidationThresholdUsd: number;
  simulatedRiskTier: RiskTier;
  isLiquidatable: boolean;
  shortfallUsd: number;
  maxWithdrawableUsd: number;
  maxBorrowableUsd: number;
  liquidationPriceUsd?: number;
  stressScenarios: StressScenarioSummary[];
  computedAt: number;
}

export interface InsurancePoolDto {
  poolId: number;
  underwritingAsset: string;
  totalStaked: string;
  totalShares: string;
  activeCoverAmount: string;
  availableReserves: string;
  maxCapacity: string;
  minSolvencyRatioBps: number;
  basePremiumRateBps: number;
  utilizationMultiplierBps: number;
  isPaused: boolean;
}

export interface InsuranceQuoteRequest {
  poolId: number;
  coverAmount: string;
  durationSeconds: number;
  riskTier: RiskTier;
}

export interface InsuranceQuoteResponse {
  poolId: number;
  coverAmount: string;
  durationSeconds: number;
  premiumAmount: string;
  annualRateBps: number;
  solvencyRatioBps: number;
  quoteExpiry: number;
  quoteSignature?: string;
}

export interface PolicyPurchaseRequest {
  poolId: number;
  holderAddress: string;
  coverAmount: string;
  durationSeconds: number;
  riskTier: RiskTier;
}

export interface InsurancePolicyDto {
  policyId: number;
  holder: string;
  poolId: number;
  coverAmount: string;
  premiumPaid: string;
  startTime: number;
  expiryTime: number;
  isClaimed: boolean;
  isActive: boolean;
}

export interface ClaimSubmissionRequest {
  policyId: number;
  claimantAddress: string;
  lossAmount: string;
  proofData: string; // Cryptographic hash or signature of bad debt event
}

export interface InsuranceClaimDto {
  claimId: number;
  policyId: number;
  claimant: string;
  lossAmount: string;
  payoutAmount: string;
  filingTime: number;
  isApproved: boolean;
  isPaid: boolean;
  assessor?: string;
}

export interface SolvencyAuditDto {
  poolId: number;
  availableReserves: string;
  activeCover: string;
  solvencyRatioBps: number;
  solvencyRatioPct: number;
  isSolvent: boolean;
  maxSinglePayoutLimit: string;
  utilizationRateBps: number;
}

export interface ComplianceCheckRequest {
  participantAddress: string;
  action: ComplianceAction;
  amountUsd: number;
}

export interface ComplianceCheckResponse {
  isAllowed: boolean;
  participant: string;
  tier: ComplianceTier;
  dailyRemainingUsd: number;
  dailyLimitUsd: number;
  errorCode?: number;
  reason?: string;
  checkedAt: number;
}

export interface RegisterParticipantRequest {
  officerAddress: string;
  participantAddress: string;
  tier: ComplianceTier;
  kycExpiryTimestamp: number;
  jurisdictionCode: number;
  customDailyLimitUsd?: number;
}

export interface ComplianceRecordDto {
  participant: string;
  tier: ComplianceTier;
  kycExpiry: number;
  jurisdictionCode: number;
  isSanctioned: boolean;
  isFrozen: boolean;
  dailyVolumeLimitUsd: number;
  dailyVolumeUsedUsd: number;
  lastResetTimestamp: number;
}

export interface UserReputationDto {
  user: string;
  score: number; // 0 to 1000
  tier: ReputationTier;
  totalBorrowedVolume: string;
  totalRepaidVolume: string;
  onTimeRepaymentsCount: number;
  lateRepaymentsCount: number;
  liquidationCount: number;
  defaultCount: number;
  lastActivityTime: number;
  ltvBoostBps: number;
  rateDiscountBps: number;
}

export interface ReputationSimulateRequest {
  userAddress: string;
  action: 'OnTimeRepay' | 'LateRepay' | 'Liquidation' | 'Default';
  amount?: string;
}

export interface ReputationSimulateResponse {
  currentScore: number;
  currentTier: ReputationTier;
  projectedScore: number;
  projectedTier: ReputationTier;
  scoreDelta: number;
  unlockedLtvBoostBps: number;
  unlockedRateDiscountBps: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: number;
}
