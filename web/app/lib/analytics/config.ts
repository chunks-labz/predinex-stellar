/**
 * Analytics System Configuration
 * Contains constants, thresholds, and configuration for the analytics system
 */

import { CONTRACT_ADDRESS as STACKS_CONTRACT_ADDRESS, CONTRACT_NAME as STACKS_CONTRACT_NAME } from '../constants';

export const ANALYTICS_CONFIG = {
  // Performance thresholds
  API_RESPONSE_TIMEOUT: 2000, // 2 seconds
  CHART_RENDER_TIMEOUT: 1000, // 1 second
  EXPORT_TIMEOUT: 10000, // 10 seconds for datasets under 10k records
  BLOCKCHAIN_SYNC_TIMEOUT: 30000, // 30 seconds

  // Data processing
  MAX_EXPORT_RECORDS: 10000,
  CACHE_TTL: 300, // 5 minutes
  BATCH_SIZE: 100,
  
  // Reputation scoring weights
  REPUTATION_WEIGHTS: {
    SETTLEMENT_ACCURACY: 0.4,
    DISPUTE_RATE: 0.3,
    COMPLETION_RATE: 0.2,
    VOLUME_MANAGED: 0.1,
  },

  // Reputation thresholds
  REPUTATION_THRESHOLDS: {
    EXCELLENT: 0.9,
    GOOD: 0.7,
    FAIR: 0.5,
    POOR: 0.0,
  },

  // Risk profile thresholds
  RISK_PROFILE_THRESHOLDS: {
    CONSERVATIVE: {
      MAX_BET_SIZE_RATIO: 0.05, // 5% of total wagered
      MIN_WIN_RATE: 0.6,
    },
    MODERATE: {
      MAX_BET_SIZE_RATIO: 0.15, // 15% of total wagered
      MIN_WIN_RATE: 0.4,
    },
    AGGRESSIVE: {
      MAX_BET_SIZE_RATIO: 1.0, // No limit
      MIN_WIN_RATE: 0.0,
    },
  },

  // Trend analysis
  TREND_ANALYSIS: {
    MIN_DATA_POINTS: 5,
    SIGNIFICANCE_THRESHOLD: 0.05,
    CONFIDENCE_LEVELS: [0.95, 0.90, 0.80],
  },

  // Anomaly detection
  ANOMALY_DETECTION: {
    VOLUME_SPIKE_THRESHOLD: 3.0, // 3x standard deviation
    ODDS_MOVEMENT_THRESHOLD: 0.2, // 20% change
    PARTICIPATION_SPIKE_THRESHOLD: 2.0, // 2x standard deviation
  },

  // Predictive modeling
  PREDICTION_CONFIG: {
    MIN_HISTORICAL_POOLS: 10,
    MODEL_RETRAIN_INTERVAL: 86400000, // 24 hours in ms
    CONFIDENCE_THRESHOLD: 0.6,
    MAX_PREDICTION_HORIZON: 604800000, // 7 days in ms
  },

  // Chart configuration
  CHART_CONFIG: {
    DEFAULT_COLORS: [
      '#3B82F6', // blue
      '#EF4444', // red
      '#10B981', // green
      '#F59E0B', // yellow
      '#8B5CF6', // purple
      '#F97316', // orange
    ],
    ANIMATION_DURATION: 300,
    TOOLTIP_DELAY: 100,
  },

  // Time ranges for analytics
  TIME_RANGES: {
    HOUR: 3600000,
    DAY: 86400000,
    WEEK: 604800000,
    MONTH: 2592000000,
    YEAR: 31536000000,
  },

  // API rate limiting
  RATE_LIMITS: {
    ANALYTICS_API: 100, // requests per minute
    EXPORT_API: 5, // requests per minute
    SEARCH_API: 200, // requests per minute
  },

  // Error retry configuration
  RETRY_CONFIG: {
    MAX_RETRIES: 3,
    BASE_DELAY: 1000, // 1 second
    MAX_DELAY: 10000, // 10 seconds
    BACKOFF_MULTIPLIER: 2,
  },

  // Cache keys
  CACHE_KEYS: {
    POOL_ANALYTICS: 'pool_analytics',
    CREATOR_METRICS: 'creator_metrics',
    USER_ANALYTICS: 'user_analytics',
    PLATFORM_METRICS: 'platform_metrics',
    TRENDS: 'trends',
    PREDICTIONS: 'predictions',
  },
} as const;

