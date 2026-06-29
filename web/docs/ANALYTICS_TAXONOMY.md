# Analytics Taxonomy

**Issue:** #249  
**Status:** Canonical Reference  
**Last Updated:** 2026-04-29

This document defines the canonical event vocabulary for product analytics across wallet, market, and transaction flows in the Predinex application. All analytics instrumentation must use the event names and payload shapes defined here.

---

## Table of Contents

1. [Overview](#overview)
2. [Privacy & Telemetry Policy](#privacy--telemetry-policy)
3. [Event Categories](#event-categories)
4. [Wallet Flow Events](#wallet-flow-events)
5. [Market Discovery Events](#market-discovery-events)
6. [Market Creation Events](#market-creation-events)
7. [Betting Flow Events](#betting-flow-events)
8. [Claim Flow Events](#claim-flow-events)
9. [Failure Events](#failure-events)
10. [Implementation Guide](#implementation-guide)

---

## Overview

### Purpose

This taxonomy provides:
- **Consistency**: Typed event names prevent instrumentation drift
- **Completeness**: Coverage of all major user flows
- **Privacy**: Explicit rules for sensitive data handling
- **Maintainability**: Single source of truth for analytics schema

### Event Structure

All analytics events follow this structure:

```typescript
interface AnalyticsEvent {
  event: EventName;           // Canonical event name from this taxonomy
  timestamp: string;          // ISO 8601 timestamp
  properties: EventPayload;   // Event-specific payload (typed)
  context?: EventContext;     // Optional shared context
}
```

### Shared Context

Optional context fields available on all events:

```typescript
interface EventContext {
  sessionId?: string;         // Anonymous session identifier
  networkType?: 'mainnet' | 'testnet';
  appVersion?: string;
  userAgent?: string;
}
```

---

## Privacy & Telemetry Policy

### Prohibited Data

The following data types **MUST NEVER** be captured in analytics events:

- ❌ Wallet addresses (Stellar public keys: `G...`, contract IDs: `C...`)
- ❌ Private keys or seed phrases
- ❌ Transaction signatures
- ❌ XDR transaction envelopes
- ❌ Personal identifiable information (PII): names, emails, IP addresses
- ❌ Precise geolocation data

### Permitted Data

The following data types are safe to capture:

- ✅ Anonymous session identifiers (randomly generated, not tied to wallet)
- ✅ Aggregate metrics (counts, sums, averages)
- ✅ Timing data (durations, timestamps)
- ✅ Error messages (after redaction via `redactSensitiveData()`)
- ✅ UI interaction patterns (clicks, navigation)
- ✅ Network type (mainnet/testnet)
- ✅ Pool IDs (public on-chain identifiers)

### Redaction

All error messages and free-text fields must be processed through the `redactSensitiveData()` function from `web/app/lib/error-reporter.ts` before emission.

---

## Event Categories

Events are organized into six functional categories:

| Category | Prefix | Description |
|----------|--------|-------------|
| **Wallet** | `wallet.*` | Wallet connection and disconnection flows |
| **Market Discovery** | `market.discovery.*` | Browsing, searching, and filtering markets |
| **Market Creation** | `market.create.*` | Pool creation flow |
| **Betting** | `bet.*` | Placing bets on markets |
| **Claim** | `claim.*` | Claiming winnings or refunds |
| **Failure** | `*.failure` | Error states across all flows |

---

## Wallet Flow Events

### `wallet.connect.attempt`

**Trigger:** User initiates wallet connection (clicks connect button)

**Payload:**
```typescript
interface WalletConnectAttemptPayload {
  walletType?: 'freighter' | 'xbull' | 'albedo' | 'walletconnect' | 'unknown';
}
```

**Example:**
```typescript
emitAnalyticsEvent({
  event: 'wallet.connect.attempt',
  timestamp: new Date().toISOString(),
  properties: {
    walletType: 'freighter'
  }
});
```

---

### `wallet.connect.success`

**Trigger:** Wallet connection completes successfully

**Payload:**
```typescript
interface WalletConnectSuccessPayload {
  walletType: 'freighter' | 'xbull' | 'albedo' | 'walletconnect' | 'unknown';
  durationMs: number;  // Time from attempt to success
}
```

**Privacy Note:** Do NOT include the connected wallet address.

---

### `wallet.connect.cancel`

**Trigger:** User cancels wallet connection (closes popup, rejects in wallet)

**Payload:**
```typescript
interface WalletConnectCancelPayload {
  walletType?: 'freighter' | 'xbull' | 'albedo' | 'walletconnect' | 'unknown';
  durationMs: number;  // Time from attempt to cancellation
}
```

---

### `wallet.connect.failure`

**Trigger:** Wallet connection fails due to error

**Payload:**
```typescript
interface WalletConnectFailurePayload {
  walletType?: 'freighter' | 'xbull' | 'albedo' | 'walletconnect' | 'unknown';
  errorMessage: string;  // MUST be redacted
  errorCode?: string;
  durationMs: number;
}
```

**Privacy Note:** `errorMessage` must be processed through `redactSensitiveData()`.

---

### `wallet.disconnect`

**Trigger:** User disconnects wallet

**Payload:**
```typescript
interface WalletDisconnectPayload {
  sessionDurationMs?: number;  // Time since connection
  interactionCount?: number;   // Number of transactions during session
}
```

---

## Market Discovery Events

### `market.discovery.view`

**Trigger:** User views the market list page

**Payload:**
```typescript
interface MarketDiscoveryViewPayload {
  marketCount: number;        // Number of markets displayed
  filterApplied: boolean;     // Whether any filters are active
  sortBy?: 'volume' | 'expiry' | 'created' | 'trending';
}
```

---

### `market.discovery.search`

**Trigger:** User performs a search query

**Payload:**
```typescript
interface MarketDiscoverySearchPayload {
  queryLength: number;        // Length of search query (not the query itself)
  resultCount: number;        // Number of results returned
  durationMs: number;         // Search execution time
}
```

**Privacy Note:** Do NOT capture the actual search query text.

---

### `market.discovery.filter`

**Trigger:** User applies a filter to the market list

**Payload:**
```typescript
interface MarketDiscoveryFilterPayload {
  filterType: 'status' | 'category' | 'volume' | 'expiry' | 'creator';
  filterValue?: string;       // Generic filter value (e.g., "active", "high_volume")
  resultCount: number;        // Markets matching filter
}
```

---

### `market.discovery.sort`

**Trigger:** User changes sort order

**Payload:**
```typescript
interface MarketDiscoverySortPayload {
  sortBy: 'volume' | 'expiry' | 'created' | 'trending' | 'participants';
  sortDirection: 'asc' | 'desc';
}
```

---

### `market.detail.view`

**Trigger:** User views a specific market detail page

**Payload:**
```typescript
interface MarketDetailViewPayload {
  poolId: number;             // Public pool identifier
  poolStatus: 'open' | 'settled' | 'expired' | 'disputed' | 'frozen';
  volumeRange?: 'low' | 'medium' | 'high';  // Bucketed volume
  timeToExpiry?: number;      // Seconds until expiry (if open)
}
```

---

## Market Creation Events

### `market.create.start`

**Trigger:** User opens the create market form

**Payload:**
```typescript
interface MarketCreateStartPayload {
  source?: 'nav_button' | 'empty_state' | 'dashboard';
}
```

---

### `market.create.preview`

**Trigger:** User previews market before submission

**Payload:**
```typescript
interface MarketCreatePreviewPayload {
  hasDescription: boolean;
  expiryDurationHours: number;  // Bucketed: 1, 6, 24, 168, etc.
  outcomeCount: 2;              // Always 2 for binary markets
}
```

**Privacy Note:** Do NOT capture market title or description text.

---

### `market.create.submit`

**Trigger:** User submits transaction to create market

**Payload:**
```typescript
interface MarketCreateSubmitPayload {
  expiryDurationHours: number;
  hasMetadata: boolean;
}
```

---

### `market.create.success`

**Trigger:** Market creation transaction confirms on-chain

**Payload:**
```typescript
interface MarketCreateSuccessPayload {
  poolId: number;
  durationMs: number;          // Time from submit to confirmation
  blockHeight?: number;        // Ledger sequence
}
```

---

### `market.create.failure`

**Trigger:** Market creation fails

**Payload:**
```typescript
interface MarketCreateFailurePayload {
  errorMessage: string;        // MUST be redacted
  errorCode?: string;
  stage: 'validation' | 'signing' | 'submission' | 'confirmation';
  durationMs: number;
}
```

---

## Betting Flow Events

### `bet.form.open`

**Trigger:** User opens the betting form for a market

**Payload:**
```typescript
interface BetFormOpenPayload {
  poolId: number;
  poolStatus: 'open' | 'settled' | 'expired';
  currentOddsA: number;        // Bucketed odds (e.g., 0.45, 0.50, 0.55)
  currentOddsB: number;
}
```

---

### `bet.amount.input`

**Trigger:** User enters a bet amount (debounced, fires after 1s of inactivity)

**Payload:**
```typescript
interface BetAmountInputPayload {
  poolId: number;
  amountRange: 'micro' | 'small' | 'medium' | 'large' | 'whale';  // Bucketed
  outcome: 0 | 1;              // Outcome A or B
}
```

**Amount Buckets:**
- `micro`: < 10 XLM
- `small`: 10-100 XLM
- `medium`: 100-1000 XLM
- `large`: 1000-10000 XLM
- `whale`: > 10000 XLM

**Privacy Note:** Do NOT capture exact bet amounts.

---

### `bet.preview`

**Trigger:** User previews bet details before submission

**Payload:**
```typescript
interface BetPreviewPayload {
  poolId: number;
  outcome: 0 | 1;
  amountRange: 'micro' | 'small' | 'medium' | 'large' | 'whale';
  estimatedOdds: number;       // Bucketed to 2 decimals
}
```

---

### `bet.submit`

**Trigger:** User submits bet transaction

**Payload:**
```typescript
interface BetSubmitPayload {
  poolId: number;
  outcome: 0 | 1;
  amountRange: 'micro' | 'small' | 'medium' | 'large' | 'whale';
}
```

---

### `bet.success`

**Trigger:** Bet transaction confirms on-chain

**Payload:**
```typescript
interface BetSuccessPayload {
  poolId: number;
  outcome: 0 | 1;
  durationMs: number;          // Time from submit to confirmation
  blockHeight?: number;
}
```

---

### `bet.failure`

**Trigger:** Bet transaction fails

**Payload:**
```typescript
interface BetFailurePayload {
  poolId: number;
  outcome: 0 | 1;
  errorMessage: string;        // MUST be redacted
  errorCode?: string;
  stage: 'validation' | 'signing' | 'submission' | 'confirmation';
  durationMs: number;
}
```

---

## Claim Flow Events

### `claim.eligible.view`

**Trigger:** User views a market where they have claimable winnings

**Payload:**
```typescript
interface ClaimEligibleViewPayload {
  poolId: number;
  claimType: 'winnings' | 'refund';
  amountRange: 'micro' | 'small' | 'medium' | 'large' | 'whale';
}
```

---

### `claim.submit`

**Trigger:** User submits claim transaction

**Payload:**
```typescript
interface ClaimSubmitPayload {
  poolId: number;
  claimType: 'winnings' | 'refund';
  amountRange: 'micro' | 'small' | 'medium' | 'large' | 'whale';
}
```

---

### `claim.success`

**Trigger:** Claim transaction confirms on-chain

**Payload:**
```typescript
interface ClaimSuccessPayload {
  poolId: number;
  claimType: 'winnings' | 'refund';
  durationMs: number;
  blockHeight?: number;
}
```

---

### `claim.failure`

**Trigger:** Claim transaction fails

**Payload:**
```typescript
interface ClaimFailurePayload {
  poolId: number;
  claimType: 'winnings' | 'refund';
  errorMessage: string;        // MUST be redacted
  errorCode?: string;
  stage: 'validation' | 'signing' | 'submission' | 'confirmation';
  durationMs: number;
}
```

---

## Failure Events

Failure events follow a consistent pattern across all flows. Each failure event includes:

- `errorMessage`: Human-readable error (redacted)
- `errorCode`: Machine-readable error code (optional)
- `stage`: Where in the flow the failure occurred
- `durationMs`: Time from flow start to failure

### Common Error Stages

| Stage | Description |
|-------|-------------|
| `validation` | Client-side validation failed |
| `signing` | User rejected signature or wallet error |
| `submission` | Transaction submission to network failed |
| `confirmation` | Transaction submitted but failed on-chain |

### Common Error Codes

```typescript
type ErrorCode =
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
```

---

## Implementation Guide

### 1. Create Analytics Service

Create `web/app/lib/analytics/service.ts`:

```typescript
import { redactSensitiveData } from '../error-reporter';
import type { AnalyticsEvent, EventName, EventPayload } from './events';

class AnalyticsService {
  private enabled: boolean = process.env.NODE_ENV === 'production';

  emit<T extends EventName>(
    event: T,
    properties: EventPayload<T>,
    context?: EventContext
  ): void {
    if (!this.enabled) {
      console.info('[analytics]', event, properties);
      return;
    }

    const payload: AnalyticsEvent = {
      event,
      timestamp: new Date().toISOString(),
      properties: this.sanitize(properties),
      context,
    };

    // TODO: Replace with your analytics provider
    // Example: analytics.track(payload.event, payload);
  }

  private sanitize(properties: any): any {
    // Recursively redact sensitive data from all string fields
    if (typeof properties === 'string') {
      return redactSensitiveData(properties);
    }
    if (typeof properties === 'object' && properties !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(properties)) {
        sanitized[key] = this.sanitize(value);
      }
      return sanitized;
    }
    return properties;
  }
}

export const analytics = new AnalyticsService();
```

### 2. Usage Example

```typescript
import { analytics } from '@/app/lib/analytics/service';

// Wallet connection
analytics.emit('wallet.connect.attempt', {
  walletType: 'freighter'
});

// Market creation
analytics.emit('market.create.success', {
  poolId: 42,
  durationMs: 3500,
  blockHeight: 123456
});

// Bet placement
analytics.emit('bet.submit', {
  poolId: 42,
  outcome: 0,
  amountRange: 'medium'
});
```

### 3. Integration Points

| Flow | Component | Events |
|------|-----------|--------|
| Wallet | `WalletButton.tsx` | `wallet.*` |
| Market Discovery | `MarketGrid.tsx`, `SearchBar.tsx` | `market.discovery.*` |
| Market Creation | `CreateMarket.tsx` | `market.create.*` |
| Betting | `BettingSection.tsx` | `bet.*` |
| Claiming | `ClaimWinningsButton.tsx` | `claim.*` |

### 4. Testing

Verify instrumentation:

```typescript
// In tests, check that events are emitted
const mockAnalytics = vi.spyOn(analytics, 'emit');

// Trigger user action
await userEvent.click(connectButton);

// Verify event
expect(mockAnalytics).toHaveBeenCalledWith(
  'wallet.connect.attempt',
  expect.objectContaining({ walletType: 'freighter' })
);
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-29 | Initial taxonomy defined (issue #249) |

---

## References

- [Error Reporter](../app/lib/error-reporter.ts) — Redaction utilities
- [Wallet Telemetry](../app/lib/wallet-telemetry.ts) — Existing wallet events
- [Contract Events](./CONTRACT_EVENTS.md) — On-chain event schemas

