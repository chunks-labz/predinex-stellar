# Pool Activity Timeline - Integration Guide

## Quick Start

### 1. Add the component to your pool detail page

In `web/app/markets/[id]/page.tsx`, add the import and component:

```tsx
import PoolActivityTimeline from '../../components/PoolActivityTimeline';

export default function PoolDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const poolId = parseInt(id);
  
  // ... existing code ...

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="glass p-8 rounded-2xl border border-border">
          {/* Existing pool content */}
          
          {/* Add timeline */}
          {pool && (
            <PoolActivityTimeline 
              poolId={poolId}
              outcomeLabels={[pool.outcomeA, pool.outcomeB]}
            />
          )}
        </div>
      </div>
    </main>
  );
}
```

### 2. For Development/Testing

Use mock data while building the backend integration:

```tsx
// In usePoolActivity hook
import { generateMockPoolActivityEvents } from '../lib/pool-activity-mock';

const fetchPoolActivity = useCallback(
  async (id: number, limit: number): Promise<PoolActivityEvent[]> => {
    // TODO: Replace with real API call
    // Temporary: Use mock data for development
    const mockEvents = generateMockPoolActivityEvents(id, 15);
    return mockEvents;
  },
  []
);
```

### 3. Connect to Contract Events (Production)

Once you have Soroban event decoding ready:

```tsx
// In usePoolActivity hook
const fetchPoolActivity = useCallback(
  async (id: number, limit: number): Promise<PoolActivityEvent[]> => {
    // Call your contract adapter
    const events = await predinexReadApi.getPoolActivity(id, limit);
    
    // Transform to PoolActivityEvent format
    return events.map(event => ({
      id: event.txHash || `${id}-${event.timestamp}`,
      type: mapEventType(event.eventName),
      poolId: id,
      actor: event.actor,
      timestamp: event.timestamp,
      txHash: event.txHash,
      explorerUrl: buildExplorerUrl(event.txHash),
      amount: event.amount,
      outcome: event.outcome,
      status: event.status || 'success',
    }));
  },
  []
);
```

## Event Type Mapping Reference

Map your contract events to PoolActivityEventType:

```
Contract Event          →  PoolActivityEventType
pool_created           →  'pool-created'
bet_placed             →  'bet-placed'
bet_cancelled          →  'bet-cancelled'
pool_settled           →  'pool-settled'
winnings_claimed       →  'claim-processed'
dispute_filed          →  'dispute-filed'
duration_extended      →  'duration-extended'
```

## Complete Example: Minimal Integration

```tsx
'use client';

import { use } from 'react';
import Navbar from '@/components/Navbar';
import PoolActivityTimeline from '../../components/PoolActivityTimeline';
import { predinexReadApi } from '../../lib/adapters/predinex-read-api';
import type { Pool } from '../../lib/adapters/types';
import { useState, useEffect } from 'react';

export default function PoolDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const poolId = parseInt(id);
  
  const [pool, setPool] = useState<Pool | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadPool = async () => {
      try {
        const data = await predinexReadApi.getPool(poolId);
        setPool(data);
      } catch (error) {
        console.error('Failed to load pool:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPool();
  }, [poolId]);

  if (isLoading) return <div>Loading...</div>;
  if (!pool) return <div>Pool not found</div>;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-32 pb-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="glass p-8 rounded-2xl border border-border">
          <h1 className="text-3xl font-bold mb-3">{pool.title}</h1>
          <p className="text-muted-foreground mb-8">{pool.description}</p>
          
          {/* Pool details */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div>
              <p className="text-sm text-muted-foreground">{pool.outcomeA}</p>
              <p className="text-lg font-bold">{pool.totalA}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{pool.outcomeB}</p>
              <p className="text-lg font-bold">{pool.totalB}</p>
            </div>
          </div>

          {/* Pool activity timeline */}
          <PoolActivityTimeline 
            poolId={poolId}
            outcomeLabels={[pool.outcomeA, pool.outcomeB]}
            maxInitialEvents={100}
          />
        </div>
      </div>
    </main>
  );
}
```

## Styling Customization

The component uses Tailwind classes that respect your project's theme. Key customization points:

### Colors per Event Status

Edit `POOL_ACTIVITY_EVENT_ACCENT` in `web/app/lib/pool-activity.ts`:

```typescript
export const POOL_ACTIVITY_EVENT_ACCENT: Record<PoolActivityEventType, string> = {
  'pool-created': 'text-blue-400',      // Customize color
  'bet-placed': 'text-green-400',
  // ... etc
};
```

### Layout Customization

The component wraps in a `<section>` that can be styled:

```tsx
// In your pool detail page
<PoolActivityTimeline 
  poolId={poolId}
  className="mt-8 p-6 rounded-xl border border-border"  // Add custom wrapper
/>
```

## Testing

### Unit Test Example

```tsx
import { render, screen } from '@testing-library/react';
import PoolActivityTimeline from './PoolActivityTimeline';

describe('PoolActivityTimeline', () => {
  it('renders loading skeleton', () => {
    render(<PoolActivityTimeline poolId={1} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('displays empty state when no events', async () => {
    render(<PoolActivityTimeline poolId={999} />);
    await screen.findByText('No Activity Yet');
  });
});
```

### Manual Testing with Mock Data

1. Update `usePoolActivity` to use mock data:
```tsx
const fetchPoolActivity = useCallback(
  async (id: number, limit: number) => {
    return generateMockPoolActivityEvents(id, 15);
  },
  []
);
```

2. The component will display mock events with all functionality

3. Test "Load More" button, relative time updates, etc.

## Debugging

### Enable Debug Logging

In `usePoolActivity` hook:

```tsx
const loadEvents = useCallback(async () => {
  console.log(`[PoolActivity] Loading events for pool ${poolId}`);
  
  try {
    const fetchedEvents = await fetchPoolActivity(poolId, INITIAL_LOAD_SIZE);
    console.log(`[PoolActivity] Loaded ${fetchedEvents.length} events`, fetchedEvents);
    // ...
  } catch (err) {
    console.error(`[PoolActivity] Error:`, err);
  }
}, [poolId, fetchPoolActivity]);
```

### Check Component Structure

Use React DevTools to inspect:
- `PoolActivityTimeline` props
- `usePoolActivity` hook state
- Event data structure

## Performance Notes

- **Caching**: 30-second TTL for pool activity
- **Rendering**: Memoized event list prevents unnecessary re-renders
- **Time Updates**: Relative timestamps refresh every 30 seconds
- **Pagination**: Shows 100 events max initially, then "Load More"

## Accessibility

- Timeline uses semantic `<ol>` structure
- Section labeled with `aria-label`
- All interactive elements keyboard accessible
- Error messages have `role="alert"`
- Decorative icons have `aria-hidden="true"`
- Time elements use proper `<time>` semantics

## Troubleshooting

### Events not appearing
1. Check `usePoolActivity` is being called with correct poolId
2. Verify mock data is generated if using test mode
3. Check browser console for errors

### Timestamps look wrong
1. Verify timestamps are in Unix seconds (not milliseconds)
2. Check browser timezone settings
3. Verify `formatTimeAgo` calculation is correct

### Styling issues
1. Verify Tailwind CSS is compiled
2. Check project's Tailwind config includes component files
3. Verify color classes match project's theme
