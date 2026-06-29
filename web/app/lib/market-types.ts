// Enhanced types for Market Discovery System

export interface PoolData {
  poolId: number;
  creator: string;
  title: string;
  description: string;
  outcomeAName: string;
  outcomeBName: string;
  totalA: bigint;
  totalB: bigint;
  settled: boolean;
  winningOutcome: number | null;
  createdAt: number;
  settledAt: number | null;
  expiry: number;
  participantCount?: number;
  assetType?: string;
  disputed?: boolean;
}

export interface ProcessedMarket {
  poolId: number;
  title: string;
  description: string;
  outcomeA: string;
  outcomeB: string;
  totalVolume: number;
  oddsA: number;
  oddsB: number;
  status: 'active' | 'settled' | 'expired';
  timeRemaining: number | null;
  createdAt: number;
  settledAt: number | null;
  creator: string;
  participantCount?: number;
  assetType?: string;
  disputed?: boolean;
}

export interface MarketFilters {
  search: string;
  status: MarketStatusFilter;
  asset: string;
  minVolume: string;
  maxVolume: string;
  timeRange: TimeRangeFilter;
  sortBy: SortOption;
}

export interface PaginationState {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
}

export type MarketStatus = 'active' | 'settled' | 'expired';
export type MarketStatusFilter = 'all' | 'open' | 'settled' | 'disputed';
export type SortOption = 'newest' | 'ending-soon' | 'volume' | 'participants';
export type TimeRangeFilter = 'all' | 'ending-24h' | 'ending-7d' | 'created-7d' | 'created-30d';
export type StatusFilter = MarketStatusFilter;
