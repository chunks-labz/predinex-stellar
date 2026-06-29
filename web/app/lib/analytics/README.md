# Analytics Module

Canonical analytics taxonomy for product instrumentation in Predinex.

## Overview

This module provides:
- **Typed event definitions** for all product flows
- **Privacy-safe instrumentation** with automatic sensitive data redaction
- **Consistent event naming** across the application
- **Flexible provider integration** for any analytics backend

## Quick Start

### 1. Import the analytics service

```typescript
import { analytics } from '@/app/lib/analytics';
```

### 2. Emit events

```typescript
// Wallet connection
analytics.emit('wallet.connect.success', {
  walletType: 'freighter',
  durationMs: 1500
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

### 3. Use timing utilities

```typescript
import { startTimer } from '@/app/lib/analytics';

const timer = startTimer();

// ... perform operation

analytics.emit('claim.success', {
  poolId: 42,
  claimType: 'winnings',
  durationMs: timer.elapsed()
});
```

## Documentation

- **[Analytics Taxonomy](../../../docs/ANALYTICS_TAXONOMY.md)** — Canonical event reference
- **[Event Types](./events.ts)** — TypeScript definitions
- **[Service API](./service.ts)** — Analytics service implementation

## Event Categories

| Category | Events | Description |
|----------|--------|-------------|
| **Wallet** | `wallet.*` | Connection, disconnection, failures |
| **Market Discovery** | `market.discovery.*` | Browsing, searching, filtering |
| **Market Creation** | `market.create.*` | Pool creation flow |
| **Betting** | `bet.*` | Placing bets |
| **Claiming** | `claim.*` | Claiming winnings/refunds |

## Privacy & Security

### Automatic Redaction

All events are automatically sanitized to remove:
- Wallet addresses (Stellar public keys)
- Private keys and signatures
- Transaction hashes and XDR envelopes
- Personal identifiable information (PII)

### Amount Bucketing

Exact token amounts are never captured. Instead, amounts are bucketed:

```typescript
import { bucketAmount } from '@/app/lib/analytics';

const amount = 150_000_000; // 15 XLM
const bucket = bucketAmount(amount); // 'small'

analytics.emit('bet.submit', {
  poolId: 42,
  outcome: 0,
  amountRange: bucket  // 'small', not the exact amount
});
```

**Amount Buckets:**
- `micro`: < 10 XLM
- `small`: 10-100 XLM
- `medium`: 100-1000 XLM
- `large`: 1000-10000 XLM
- `whale`: > 10000 XLM

## Integration

### Configure Provider

```typescript
import { analytics } from '@/app/lib/analytics';

// Example: Segment integration
analytics.setProvider({
  track: (event, properties) => {
    window.analytics.track(event, properties);
  }
});

// Example: PostHog integration
analytics.setProvider({
  track: (event, properties) => {
    posthog.capture(event, properties);
  }
});
```

### React Hook

```typescript
import { useAnalytics } from '@/app/lib/analytics';

function MyComponent() {
  const { emit } = useAnalytics();
  
  const handleClick = () => {
    emit('market.detail.view', {
      poolId: 42,
      poolStatus: 'open',
      volumeRange: 'high'
    });
  };
  
  return <button onClick={handleClick}>View Market</button>;
}
```

## Testing

### Mock Analytics in Tests

```typescript
import { vi } from 'vitest';
import { analytics } from '@/app/lib/analytics';

const mockProvider = {
  track: vi.fn()
};

analytics.setProvider(mockProvider);

// Trigger user action
await userEvent.click(button);

// Verify event
expect(mockProvider.track).toHaveBeenCalledWith(
  'wallet.connect.attempt',
  expect.objectContaining({
    walletType: 'freighter'
  })
);
```

### Run Tests

```bash
npm test -- analytics.test.ts
```

## Common Patterns

### Wallet Connection Flow

```typescript
import { analytics, startTimer } from '@/app/lib/analytics';

async function connectWallet(walletType: WalletType) {
  const timer = startTimer();
  
  analytics.emit('wallet.connect.attempt', { walletType });
  
  try {
    await wallet.connect();
    
    analytics.emit('wallet.connect.success', {
      walletType,
      durationMs: timer.elapsed()
    });
  } catch (error) {
    analytics.emit('wallet.connect.failure', {
      walletType,
      errorMessage: error.message,
      errorCode: error.code,
      durationMs: timer.elapsed()
    });
  }
}
```

### Transaction Flow

```typescript
import { analytics, startTimer, bucketAmount } from '@/app/lib/analytics';

async function placeBet(poolId: number, outcome: 0 | 1, amount: bigint) {
  const timer = startTimer();
  const amountRange = bucketAmount(amount);
  
  analytics.emit('bet.submit', { poolId, outcome, amountRange });
  
  try {
    const result = await submitTransaction();
    
    analytics.emit('bet.success', {
      poolId,
      outcome,
      durationMs: timer.elapsed(),
      blockHeight: result.blockHeight
    });
  } catch (error) {
    analytics.emit('bet.failure', {
      poolId,
      outcome,
      errorMessage: error.message,
      stage: 'submission',
      durationMs: timer.elapsed()
    });
  }
}
```

### Market Discovery

```typescript
import { analytics } from '@/app/lib/analytics';

function MarketList({ markets, filters }) {
  useEffect(() => {
    analytics.emit('market.discovery.view', {
      marketCount: markets.length,
      filterApplied: Object.keys(filters).length > 0,
      sortBy: filters.sortBy
    });
  }, [markets, filters]);
  
  // ...
}
```

## Troubleshooting

### Events not appearing in analytics backend

1. Check that the provider is configured:
   ```typescript
   analytics.setProvider(yourProvider);
   ```

2. Enable debug mode in development:
   ```typescript
   analytics.configure({ debug: true });
   ```

3. Check browser console for `[analytics]` logs

### Sensitive data in events

All events are automatically sanitized, but if you notice sensitive data:

1. Verify the field is being redacted in `error-reporter.ts`
2. Add additional redaction patterns if needed
3. Report the issue immediately

### Type errors

Ensure you're using the correct payload shape for each event:

```typescript
// ❌ Wrong
analytics.emit('bet.submit', {
  poolId: 42,
  amount: 1000  // Should be amountRange, not amount
});

// ✅ Correct
analytics.emit('bet.submit', {
  poolId: 42,
  outcome: 0,
  amountRange: 'medium'
});
```

## Contributing

When adding new events:

1. Update `web/docs/ANALYTICS_TAXONOMY.md` with the event definition
2. Add TypeScript types to `events.ts`
3. Add tests to `web/tests/lib/analytics.test.ts`
4. Update this README with usage examples

## References

- [Analytics Taxonomy](../../../docs/ANALYTICS_TAXONOMY.md)
- [Error Reporter](../error-reporter.ts)
- [Contract Events](../../../docs/CONTRACT_EVENTS.md)
