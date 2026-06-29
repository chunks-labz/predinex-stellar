# Pool Activity Timeline Component

## Overview

The `PoolActivityTimeline` component displays a chronological timeline of all events that occur within a prediction pool. It provides transparency and audit trail for pool activities, including bets, settlements, disputes, and claims.

## Features

- **Event Types**: Supports 7 event types:
  - `pool-created` — Pool initially created
  - `bet-placed` — User placed a bet
  - `bet-cancelled` — User cancelled a bet
  - `pool-settled` — Pool settlement occurred
  - `claim-processed` — User claimed winnings
  - `dispute-filed` — Dispute filed against settlement
  - `duration-extended` — Pool expiry extended

- **Rich Event Information**:
  - Relative timestamps (e.g., "2m ago") that update automatically
  - Absolute timestamps (e.g., "May 31, 2026, 2:30 PM") on hover
  - Truncated user addresses with full address on hover
  - Bet amounts (for bet-related events)
  - Outcome labels (contextual to pool outcomes)
  - Transaction hash with explorer link

- **States**:
  - **Loading**: Animated skeleton loader
  - **Empty**: Friendly message when no events exist
  - **Error**: Error display with retry capability
  - **Loaded**: Full timeline with pagination

- **Infinite Scroll**: Displays first 100 events with "Load More" button

## Usage

### Basic Usage

```tsx
import PoolActivityTimeline from '@/app/components/PoolActivityTimeline';

export default function PoolDetail({ poolId }: { poolId: number }) {
  return (
    <div>
      {/* Other pool details... */}
      <PoolActivityTimeline poolId={poolId} />
    </div>
  );
}
```

### With Outcome Labels

```tsx
<PoolActivityTimeline 
  poolId={poolId} 
  outcomeLabels={["Outcome A", "Outcome B"]}
/>
```

### With Custom Max Events

```tsx
<PoolActivityTimeline 
  poolId={poolId} 
  maxInitialEvents={50}
/>
```

## Integration Guide

### 1. Add to Market Detail Page

Edit `web/app/markets/[id]/page.tsx`:

```tsx
import PoolActivityTimeline from '../../components/PoolActivityTimeline';

export default function PoolDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const poolId = parseInt(id);
  
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Existing pool detail content... */}
      
      {/* Add timeline before closing tags */}
      <PoolActivityTimeline 
        poolId={poolId} 
        outcomeLabels={[pool.outcomeA, pool.outcomeB]}
      />
    </main>
  );
}
```

### 2. Connect to API/Contract

Currently, `usePoolActivity` hook returns mock data. To integrate with your contract:

**Edit `web/app/hooks/usePoolActivity.ts`:**

```tsx
const fetchPoolActivity = useCallback(
  async (id: number, limit: number): Promise<PoolActivityEvent[]> => {
    // Call your API or contract adapter
    const events = await predinexReadApi.getPoolActivity(id, limit);
    
    // Transform contract events to PoolActivityEvent format
    return events.map(event => ({
      id: event.txHash,
      type: mapContractEventType(event.eventType),
      poolId: id,
      actor: event.actor,
      timestamp: event.timestamp,
      txHash: event.txHash,
      explorerUrl: buildExplorerUrl(event.txHash),
      amount: event.amount,
      outcome: event.outcome,
      status: event.status,
    }));
  },
  []
);
```

### 3. Add Contract Event Decoding

Create `web/app/lib/pool-activity-decoder.ts` to decode Soroban events:

```tsx
export function decodePoolActivityEvent(
  raw: RawSorobanEvent
): PoolActivityEvent | null {
  const eventName = extractEventName(raw);
  
  const typeMapping: Record<string, PoolActivityEventType> = {
    'pool_created': 'pool-created',
    'bet_placed': 'bet-placed',
    'bet_cancelled': 'bet-cancelled',
    'pool_settled': 'pool-settled',
    'winnings_claimed': 'claim-processed',
    'dispute_filed': 'dispute-filed',
    'duration_extended': 'duration-extended',
  };
  
  const type = typeMapping[eventName];
  if (!type) return null;
  
  return {
    id: raw.txHash,
    type,
    poolId: extractPoolId(raw),
    actor: extractActor(raw),
    timestamp: extractTimestamp(raw),
    txHash: raw.txHash,
    explorerUrl: buildExplorerUrl(raw.txHash),
    amount: extractAmount(raw),
    outcome: extractOutcome(raw),
    status: 'success',
  };
}
```

## Component API

### `PoolActivityTimeline` Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `poolId` | `number` | ✓ | — | The pool ID to fetch activity for |
| `outcomeLabels` | `[string, string]` | — | — | Outcome display labels |
| `maxInitialEvents` | `number` | — | 100 | Maximum events to display initially |

### `usePoolActivity` Hook

```tsx
const { 
  events,      // PoolActivityEvent[]
  isLoading,   // boolean
  error,       // string | null
  hasMore,     // boolean
  loadMore,    // () => void
  refresh,     // () => Promise<void>
} = usePoolActivity(poolId);
```

## Types

### `PoolActivityEvent`

```typescript
interface PoolActivityEvent {
  id: string;
  type: PoolActivityEventType;
  poolId: number;
  actor: string;
  timestamp: number;
  txHash: string;
  explorerUrl: string;
  amount?: number;
  outcome?: number;
  outcomeLabels?: [string, string];
  status: 'success' | 'pending' | 'failed';
}

type PoolActivityEventType = 
  | 'pool-created' 
  | 'bet-placed' 
  | 'bet-cancelled' 
  | 'pool-settled' 
  | 'claim-processed' 
  | 'dispute-filed' 
  | 'duration-extended';
```

## Styling

The component uses Tailwind CSS with the project's existing design system:

- **Glass morphism**: Leverages `.glass` class for frosted effects
- **Status colors**: 
  - `text-green-400` for successful events
  - `text-yellow-400` for pending events
  - `text-red-400` for failed events
- **Timeline line**: Uses `border-l border-border` for vertical connector
- **Icons**: All from `lucide-react`

## Performance Considerations

### Caching

- In-memory cache with 30-second TTL
- Request deduplication using `requestIdRef`
- Cache invalidation on manual refresh

### Rendering

- Memoized `displayedEvents` to prevent unnecessary re-renders
- Skeleton loader shows while fetching
- Maximum 100 events displayed initially
- Pagination with "Load More" button

### Time Updates

- Relative timestamps update every 30 seconds
- Only active component instances update
- Cleanup on unmount

## Accessibility

- `aria-label` on timeline section
- `role="status"` on skeleton loader
- `role="alert"` on error messages
- `aria-hidden="true"` on decorative icons
- Semantic HTML with `<ol>` for ordered timeline
- Proper `<time>` elements with `dateTime` attributes
- `title` attributes for truncated addresses

## Example Integration

See `web/app/markets/[id]/page.tsx` for full integration example with:
- Pool data loading
- User wallet integration
- Refresh functionality
- Error handling

## Future Enhancements

- [ ] Real-time event streaming via WebSocket
- [ ] Event filtering by type
- [ ] Event search/pagination UI
- [ ] Export activity as CSV
- [ ] Event grouping by date
- [ ] Custom time range selection
- [ ] Event notifications