// Contract addresses and network configuration
export const NETWORK_CONFIG = {
  MAINNET: {
    // Stacks contract principal + name in `<address>.<name>` form.
    CONTRACT_ADDRESS: `${STACKS_CONTRACT_ADDRESS}.${STACKS_CONTRACT_NAME}`,
    NETWORK_URL: 'https://soroban-testnet.stellar.org',
  },
  TESTNET: {
    // Stacks contract principal + name in `<address>.<name>` form.
    CONTRACT_ADDRESS: `${STACKS_CONTRACT_ADDRESS}.${STACKS_CONTRACT_NAME}`,
    NETWORK_URL: 'https://soroban-testnet.stellar.org',
  },
  DEVNET: {
    // Stacks contract principal + name in `<address>.<name>` form.
    CONTRACT_ADDRESS: `${STACKS_CONTRACT_ADDRESS}.${STACKS_CONTRACT_NAME}`,
    NETWORK_URL: 'http://localhost:8000',
  },
} as const;

// Event types from the smart contract
export const CONTRACT_EVENTS = {
  POOL_CREATED: 'pool_created',
  BET_PLACED: 'bet_placed',
  POOL_SETTLED: 'pool_settled',
  WINNINGS_CLAIMED: 'winnings_claimed',
  DISPUTE_RAISED: 'dispute_raised',
  DISPUTE_RESOLVED: 'dispute_resolved',
} as const;

// Analytics calculation formulas
export const FORMULAS = {
  // ROI calculation: (winnings - bets) / bets
  calculateROI: (winnings: number, bets: number): number => {
    if (bets === 0) return 0;
    return (winnings - bets) / bets;
  },

  // Win rate calculation: wins / total_bets
  calculateWinRate: (wins: number, totalBets: number): number => {
    if (totalBets === 0) return 0;
    return wins / totalBets;
  },

  // Reputation score calculation using weighted factors
  calculateReputationScore: (
    settlementAccuracy: number,
    disputeRate: number,
    completionRate: number,
    volumeScore: number
  ): number => {
    const weights = ANALYTICS_CONFIG.REPUTATION_WEIGHTS;
    return (
      settlementAccuracy * weights.SETTLEMENT_ACCURACY +
      (1 - disputeRate) * weights.DISPUTE_RATE +
      completionRate * weights.COMPLETION_RATE +
      volumeScore * weights.VOLUME_MANAGED
    );
  },

  // Risk profile determination
  determineRiskProfile: (
    averageBetSize: number,
    totalWagered: number,
    winRate: number
  ): 'conservative' | 'moderate' | 'aggressive' => {
    const betSizeRatio = totalWagered > 0 ? averageBetSize / totalWagered : 0;
    
    if (
      betSizeRatio <= ANALYTICS_CONFIG.RISK_PROFILE_THRESHOLDS.CONSERVATIVE.MAX_BET_SIZE_RATIO &&
      winRate >= ANALYTICS_CONFIG.RISK_PROFILE_THRESHOLDS.CONSERVATIVE.MIN_WIN_RATE
    ) {
      return 'conservative';
    } else if (
      betSizeRatio <= ANALYTICS_CONFIG.RISK_PROFILE_THRESHOLDS.MODERATE.MAX_BET_SIZE_RATIO &&
      winRate >= ANALYTICS_CONFIG.RISK_PROFILE_THRESHOLDS.MODERATE.MIN_WIN_RATE
    ) {
      return 'moderate';
    } else {
      return 'aggressive';
    }
  },
} as const;

export type NetworkType = keyof typeof NETWORK_CONFIG;
export type ContractEventType = typeof CONTRACT_EVENTS[keyof typeof CONTRACT_EVENTS];