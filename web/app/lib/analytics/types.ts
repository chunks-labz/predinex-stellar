/**
 * Core Analytics Data Models for Market Analytics System
 * These interfaces define the structure for all analytics data
 */

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
  metadata?: Record<string, unknown>;
}

export interface TimeRange {
  start: number;
  end: number;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

export interface PoolAnalytics {
  poolId: number;
  title: string;
  creator: string;
  createdAt: number;
  settledAt?: number;
  expiry: number;
  
  // Volume metrics
  totalVolume: number;
  volumeA: number;
  volumeB: number;
  participantCount: number;
  uniqueBettors: number;
  
  // Performance metrics
  settlementTime?: number;
  disputeCount: number;
  finalOdds: { A: number; B: number };
  
  // Time series data
  volumeHistory: TimeSeriesPoint[];
  oddsHistory: TimeSeriesPoint[];
  participantHistory: TimeSeriesPoint[];
  
  // Status
  status: 'active' | 'settled' | 'expired' | 'disputed';
  category?: string;
}

export interface CreatorAnalytics {
  address: string;
  
  // Basic metrics
  totalPoolsCreated: number;
  totalVolumeManaged: number;
  averagePoolSize: number;
  
  // Performance metrics
  settlementAccuracy: number;
  averageSettlementTime: number;
  disputeRate: number;
  onTimeSettlementRate: number;
  
  // Reputation
  reputationScore: number;
  reliabilityRating: 'excellent' | 'good' | 'fair' | 'poor';
  
  // Historical data
  performanceHistory: TimeSeriesPoint[];
  categoryDistribution: CategoryDistribution[];
  
  // Recent activity
  recentPools: PoolSummary[];
  trends: CreatorTrends;
}

export interface UserAnalytics {
  address: string;
  
  // Portfolio metrics
  totalBets: number;
  totalWagered: number;
  totalWinnings: number;
  netProfit: number;
  roi: number;
  winRate: number;
  
  // Betting behavior
  averageBetSize: number;
  preferredOutcome: 'A' | 'B' | 'balanced';
  bettingFrequency: number;
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  
  // Performance over time
  profitHistory: TimeSeriesPoint[];
  winRateHistory: TimeSeriesPoint[];
  
  // Market preferences
  favoriteCategories: CategoryPreference[];
  mostProfitableCategories: CategoryPerformance[];
  
  // Current positions
  activeBets: ActiveBet[];
  claimableWinnings: number;
}

export interface PlatformMetrics {
  // Volume metrics
  totalVolume: number;
  dailyVolume: number;
  weeklyVolume: number;
  monthlyVolume: number;
  
  // Pool metrics
  totalPools: number;
  activePools: number;
  settledPools: number;
  expiredPools: number;
  averagePoolSize: number;
  
  // User metrics
  totalUsers: number;
  activeUsers: number;
  newUsers: number;
  userRetentionRate: number;
  
  // Performance metrics
  averageSettlementTime: number;
  disputeRate: number;
  platformFees: number;
  
  // Growth metrics
  volumeGrowthRate: number;
  userGrowthRate: number;
  poolGrowthRate: number;
}

// Supporting interfaces
export interface CategoryDistribution {
  category: string;
  count: number;
  percentage: number;
}

export interface PoolSummary {
  poolId: number;
  title: string;
  status: string;
  volume: number;
  createdAt: number;
}

export interface CreatorTrends {
  volumeTrend: 'up' | 'down' | 'stable';
  accuracyTrend: 'up' | 'down' | 'stable';
  activityTrend: 'up' | 'down' | 'stable';
}

export interface CategoryPreference {
  category: string;
  betCount: number;
  preference: number;
}

export interface CategoryPerformance {
  category: string;
  roi: number;
  winRate: number;
  totalBets: number;
}

export interface ActiveBet {
  poolId: number;
  poolTitle: string;
  betAmount: number;
  outcome: 'A' | 'B';
  potentialWinning: number;
  placedAt: number;
}

export interface TrendAnalysis {
  direction: 'up' | 'down' | 'stable';
  strength: number; // 0-1
  confidence: number; // 0-1
  changeRate: number;
  significantEvents: SignificantEvent[];
}

export interface SignificantEvent {
  timestamp: number;
  type: string;
  description: string;
  impact: number;
}

// Prediction models
export interface PredictionModel {
  modelType: 'outcome_probability' | 'volume_forecast' | 'settlement_time';
  version: string;
  accuracy: number;
  lastTrained: number;
  features: string[];
}

export interface PredictionResult {
  poolId: number;
  modelType: string;
  prediction: unknown;
  confidence: number;
  factors: PredictionFactor[];
  historicalAccuracy: number;
  warnings: string[];
}

export interface PredictionFactor {
  factor: string;
  importance: number;
  value: unknown;
  description: string;
}

export interface ContractEvent {
  eventType: 'pool_created' | 'bet_placed' | 'pool_settled' | 'winnings_claimed';
  blockHeight: number;
  txId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// API interfaces
export interface AnalyticsResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  timestamp: number;
}

export interface SearchFilters {
  category?: string;
  creator?: string;
  dateRange?: TimeRange;
  status?: string;
  minVolume?: number;
  maxVolume?: number;
}

export interface ExportRequest {
  type: 'personal' | 'market' | 'creator';
  format: 'csv' | 'json';
  filters?: SearchFilters;
  timeRange?: TimeRange;
}

export interface ExportResult {
  downloadUrl: string;
  filename: string;
  size: number;
  recordCount: number;
  generatedAt: number;
}