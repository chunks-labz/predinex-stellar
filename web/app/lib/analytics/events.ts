/**
 * Analytics Event Taxonomy
 * 
 * Typed event names and payload shapes for product analytics.
 * This file is the programmatic representation of the canonical taxonomy
 * documented in web/docs/ANALYTICS_TAXONOMY.md.
 * 
 * @see web/docs/ANALYTICS_TAXONOMY.md
 */

// ============================================================================
// Wallet Flow Events
// ============================================================================

export type WalletType = 'freighter' | 'xbull' | 'albedo' | 'walletconnect' | 'unknown';

export interface WalletConnectAttemptPayload {
  walletType?: WalletType;
}

export interface WalletConnectSuccessPayload {
  walletType: WalletType;
  durationMs: number;
}

export interface WalletConnectCancelPayload {
  walletType?: WalletType;
  durationMs: number;
}

export interface WalletConnectFailurePayload {
  walletType?: WalletType;
  errorMessage: string;  // Must be redacted
  errorCode?: string;
  durationMs: number;
}

export interface WalletDisconnectPayload {
  sessionDurationMs?: number;
  interactionCount?: number;
}

// ============================================================================
// Market Discovery Events
// ============================================================================

export type SortBy = 'volume' | 'expiry' | 'created' | 'trending' | 'participants';
export type SortDirection = 'asc' | 'desc';
export type FilterType = 'status' | 'category' | 'volume' | 'expiry' | 'creator';
export type PoolStatus = 'open' | 'settled' | 'expired' | 'disputed' | 'frozen';
export type VolumeRange = 'low' | 'medium' | 'high';

export interface MarketDiscoveryViewPayload {
  marketCount: number;
  filterApplied: boolean;
  sortBy?: SortBy;
}

export interface MarketDiscoverySearchPayload {
  queryLength: number;
  resultCount: number;
  durationMs: number;
}

export interface MarketDiscoveryFilterPayload {
  filterType: FilterType;
  filterValue?: string;
  resultCount: number;
}

export interface MarketDiscoverySortPayload {
  sortBy: SortBy;
  sortDirection: SortDirection;
}

export interface MarketDetailViewPayload {
  poolId: number;
  poolStatus: PoolStatus;
  volumeRange?: VolumeRange;
  timeToExpiry?: number;
}

// ============================================================================
// Market Creation Events
// ============================================================================

export type CreateSource = 'nav_button' | 'empty_state' | 'dashboard';

export interface MarketCreateStartPayload {
  source?: CreateSource;
}

export interface MarketCreatePreviewPayload {
  hasDescription: boolean;
  expiryDurationHours: number;
  outcomeCount: 2;
}

export interface MarketCreateSubmitPayload {
  expiryDurationHours: number;
  hasMetadata: boolean;
}

export interface MarketCreateSuccessPayload {
  poolId: number;
  durationMs: number;
  blockHeight?: number;
}

export interface MarketCreateFailurePayload {
  errorMessage: string;  // Must be redacted
  errorCode?: string;
  stage: ErrorStage;
  durationMs: number;
}

// ============================================================================
// Betting Flow Events
// ============================================================================

export type AmountRange = 'micro' | 'small' | 'medium' | 'large' | 'whale';
export type Outcome = 0 | 1;

export interface BetFormOpenPayload {
  poolId: number;
  poolStatus: PoolStatus;
  currentOddsA: number;
  currentOddsB: number;
}

export interface BetAmountInputPayload {
  poolId: number;
  amountRange: AmountRange;
  outcome: Outcome;
}

export interface BetPreviewPayload {
  poolId: number;
  outcome: Outcome;
  amountRange: AmountRange;
  estimatedOdds: number;
}

export interface BetSubmitPayload {
  poolId: number;
  outcome: Outcome;
  amountRange: AmountRange;
}

export interface BetSuccessPayload {
  poolId: number;
  outcome: Outcome;
  durationMs: number;
  blockHeight?: number;
}

export interface BetFailurePayload {
  poolId: number;
  outcome: Outcome;
  errorMessage: string;  // Must be redacted
  errorCode?: string;
  stage: ErrorStage;
  durationMs: number;
}

// ============================================================================
// Claim Flow Events
// ============================================================================

export type ClaimType = 'winnings' | 'refund';

export interface ClaimEligibleViewPayload {
  poolId: number;
  claimType: ClaimType;
  amountRange: AmountRange;
}

export interface ClaimSubmitPayload {
  poolId: number;
  claimType: ClaimType;
  amountRange: AmountRange;
}

export interface ClaimSuccessPayload {
  poolId: number;
  claimType: ClaimType;
  durationMs: number;
  blockHeight?: number;
}

export interface ClaimFailurePayload {
  poolId: number;
  claimType: ClaimType;
  errorMessage: string;  // Must be redacted
  errorCode?: string;
  stage: ErrorStage;
  durationMs: number;
}

// ============================================================================
// Common Types
// ============================================================================

export type ErrorStage = 'validation' | 'signing' | 'submission' | 'confirmation';

export type ErrorCode =
  | 'WALLET_NOT_CONNECTED'
  | 'INSUFFICIENT_BALANCE'
  | 'POOL_EXPIRED'
  | 'POOL_SETTLED'
  | 'INVALID_OUTCOME'
  | 'INVALID_AMOUNT'
  | 'NETWORK_ERROR'
  | 'USER_REJECTED'
  | 'CONTRACT_ERROR'
  | 'UNKNOWN_ERROR';

// ============================================================================
// Event Name Union
// ============================================================================

export type EventName =
  // Wallet events
  | 'wallet.connect.attempt'
  | 'wallet.connect.success'
  | 'wallet.connect.cancel'
  | 'wallet.connect.failure'
  | 'wallet.disconnect'
  // Market discovery events
  | 'market.discovery.view'
  | 'market.discovery.search'
  | 'market.discovery.filter'
  | 'market.discovery.sort'
  | 'market.detail.view'
  // Market creation events
  | 'market.create.start'
  | 'market.create.preview'
  | 'market.create.submit'
  | 'market.create.success'
  | 'market.create.failure'
  // Betting events
  | 'bet.form.open'
  | 'bet.amount.input'
  | 'bet.preview'
  | 'bet.submit'
  | 'bet.success'
  | 'bet.failure'
  // Claim events
  | 'claim.eligible.view'
  | 'claim.submit'
  | 'claim.success'
  | 'claim.failure';

// ============================================================================
// Event Payload Mapping
// ============================================================================

export interface EventPayloadMap {
  // Wallet events
  'wallet.connect.attempt': WalletConnectAttemptPayload;
  'wallet.connect.success': WalletConnectSuccessPayload;
  'wallet.connect.cancel': WalletConnectCancelPayload;
  'wallet.connect.failure': WalletConnectFailurePayload;
  'wallet.disconnect': WalletDisconnectPayload;
  // Market discovery events
  'market.discovery.view': MarketDiscoveryViewPayload;
  'market.discovery.search': MarketDiscoverySearchPayload;
  'market.discovery.filter': MarketDiscoveryFilterPayload;
  'market.discovery.sort': MarketDiscoverySortPayload;
  'market.detail.view': MarketDetailViewPayload;
  // Market creation events
  'market.create.start': MarketCreateStartPayload;
  'market.create.preview': MarketCreatePreviewPayload;
  'market.create.submit': MarketCreateSubmitPayload;
  'market.create.success': MarketCreateSuccessPayload;
  'market.create.failure': MarketCreateFailurePayload;
  // Betting events
  'bet.form.open': BetFormOpenPayload;
  'bet.amount.input': BetAmountInputPayload;
  'bet.preview': BetPreviewPayload;
  'bet.submit': BetSubmitPayload;
  'bet.success': BetSuccessPayload;
  'bet.failure': BetFailurePayload;
  // Claim events
  'claim.eligible.view': ClaimEligibleViewPayload;
  'claim.submit': ClaimSubmitPayload;
  'claim.success': ClaimSuccessPayload;
  'claim.failure': ClaimFailurePayload;
}

export type EventPayload<T extends EventName> = EventPayloadMap[T];

// ============================================================================
// Event Context
// ============================================================================

export interface EventContext {
  sessionId?: string;
  networkType?: 'mainnet' | 'testnet';
  appVersion?: string;
  userAgent?: string;
}

// ============================================================================
// Analytics Event Structure
// ============================================================================

export interface AnalyticsEvent<T extends EventName = EventName> {
  event: T;
  timestamp: string;
  properties: EventPayloadMap[T];
  context?: EventContext;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Bucket a token amount into a privacy-safe range.
 * 
 * @param amount - Amount in stroops (1 XLM = 10^7 stroops)
 * @returns Bucketed amount range
 */
export function bucketAmount(amount: bigint | number): AmountRange {
  const xlm = Number(amount) / 10_000_000;
  
  if (xlm < 1) return 'micro';
  if (xlm < 100) return 'small';
  if (xlm < 1000) return 'medium';
  if (xlm < 10000) return 'large';
  return 'whale';
}

/**
 * Bucket pool volume into a privacy-safe range.
 * 
 * @param volume - Total pool volume in stroops
 * @returns Bucketed volume range
 */
export function bucketVolume(volume: bigint | number): VolumeRange {
  const xlm = Number(volume) / 10_000_000;
  
  if (xlm < 1000) return 'low';
  if (xlm < 10000) return 'medium';
  return 'high';
}

/**
 * Round odds to 2 decimal places for privacy.
 * 
 * @param odds - Raw odds value (0-1)
 * @returns Rounded odds
 */
export function bucketOdds(odds: number): number {
  return Math.round(odds * 100) / 100;
}
